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
 * Dynamic Pro plan evaluation helper.
 * Strictly verifies status === 'active' AND current_period_end > Date.now().
 */
export function isSubscriptionPro(subscription: any | null): boolean {
  if (!subscription) return false;
  const status = String(subscription.status || "").toLowerCase();
  const isActive =
    status === "active" ||
    status === "cancelling" ||
    status === "pending_downgrade";
  const periodEndRaw = subscription.current_period_end || subscription.renews_at;
  if (!periodEndRaw) return false;
  const periodEnd = new Date(periodEndRaw);
  return isActive && !isNaN(periodEnd.getTime()) && periodEnd.getTime() > Date.now();
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

          const { error: notifErr } = await supabase.from("user_notification").insert(patientNotif);
          if (notifErr) {
            console.warn("[subscriptionService] Patient notification insert warning:", notifErr.message);
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

              const { error: aErr } = await supabase.from("user_notification").insert(adminNotif);
              if (aErr) {
                console.warn("[subscriptionService] Admin notification insert warning:", aErr.message);
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
      const tierLabel = planName.toLowerCase().includes("annual")
        ? "Pro (Annual)"
        : planName.toLowerCase().includes("pro")
        ? planName
        : "Pro Plan";

      // If cached profile says Free Plan or doesn't match Pro, update it immediately
      try {
        const direct = localStorage.getItem(`derm_profile_${userId}`);
        if (direct) {
          const parsed = JSON.parse(direct);
          if (parsed.membershipTier !== tierLabel) {
            localStorage.setItem(
              `derm_profile_${userId}`,
              JSON.stringify({ ...parsed, membershipTier: tierLabel })
            );
          }
        }
        const globalCached = localStorage.getItem("dermai_patient_profile");
        if (globalCached) {
          const parsed = JSON.parse(globalCached);
          if ((parsed.userId === userId || !parsed.userId) && parsed.membershipTier !== tierLabel) {
            localStorage.setItem(
              "dermai_patient_profile",
              JSON.stringify({ ...parsed, membershipTier: tierLabel })
            );
          }
        }
      } catch {}

      return {
        tier: "Pro",
        tierLabel,
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

/**
 * Immediate Plan Activation on Payment Fulfillment:
 * Ensures upon payment success:
 * 1. Upserts/updates in public.user_plan_subscription:
 *    - user_id: Authenticated patient's UUID
 *    - plan_id: Pro plan identifier
 *    - status: 'active'
 *    - current_period_start: NOW()
 *    - current_period_end: One month from now (NOW() + interval '1 month' or 30 days; or 1 year)
 * 2. User Profile Synchronization: updates user table (plan_tier: 'pro' or updated_at)
 * 3. Frontend State & Cache Invalidation:
 *    - Clears stale cached plan claims in localStorage (derm_profile_${userId}, dermai_patient_profile)
 *    - Dispatches window events (dermai_subscription_updated, derm_profile_updated, etc.)
 * 4. Audit Logging & Notifications:
 *    - Logs action: 'Subscription Upgraded', category: 'Subscription', target: 'User #' + userId
 *    - Inserts in-app notification in public.user_notification welcoming user to Pro tier
 */
export async function upgradeSubscriptionToPro(
  userId: string,
  options?: {
    planId?: string;
    billingCycle?: "monthly" | "yearly";
    paymentMethod?: string;
    paymongoPaymentId?: string;
    amount?: number;
  }
): Promise<UserSubscriptionInfo> {
  if (!userId) {
    throw new Error("User ID is required to upgrade subscription.");
  }

  const billingCycle = options?.billingCycle || "monthly";

  // 1. Resolve Pro Plan
  let planRecord: any = null;
  if (options?.planId) {
    const { data: p } = await supabase
      .from("plan")
      .select("plan_id, name, price, scan_limit, billing_type")
      .eq("plan_id", options.planId)
      .maybeSingle();
    planRecord = p;
  }
  if (!planRecord) {
    const { data: p } = await supabase
      .from("plan")
      .select("plan_id, name, price, scan_limit, billing_type")
      .eq("billing_type", billingCycle)
      .ilike("name", "%Pro%")
      .order("price", { ascending: false })
      .limit(1)
      .maybeSingle();
    planRecord = p;
  }

  const planId =
    planRecord?.plan_id ||
    (billingCycle === "yearly"
      ? "00000000-0000-0000-0000-000000000004"
      : "00000000-0000-0000-0000-000000000003");
  const planName = planRecord?.name || (billingCycle === "yearly" ? "Pro (Annual)" : "Pro");
  const tierLabel = planName.toLowerCase().includes("annual") ? "Pro (Annual)" : "Pro";

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  if (billingCycle === "yearly") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // 2. Immediate Plan Activation on Payment Fulfillment in public.user_plan_subscription
  const subscriptionRecord = {
    user_id: userId,
    plan_id: planId,
    status: "active",
    billing_cycle: billingCycle,
    started_at: periodStart.toISOString(),
    renews_at: periodEnd.toISOString(),
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    payment_method: options?.paymentMethod || "Online Payment",
    updated_at: new Date().toISOString(),
  };

  const { error: subErr } = await supabase
    .from("user_plan_subscription")
    .upsert(subscriptionRecord, { onConflict: "user_id" });

  if (subErr) {
    console.error("[upgradeSubscriptionToPro] Upsert error:", subErr.message);
  }

  // 3. User Profile Synchronization: Update user table (safely update plan_tier or updated_at)
  try {
    const { error: profileErr } = await supabase
      .from("user")
      .update({
        plan_tier: "pro",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (profileErr) {
      await supabase
        .from("user")
        .update({ updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
  } catch (profErr) {
    console.warn("[upgradeSubscriptionToPro] Profile sync warning:", profErr);
  }

  // 4. In-App Notification in public.user_notification welcoming user to Pro tier
  try {
    const { data: existingNotif } = await supabase
      .from("user_notification")
      .select("notif_id")
      .eq("user_id", userId)
      .eq("subtype", "subscription_upgraded")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString())
      .limit(1)
      .maybeSingle();

    if (!existingNotif) {
      const formattedDate = periodEnd.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      await supabase.from("user_notification").insert({
        user_id: userId,
        type: "subscription",
        subtype: "subscription_upgraded",
        title: "Welcome to DermAI Pro!",
        body: `Your payment was successful. You now have unlimited AI skin scans and Pro features enabled until ${formattedDate}.`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }
  } catch (notifErr) {
    console.warn("[upgradeSubscriptionToPro] Notification dispatch warning:", notifErr);
  }

  // 5. Audit Logging via logAuditEvent:
  // action: 'Subscription Upgraded', category: 'Subscription', target: 'User #' + userId
  try {
    await logAuditEvent({
      userId,
      role: "patient",
      category: "Subscription",
      action: "Subscription Upgraded",
      target: `User #${userId}`,
      details: "Patient upgraded to Pro plan following successful payment.",
      metadata: {
        planId,
        planName,
        billingCycle,
        paymentMethod: options?.paymentMethod || "Online Payment",
        paymentId: options?.paymongoPaymentId,
        amount: options?.amount,
        currentPeriodStart: periodStart.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      },
    });
  } catch (auditErr) {
    console.warn("[upgradeSubscriptionToPro] Audit log warning:", auditErr);
  }

  // 6. Frontend State & Cache Invalidation:
  // Clear stale cached plan claims in localStorage so header badge and layout immediately show Pro
  try {
    const direct = localStorage.getItem(`derm_profile_${userId}`);
    const parsedDirect = direct ? JSON.parse(direct) : {};
    localStorage.setItem(
      `derm_profile_${userId}`,
      JSON.stringify({ ...parsedDirect, membershipTier: tierLabel, userId })
    );

    const globalCached = localStorage.getItem("dermai_patient_profile");
    const parsedGlobal = globalCached ? JSON.parse(globalCached) : {};
    localStorage.setItem(
      "dermai_patient_profile",
      JSON.stringify({ ...parsedGlobal, membershipTier: tierLabel, userId })
    );
  } catch {}

  // 7. Dispatch events across active components
  try {
    window.dispatchEvent(
      new CustomEvent("dermai_subscription_updated", {
        detail: { userId, tier: tierLabel, status: "active" },
      })
    );
    window.dispatchEvent(new CustomEvent("derm_profile_updated"));
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(new Event("storage"));
  } catch {}

  return {
    tier: "Pro",
    tierLabel,
    isPro: true,
    isExpired: false,
    status: "active",
    currentPeriodStart: periodStart.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    scanLimit: -1,
    subscription: subscriptionRecord,
    plan: planRecord,
  };
}
