import { supabase } from "./supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";

export type UserSubscriptionInfo = {
  tier: "Free" | "Pro";
  tierLabel: string;
  isPro: boolean;
  isExpired: boolean;
  status: "active" | "expired" | "cancelled" | "none";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  scanLimit: number;
  subscription: any | null;
  plan: any | null;
};

/**
 * Dynamic subscription validity check.
 * Strictly verifies status === 'active' AND current_period_end > Date.now().
 * Compares UTC milliseconds directly: new Date(current_period_end).getTime() > Date.now().
 */
export function isSubscriptionActive(subscription: any | null): boolean {
  if (!subscription) return false;
  const status = String(subscription.status || "").toLowerCase();
  if (status !== "active" && status !== "cancelling" && status !== "pending_downgrade") {
    return false;
  }
  const periodEndRaw = subscription.current_period_end || subscription.renews_at;
  if (!periodEndRaw) return false;
  const periodEnd = new Date(periodEndRaw);
  return !isNaN(periodEnd.getTime()) && periodEnd.getTime() > Date.now();
}

/**
 * Checks if a subscription period has already lapsed.
 * Compares UTC milliseconds directly.
 */
export function isSubscriptionExpired(subscription: any | null): boolean {
  if (!subscription) return false;
  const periodEndRaw = subscription.current_period_end || subscription.renews_at;
  if (!periodEndRaw) return true;
  const periodEnd = new Date(periodEndRaw);
  return !isNaN(periodEnd.getTime()) && periodEnd.getTime() <= Date.now();
}

/**
 * Centralized verification and lazy downgrade synchronization:
 * 1. Fetches user subscription from Supabase.
 * 2. Checks if status === 'active' and current_period_end <= NOW().
 * 3. If expired:
 *    - Updates database: status = 'expired'
 *    - Dispatches patient notification: 'Subscription Expired'
 *    - Dispatches admin notification: 'Patient Subscription Expired'
 *    - Logs audit event: action: 'Subscription Expired', category: 'Subscription'
 *    - Cleans stale localStorage caches so UI immediately shows Free Plan
 *    - Dispatches realtime window events
 * 4. Returns dynamic subscription status (resolves to 'Free' if expired).
 */
export async function validateAndSyncSubscription(
  userId: string,
  options?: { skipAdminAlert?: boolean }
): Promise<UserSubscriptionInfo> {
  const freeFallback: UserSubscriptionInfo = {
    tier: "Free",
    tierLabel: "Free Plan",
    isPro: false,
    isExpired: false,
    status: "none",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    scanLimit: 3,
    subscription: null,
    plan: null,
  };

  if (!userId) return freeFallback;

  try {
    // Fetch latest subscription for user
    const { data: sub, error } = await supabase
      .from("user_plan_subscription")
      .select(`
        subscription_id,
        started_at,
        current_period_start,
        current_period_end,
        renews_at,
        status,
        billing_cycle,
        cancel_at_period_end,
        plan_id,
        plan:plan_id (
          plan_id,
          name,
          price,
          scan_limit
        )
      `)
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[subscriptionService] Query warning:", error.message);
      return freeFallback;
    }

    if (!sub) {
      return freeFallback;
    }

    const planObj: any = Array.isArray(sub.plan) ? sub.plan[0] : sub.plan;
    const periodEndRaw = sub.current_period_end || sub.renews_at;
    const periodEndMs = periodEndRaw ? new Date(periodEndRaw).getTime() : null;
    const isLapsed = periodEndMs !== null ? periodEndMs <= Date.now() : true;
    const wasActive =
      sub.status === "active" ||
      sub.status === "cancelling" ||
      sub.status === "pending_downgrade";

    // -------------------------------------------------------------------------
    // LAZY DOWNGRADE / AUTO-UPDATE:
    // When active but current_period_end has lapsed, update DB to 'expired'
    // -------------------------------------------------------------------------
    if (wasActive && isLapsed) {
      console.log(
        `[subscriptionService] Subscription ${sub.subscription_id} for user ${userId} expired on ${periodEndRaw}. Downgrading to Free...`
      );

      // 1. Update user_plan_subscription status to 'expired' by subscription_id
      try {
        await (supabase.rpc as any)("downgrade_expired_subscriptions");
      } catch {
        /* fallback to direct table update */
      }

      const { error: updateErr } = await supabase
        .from("user_plan_subscription")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("subscription_id", sub.subscription_id);

      if (updateErr) {
        console.warn("[subscriptionService] Update by subscription_id failed, trying by user_id:", updateErr.message);
        await supabase
          .from("user_plan_subscription")
          .update({
            status: "expired",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("status", "active");
      }
      sub.status = "expired";

      // 2. Update user profile table if applicable (safely handle optional columns)
      try {
        await supabase
          .from("user")
          .update({ updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      } catch {
        /* ignore */
      }

      // 3. Insert Patient Notification into public.user_notification
      try {
        // Prevent duplicate expiration notifications for the same subscription
        const { data: existingNotif } = await supabase
          .from("user_notification")
          .select("notif_id")
          .eq("user_id", userId)
          .eq("type", "subscription")
          .eq("subtype", "subscription_expired")
          .limit(1)
          .maybeSingle();

        if (!existingNotif) {
          const patientNotif = {
            user_id: userId,
            type: "subscription",
            subtype: "subscription_expired",
            title: "Subscription Expired",
            body: "Your Pro plan has expired. Your account has returned to the Free plan. Renew your subscription anytime to regain full Pro access.",
            is_read: false,
            created_at: new Date().toISOString(),
          };

          const { error: notifErr } = await supabase.from("user_notification").insert({
            ...patientNotif,
            metadata: {
              subscription_id: sub.subscription_id,
              status: "expired",
              plan_id: sub.plan_id,
            },
          });

          // Fallback if metadata column is absent in remote schema
          if (
            notifErr &&
            (notifErr.message?.includes("metadata") || (notifErr as any).code === "42703")
          ) {
            await supabase.from("user_notification").insert(patientNotif);
          }
        }
      } catch (notifErr) {
        console.warn("[subscriptionService] Patient notification dispatch warning:", notifErr);
      }

      // 4. Alert the Admin notifications feed regarding the expired patient subscription
      if (!options?.skipAdminAlert) {
        try {
          const { data: adminUsers } = await supabase
            .from("user")
            .select("user_id")
            .eq("role", "admin");

          if (adminUsers && adminUsers.length > 0) {
            const { data: patientUser } = await supabase
              .from("user")
              .select("full_name, email")
              .eq("user_id", userId)
              .maybeSingle();

            const patientName =
              patientUser?.full_name || patientUser?.email || `User #${userId.slice(0, 8)}`;

            for (const admin of adminUsers) {
              const adminNotif = {
                user_id: admin.user_id,
                type: "subscription",
                subtype: "admin_subscription_expired",
                title: "Patient Subscription Expired",
                body: `Subscription for ${patientName} has expired and was automatically downgraded to the Free plan.`,
                is_read: false,
                created_at: new Date().toISOString(),
              };

              const { error: aErr } = await supabase.from("user_notification").insert({
                ...adminNotif,
                metadata: {
                  patient_user_id: userId,
                  subscription_id: sub.subscription_id,
                  status: "expired",
                },
              });

              if (
                aErr &&
                (aErr.message?.includes("metadata") || (aErr as any).code === "42703")
              ) {
                await supabase.from("user_notification").insert(adminNotif);
              }
            }
          }
        } catch (adminNotifErr) {
          console.warn("[subscriptionService] Admin alert dispatch warning:", adminNotifErr);
        }
      }

      // 5. Audit Log Integration: Record the downgrade event in audit logs
      logAuditEvent({
        userId,
        category: "Subscription",
        action: "Subscription Expired",
        target: `User #${userId}`,
        details: "Account downgraded from Pro to Free due to period expiration.",
        metadata: {
          subscriptionId: sub.subscription_id,
          expiredAt: periodEndRaw,
          planName: planObj?.name || "Pro",
        },
      }).catch(() => {});

      // 6. Clean up stale localStorage caches so UI immediately shows Free Plan
      try {
        const direct = localStorage.getItem(`derm_profile_${userId}`);
        if (direct) {
          const parsed = JSON.parse(direct);
          localStorage.setItem(
            `derm_profile_${userId}`,
            JSON.stringify({ ...parsed, membershipTier: "Free Plan" })
          );
        }
        const globalCached = localStorage.getItem("dermai_patient_profile");
        if (globalCached) {
          const parsed = JSON.parse(globalCached);
          if (parsed.userId === userId || !parsed.userId) {
            localStorage.setItem(
              "dermai_patient_profile",
              JSON.stringify({ ...parsed, membershipTier: "Free Plan" })
            );
          }
        }
      } catch {
        /* ignore */
      }

      // 7. Dispatch events to notify all active components across the application
      try {
        window.dispatchEvent(
          new CustomEvent("dermai_subscription_updated", {
            detail: { userId, tier: "Free Plan", status: "expired" },
          })
        );
        window.dispatchEvent(new CustomEvent("derm_profile_updated"));
        window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch {
        /* ignore */
      }

      return {
        tier: "Free",
        tierLabel: "Free Plan",
        isPro: false,
        isExpired: true,
        status: "expired",
        currentPeriodStart: sub.current_period_start || null,
        currentPeriodEnd: periodEndRaw || null,
        scanLimit: 3,
        subscription: sub,
        plan: planObj,
      };
    }

    // -------------------------------------------------------------------------
    // VALID SUBSCRIPTION CHECK
    // -------------------------------------------------------------------------
    const active = isSubscriptionActive(sub);
    const planName = planObj?.name || "Free Plan";
    const isProPlan =
      active &&
      (Number(planObj?.price ?? 0) > 0 ||
        planObj?.scan_limit === -1 ||
        planName.toLowerCase().includes("pro"));

    if (active && isProPlan) {
      return {
        tier: "Pro",
        tierLabel: planName.toLowerCase().includes("annual")
          ? "Pro (Annual)"
          : planName.toLowerCase().includes("pro")
          ? planName
          : "Pro Plan",
        isPro: true,
        isExpired: false,
        status: "active",
        currentPeriodStart: sub.current_period_start || null,
        currentPeriodEnd: periodEndRaw || null,
        scanLimit: -1,
        subscription: sub,
        plan: planObj,
      };
    }

    const isSubExpired = isSubscriptionExpired(sub) || sub.status === "expired";

    // Otherwise resolves to Free Plan
    return {
      tier: "Free",
      tierLabel: "Free Plan",
      isPro: false,
      isExpired: isSubExpired,
      status: (sub.status as any) || "expired",
      currentPeriodStart: sub.current_period_start || null,
      currentPeriodEnd: periodEndRaw || null,
      scanLimit: 3,
      subscription: sub,
      plan: planObj,
    };
  } catch (err) {
    console.error("[subscriptionService] Unexpected error in validateAndSyncSubscription:", err);
    return freeFallback;
  }
}

/**
 * Sweeps all active subscriptions across the database and auto-updates any whose
 * current_period_end is in the past. Used by Admin views and app startup.
 */
export async function syncAllExpiredSubscriptions(): Promise<number> {
  try {
    const nowIso = new Date().toISOString();
    const { data: expiredSubs, error } = await supabase
      .from("user_plan_subscription")
      .select("subscription_id, user_id, current_period_end, status")
      .eq("status", "active")
      .lt("current_period_end", nowIso);

    if (error || !expiredSubs || expiredSubs.length === 0) {
      return 0;
    }

    let count = 0;
    for (const sub of expiredSubs) {
      if (sub.user_id) {
        await validateAndSyncSubscription(sub.user_id);
        count++;
      }
    }
    return count;
  } catch (err) {
    console.warn("[subscriptionService] Error in syncAllExpiredSubscriptions:", err);
    return 0;
  }
}
