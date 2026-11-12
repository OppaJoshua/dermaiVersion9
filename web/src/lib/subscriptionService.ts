import { supabase } from "./supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";

export type FreePlanConfigResult = {
  verified: boolean;
  ambiguous: boolean;
  isActive: boolean;
  scanLimit: number;
  configuredScanLimit: number;
  plan: any | null;
  features: string[];
  error: string | null;
};

export type FreeScanUsageResult = {
  verified: boolean;
  ambiguous: boolean;
  freeScansUsed: number;
  error: string | null;
};

export type PaidPeriodScanUsageResult = {
  verified: boolean;
  scansUsed: number;
  error: string | null;
};

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
  freePlanActive?: boolean;
  freePlanVerified?: boolean;
  freePlanAmbiguous?: boolean;
  freePlanConfiguredLimit?: number;
  freePlanDetails?: any | null;
  freePlanError?: string | null;
  paidLimitVerified?: boolean;
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
 * Resolves a plan's scan_limit value conservatively:
 * - -1 explicitly represents Unlimited (-1)
 * - >= 0 represents a finite scan allowance (0, 3, 5, 10, etc.)
 * - missing, null, undefined, or invalid values fall back conservatively (default 3) and never assume Unlimited.
 */
export function resolvePlanScanLimit(rawLimit: unknown, fallback = 3): number {
  if (rawLimit === null || rawLimit === undefined || rawLimit === "") {
    return fallback;
  }
  const num = Number(rawLimit);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num === -1) {
    return -1;
  }
  if (num >= 0) {
    return Math.floor(num);
  }
  return fallback;
}

export const CONSUMED_SCAN_STATUSES = [
  "completed",
  "valid",
  "flagged",
  "invalid",
] as const;

/**
 * Fetches the administrator-managed Free Plan (price = 0) from `public.plan`.
 * - Does not use hardcoded plan IDs, plan names, or fallback scan limits.
 * - Fails closed if the query fails, if zero rows exist, or if multiple zero-priced plans exist (ambiguity).
 */
export async function fetchAdminFreePlanConfig(): Promise<FreePlanConfigResult> {
  try {
    const { data, error } = await supabase
      .from("plan")
      .select(`
        plan_id,
        name,
        description,
        price,
        scan_limit,
        status,
        billing_type,
        plan_feature (
          feature_id,
          feature_text
        )
      `)
      .eq("price", 0);

    if (error || !Array.isArray(data)) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error: "Unable to verify your scan allowance. Please check your internet connection and try again.",
      };
    }

    if (data.length === 0) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error: "Free AI skin scanning is not currently configured.",
      };
    }

    if (data.length > 1) {
      return {
        verified: false,
        ambiguous: true,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error:
          "Multiple zero-priced plans were found in Plan Management. Free scanning is disabled until a single Free Plan is configured.",
      };
    }

    const row: any = data[0];
    const status = String(row.status || "").toLowerCase();
    const isActive = status === "active";
    const configuredLimit = resolvePlanScanLimit(row.scan_limit, -2);

    const features: string[] = Array.isArray(row.plan_feature)
      ? row.plan_feature.map((f: any) => f.feature_text).filter(Boolean)
      : [];

    if (configuredLimit === -2) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: row,
        features,
        error: "The Free Plan scan allowance is not properly configured.",
      };
    }

    return {
      verified: true,
      ambiguous: false,
      isActive,
      scanLimit: isActive ? configuredLimit : 0,
      configuredScanLimit: configuredLimit,
      plan: row,
      features,
      error: isActive
        ? null
        : "Free AI skin scanning is currently unavailable. Please view the available subscription plans to continue scanning.",
    };
  } catch (err) {
    console.warn("[subscriptionService] fetchAdminFreePlanConfig error:", err);
    return {
      verified: false,
      ambiguous: false,
      isActive: false,
      scanLimit: 0,
      configuredScanLimit: 0,
      plan: null,
      features: [],
      error: "Unable to verify your scan allowance. Please check your internet connection and try again.",
    };
  }
}

/**
 * Counts completed AI scans during an active paid subscription billing period.
 * Fails closed (`verified: false`) if period boundaries are missing or the query fails.
 */
export async function countPaidPeriodScans(
  userId: string,
  periodStart: string | null | undefined,
  periodEnd?: string | null | undefined
): Promise<PaidPeriodScanUsageResult> {
  if (!userId || !periodStart) {
    return {
      verified: false,
      scansUsed: 0,
      error: "Unable to verify your current subscription billing period.",
    };
  }
  const startMs = Date.parse(periodStart);
  if (!Number.isFinite(startMs)) {
    return {
      verified: false,
      scansUsed: 0,
      error: "Invalid subscription billing period start date.",
    };
  }

  try {
    let query = supabase
      .from("ai_scan_result")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", [...CONSUMED_SCAN_STATUSES])
      .gte("scanned_at", new Date(startMs).toISOString());

    if (periodEnd) {
      const endMs = Date.parse(periodEnd);
      if (Number.isFinite(endMs) && endMs >= startMs) {
        query = query.lte("scanned_at", new Date(endMs).toISOString());
      }
    }

    const { count, error } = await query;
    if (error || typeof count !== "number") {
      return {
        verified: false,
        scansUsed: 0,
        error: "We couldn't verify your current scan usage. Please check your connection and try again.",
      };
    }

    return {
      verified: true,
      scansUsed: count,
      error: null,
    };
  } catch (err) {
    console.warn("[subscriptionService] countPaidPeriodScans error:", err);
    return {
      verified: false,
      scansUsed: 0,
      error: "We couldn't verify your current scan usage. Please check your connection and try again.",
    };
  }
}

/**
 * Authoritative one-time Free scan usage calculation using completed `ai_scan_result` records.
 * - Does not use `user.free_scans_used` or `Math.max(user.free_scans_used, ...)`.
 * - Retrieves all completed scans, subscription records, and successful payment records with pagination.
 * - Excludes only scans that fall within verified paid subscription entitlement periods.
 * - Never assumes `payment_date + billing_cycle` equals an entitlement period; if any completed scan
 *   overlaps an overwritten or unverified historical paid subscription period, returns `verified: false, ambiguous: true`.
 */
export async function calculateOneTimeFreeScanUsage(
  userId: string
): Promise<FreeScanUsageResult> {
  if (!userId) {
    return {
      verified: false,
      ambiguous: false,
      freeScansUsed: 0,
      error: "User authentication is required to verify free scan usage.",
    };
  }

  const PAGE_SIZE = 500;

  try {
    // 1. Paginated retrieval of all completed scan records (including admin-reviewed valid/flagged/invalid scans)
    const completedScans: Array<{ analysis_id: string; scanned_at: string | null }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("ai_scan_result")
        .select("analysis_id, scanned_at")
        .eq("user_id", userId)
        .in("status", [...CONSUMED_SCAN_STATUSES])
        .order("scanned_at", { ascending: true })
        .order("analysis_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: "Unable to verify your scan allowance. Please check your internet connection and try again.",
        };
      }
      completedScans.push(...(data as any[]));
      if (data.length < PAGE_SIZE) break;
    }

    if (completedScans.length === 0) {
      return {
        verified: true,
        ambiguous: false,
        freeScansUsed: 0,
        error: null,
      };
    }

    // 2. Paginated retrieval of all subscription rows for the user
    const subRows: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
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
          cancelled_at,
          plan_id,
          plan:plan_id (
            plan_id,
            name,
            price,
            scan_limit,
            billing_type
          )
        `)
        .eq("user_id", userId)
        .order("started_at", { ascending: true })
        .order("subscription_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: "Unable to verify your scan allowance. Please check your internet connection and try again.",
        };
      }
      subRows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    // 3. Paginated retrieval of all successful payment records for the user
    const paymentRows: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("user_payment")
        .select(`
          *,
          plan:plan_id (
            plan_id,
            name,
            price,
            billing_type
          )
        `)
        .eq("user_id", userId)
        .eq("status", "success")
        .order("payment_date", { ascending: true })
        .order("payment_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: "Unable to verify your scan allowance. Please check your internet connection and try again.",
        };
      }
      paymentRows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    // Filter to actual paid subscription payments (excluding consultation appointments)
    const subscriptionPayments = paymentRows.filter((p: any) => {
      if (p.appointment_id) return false;
      const pType = String(p.payment_type || "").toLowerCase();
      if (
        pType === "appointment_consultation" ||
        pType === "appointment_consultation_simulated"
      ) {
        return false;
      }
      const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
      const planPrice = Number(planObj?.price ?? 0);
      const paidAmt = Number(p.amount ?? p.total_amount ?? p.amount_paid ?? 0);
      return (p.plan_id != null || planPrice > 0) && paidAmt > 0;
    });

    // Filter to paid subscription rows
    const paidSubRows = subRows.filter((s: any) => {
      const planObj = Array.isArray(s.plan) ? s.plan[0] : s.plan;
      const price = Number(planObj?.price ?? 0);
      const limit = Number(planObj?.scan_limit);
      return price > 0 || limit === -1 || s.plan_id != null;
    });

    // Fast-path: user has never had any paid subscription or subscription payment
    if (paidSubRows.length === 0 && subscriptionPayments.length === 0) {
      for (const s of completedScans) {
        if (!s.scanned_at || !Number.isFinite(Date.parse(s.scanned_at))) {
          return {
            verified: false,
            ambiguous: true,
            freeScansUsed: 0,
            error: "A historical scan record is missing a valid timestamp.",
          };
        }
      }
      return {
        verified: true,
        ambiguous: false,
        freeScansUsed: completedScans.length,
        error: null,
      };
    }

    // Build verified paid subscription periods and detect overwritten historical gaps
    const SKEW_MS = 15 * 60 * 1000;
    const verifiedWindows: Array<{ startMs: number; endMs: number }> = [];
    const authoritativeSubWindows: Array<{
      startMs: number;
      endMs: number;
      startedAtMs: number;
      planId: string;
    }> = [];
    const rawOverwrittenGaps: Array<{ startMs: number; endMs: number }> = [];

    for (const s of paidSubRows) {
      const startRaw = s.current_period_start || s.started_at;
      const endRaw = s.current_period_end || s.renews_at;
      const startMs = startRaw ? Date.parse(startRaw) : NaN;
      const endMs = endRaw ? Date.parse(endRaw) : NaN;
      const startedAtMs = s.started_at ? Date.parse(s.started_at) : startMs;

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            "Subscription period dates are incomplete; historical free scan usage cannot be verified unambiguously.",
        };
      }

      let effectiveEndMs = endMs;
      const statusLower = String(s.status || "").toLowerCase();
      if (statusLower === "cancelled" && !s.cancel_at_period_end && s.cancelled_at) {
        const cancelledMs = Date.parse(s.cancelled_at);
        if (Number.isFinite(cancelledMs) && cancelledMs >= startMs && cancelledMs < endMs) {
          effectiveEndMs = cancelledMs;
        }
      }

      const subPlanId = String(s.plan_id || "").trim();
      authoritativeSubWindows.push({
        startMs,
        endMs: effectiveEndMs,
        startedAtMs,
        planId: subPlanId,
      });
      verifiedWindows.push({ startMs, endMs: effectiveEndMs });

      // If `started_at` precedes `current_period_start` by more than 10 minutes, an earlier period was overwritten
      if (Number.isFinite(startedAtMs) && startedAtMs < startMs - 10 * 60 * 1000) {
        rawOverwrittenGaps.push({ startMs: startedAtMs, endMs: startMs });
      }
    }

    // Reconstruct earlier overwritten paid subscription periods from verified system_audit_log records
    // when earlier subscription payments or overwritten period gaps exist.
    const needsHistoricalAuditVerification =
      rawOverwrittenGaps.length > 0 ||
      subscriptionPayments.some((pay: any) => {
        const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
        if (!Number.isFinite(payMs)) return true;
        return !verifiedWindows.some(
          (w) => payMs >= w.startMs - SKEW_MS && payMs <= w.endMs
        );
      });

    const historicalAuditWindows: Array<{ startMs: number; endMs: number }> = [];

    if (needsHistoricalAuditVerification) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData?.session?.user?.id;
        if (sessionUserId && sessionUserId !== userId) {
          return {
            verified: false,
            ambiguous: false,
            freeScansUsed: 0,
            error: "Unable to verify scan allowance for another user.",
          };
        }
      } catch {
        // Proceed if auth session helper is unavailable in the current runtime context
      }

      const auditRows: any[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("system_audit_log")
          .select("log_id, timestamp, user_id, log_type, action, details")
          .eq("user_id", userId)
          .eq("log_type", "subscription")
          .eq("action", "Subscription Upgraded")
          .order("timestamp", { ascending: true })
          .order("log_id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error || !Array.isArray(data)) {
          return {
            verified: false,
            ambiguous: false,
            freeScansUsed: 0,
            error:
              "Unable to verify your scan allowance. Please check your internet connection and try again.",
          };
        }
        auditRows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }

      const dedupAuditMap = new Map<
        string,
        { startMs: number; endMs: number; planId: string }
      >();

      for (const row of auditRows) {
        // 1. Verify event belongs strictly to the authenticated patient and represents subscription activation
        if (String(row?.user_id || "") !== userId) continue;
        if (String(row?.log_type || "").toLowerCase() !== "subscription") continue;
        if (String(row?.action || "") !== "Subscription Upgraded") continue;

        const detailsStr = typeof row?.details === "string" ? row.details : "";
        const ctxIdx = detailsStr.lastIndexOf("Context:");
        if (ctxIdx === -1) continue;

        let ctx: any = null;
        try {
          ctx = JSON.parse(detailsStr.slice(ctxIdx + "Context:".length).trim());
        } catch {
          continue;
        }
        if (!ctx || typeof ctx !== "object") continue;

        // 2. Verify recorded period start and end are valid
        const periodStartRaw =
          typeof ctx.currentPeriodStart === "string" ? ctx.currentPeriodStart : "";
        const periodEndRaw =
          typeof ctx.currentPeriodEnd === "string" ? ctx.currentPeriodEnd : "";
        const startMs = periodStartRaw ? Date.parse(periodStartRaw) : NaN;
        const endMs = periodEndRaw ? Date.parse(periodEndRaw) : NaN;
        const logMs = row?.timestamp ? Date.parse(row.timestamp) : startMs;

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          continue;
        }
        if (!Number.isFinite(logMs) || Math.abs(logMs - startMs) > 24 * 60 * 60 * 1000) {
          continue;
        }

        const auditPlanId = String(ctx.planId || ctx.plan_id || "").trim();
        const auditTxId = String(
          ctx.transactionId || ctx.paymentId || ctx.referenceNumber || ""
        ).trim();

        // 3. Verify referenced plan and transaction correspond to a fulfilled subscription payment
        const matchedPay = subscriptionPayments.find((pay: any) => {
          const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
          if (!Number.isFinite(payMs)) return false;

          const payPlanId = String(pay.plan_id || "").trim();
          if (auditPlanId && payPlanId && auditPlanId !== payPlanId) {
            return false;
          }

          const payTxIds = [
            pay.paymongo_payment_id,
            pay.reference_number,
            pay.paymongo_payment_intent_id,
            pay.payment_id,
          ]
            .map((v) => String(v || "").trim())
            .filter(Boolean);

          if (auditTxId && payTxIds.length > 0) {
            return (
              payTxIds.includes(auditTxId) &&
              Math.abs(payMs - startMs) <= 24 * 60 * 60 * 1000
            );
          }

          return Math.abs(payMs - startMs) <= SKEW_MS;
        });

        if (!matchedPay) continue;

        // 4. Do not allow audit records to override or conflict with authoritative user_plan_subscription records
        const overlapsOrFollowsAuthoritativeSub = authoritativeSubWindows.some(
          (subWin) => startMs >= subWin.startMs - SKEW_MS
        );
        if (overlapsOrFollowsAuthoritativeSub) continue;

        // 5. Deduplicate multiple audit events for the same subscription activation
        const dedupKey = matchedPay.payment_id
          ? `pay:${String(matchedPay.payment_id)}`
          : auditTxId
            ? `tx:${auditTxId}`
            : `win:${auditPlanId}:${Math.round(startMs / SKEW_MS)}`;

        const existing = dedupAuditMap.get(dedupKey);
        if (existing) {
          existing.startMs = Math.min(existing.startMs, startMs);
          existing.endMs = Math.max(existing.endMs, endMs);
        } else {
          dedupAuditMap.set(dedupKey, {
            startMs,
            endMs,
            planId: auditPlanId,
          });
        }
      }

      // 6. Sort deduplicated historical windows chronologically and cap each window at the next upgrade/subscription start
      const sortedAuditWindows = Array.from(dedupAuditMap.values()).sort(
        (a, b) => a.startMs - b.startMs
      );

      for (let i = 0; i < sortedAuditWindows.length; i += 1) {
        const current = sortedAuditWindows[i];
        let boundedEndMs = current.endMs;

        for (let j = i + 1; j < sortedAuditWindows.length; j += 1) {
          if (sortedAuditWindows[j].startMs > current.startMs) {
            boundedEndMs = Math.min(boundedEndMs, sortedAuditWindows[j].startMs);
            break;
          }
        }

        for (const subWin of authoritativeSubWindows) {
          if (subWin.startMs > current.startMs) {
            boundedEndMs = Math.min(boundedEndMs, subWin.startMs);
          }
        }

        if (boundedEndMs > current.startMs) {
          historicalAuditWindows.push({
            startMs: current.startMs,
            endMs: boundedEndMs,
          });
          verifiedWindows.push({
            startMs: current.startMs,
            endMs: boundedEndMs,
          });
        }
      }
    }

    // Only retain overwrittenGaps whose original `started_at` is not accounted for by a verified historical audit window
    const overwrittenGaps = rawOverwrittenGaps.filter(
      (gap) =>
        !historicalAuditWindows.some(
          (hw) => Math.abs(hw.startMs - gap.startMs) <= SKEW_MS
        )
    );

    // Sort verified paid windows chronologically
    verifiedWindows.sort((a, b) => a.startMs - b.startMs);

    // Check whether any successful subscription payment is not covered by a verified subscription window.
    // Bound each unmatched payment's uncertainty to [payMs - SKEW_MS, nextVerifiedWindow.startMs)
    // so an older unmatched payment does not block scans taken after a later verified subscription expires.
    const unmatchedPaymentWindows: Array<{ startMs: number; endMs: number }> = [];

    for (const pay of subscriptionPayments) {
      const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
      if (!Number.isFinite(payMs)) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error: "A subscription payment record is missing a valid timestamp.",
        };
      }

      const isCoveredByVerifiedWindow = verifiedWindows.some(
        (w) => payMs >= w.startMs - SKEW_MS && payMs <= w.endMs
      );
      if (!isCoveredByVerifiedWindow) {
        const nextVerifiedWindow = verifiedWindows.find(
          (w) => w.startMs > payMs - SKEW_MS
        );
        unmatchedPaymentWindows.push({
          startMs: payMs - SKEW_MS,
          endMs: nextVerifiedWindow ? nextVerifiedWindow.startMs : Number.POSITIVE_INFINITY,
        });
      }
    }

    // Classify each completed scan
    let freeScansUsed = 0;

    for (const scan of completedScans) {
      const scanMs = scan.scanned_at ? Date.parse(scan.scanned_at) : NaN;
      if (!Number.isFinite(scanMs)) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error: "A historical scan record is missing a valid timestamp.",
        };
      }

      // 1. Reliably inside a verified paid subscription period -> Paid scan (excluded from free count)
      const inVerifiedPaidWindow = verifiedWindows.some(
        (w) => scanMs >= w.startMs - SKEW_MS && scanMs <= w.endMs
      );
      if (inVerifiedPaidWindow) {
        continue;
      }

      // 2. Check if scan falls in an overwritten gap between `started_at` and `current_period_start`
      const inOverwrittenGap = overwrittenGaps.some(
        (g) => scanMs >= g.startMs - SKEW_MS && scanMs < g.endMs
      );
      if (inOverwrittenGap) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            "Historical scan usage overlaps an earlier subscription period that was updated on renewal and cannot be classified unambiguously.",
        };
      }

      // 3. Check if scan falls within the bounded historical period of an unmatched subscription payment
      // (Never assume `payment_date + billing_cycle` equals the entitlement period)
      const inUnmatchedPaymentPeriod = unmatchedPaymentWindows.some(
        (uw) => scanMs >= uw.startMs && scanMs < uw.endMs
      );

      if (inUnmatchedPaymentPeriod) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            "Historical scan records overlap a prior subscription payment whose exact entitlement period is no longer stored. Free scan allowance cannot be verified automatically.",
        };
      }

      // 4. Unambiguously outside all paid subscription periods
      freeScansUsed += 1;
    }

    return {
      verified: true,
      ambiguous: false,
      freeScansUsed,
      error: null,
    };
  } catch (err) {
    console.warn("[subscriptionService] calculateOneTimeFreeScanUsage error:", err);
    return {
      verified: false,
      ambiguous: false,
      freeScansUsed: 0,
      error: "Unable to verify your historical free scan usage. Please check your connection and try again.",
    };
  }
}

/**
 * Centralized verification and lazy downgrade synchronization:
 * 1. Fetches user subscription and the Admin Free Plan configuration from Supabase.
 * 2. Checks if status === 'active' and current_period_end <= NOW().
 * 3. If expired:
 *    - Updates database: status = 'expired'
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
  const freePlanConfig = await fetchAdminFreePlanConfig();

  const freeFallback: UserSubscriptionInfo = {
    tier: "Free",
    tierLabel: freePlanConfig.plan?.name || "Free Plan",
    isPro: false,
    isExpired: false,
    status: "none",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    scanLimit: freePlanConfig.scanLimit,
    subscription: null,
    plan: freePlanConfig.plan,
    freePlanActive: freePlanConfig.isActive,
    freePlanVerified: freePlanConfig.verified,
    freePlanAmbiguous: freePlanConfig.ambiguous,
    freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
    freePlanDetails: freePlanConfig.plan,
    freePlanError: freePlanConfig.error,
    paidLimitVerified: false,
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
          scan_limit,
          description,
          plan_feature (
            feature_id,
            feature_text
          )
        )
      `)
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[subscriptionService] Query warning:", error.message);
      return {
        ...freeFallback,
        freePlanVerified: false,
        scanLimit: 0,
        freePlanError: "Unable to verify your subscription status. Please check your connection and try again.",
      };
    }

    if (!sub) {
      return freeFallback;
    }

    let planObj: any = Array.isArray(sub.plan) ? sub.plan[0] : sub.plan;
    if (!planObj && sub.plan_id) {
      const { data: directPlan } = await supabase
        .from("plan")
        .select(`
          plan_id,
          name,
          price,
          scan_limit,
          description,
          plan_feature (
            feature_id,
            feature_text
          )
        `)
        .eq("plan_id", sub.plan_id)
        .maybeSingle();
      if (directPlan) {
        planObj = directPlan;
      }
    }

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

      // 3. Insert Patient Notification into public.user_notification (Disabled: email-only expiration alerts)
      /*
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

      */
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
        tierLabel: freePlanConfig.plan?.name || "Free Plan",
        isPro: false,
        isExpired: true,
        status: "expired",
        currentPeriodStart: sub.current_period_start || null,
        currentPeriodEnd: periodEndRaw || null,
        scanLimit: freePlanConfig.scanLimit,
        subscription: sub,
        plan: planObj || freePlanConfig.plan,
        freePlanActive: freePlanConfig.isActive,
        freePlanVerified: freePlanConfig.verified,
        freePlanAmbiguous: freePlanConfig.ambiguous,
        freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
        freePlanDetails: freePlanConfig.plan,
        freePlanError: freePlanConfig.error,
        paidLimitVerified: false,
      };
    }

    // -------------------------------------------------------------------------
    // VALID SUBSCRIPTION CHECK
    // -------------------------------------------------------------------------
    const active = isSubscriptionActive(sub);
    const planName = planObj?.name || "Free Plan";
    const isProPlan =
      active &&
      (Number(planObj?.price ?? 0) > 0 || planObj?.scan_limit === -1);

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

      const resolvedPaidLimit = resolvePlanScanLimit(planObj?.scan_limit, -2);
      const paidLimitVerified = resolvedPaidLimit !== -2;

      return {
        tier: "Pro",
        tierLabel,
        isPro: true,
        isExpired: false,
        status: "active",
        currentPeriodStart: sub.current_period_start || sub.started_at || null,
        currentPeriodEnd: periodEndRaw || null,
        scanLimit: paidLimitVerified ? resolvedPaidLimit : 0,
        subscription: sub,
        plan: planObj,
        freePlanActive: freePlanConfig.isActive,
        freePlanVerified: freePlanConfig.verified,
        freePlanAmbiguous: freePlanConfig.ambiguous,
        freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
        freePlanDetails: freePlanConfig.plan,
        freePlanError: freePlanConfig.error,
        paidLimitVerified,
      };
    }

    const isSubExpired = isSubscriptionExpired(sub) || sub.status === "expired";

    // Otherwise resolves to Free Plan
    return {
      tier: "Free",
      tierLabel: freePlanConfig.plan?.name || "Free Plan",
      isPro: false,
      isExpired: isSubExpired,
      status: (sub.status as any) || "expired",
      currentPeriodStart: sub.current_period_start || null,
      currentPeriodEnd: periodEndRaw || null,
      scanLimit: freePlanConfig.scanLimit,
      subscription: sub,
      plan: planObj || freePlanConfig.plan,
      freePlanActive: freePlanConfig.isActive,
      freePlanVerified: freePlanConfig.verified,
      freePlanAmbiguous: freePlanConfig.ambiguous,
      freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
      freePlanDetails: freePlanConfig.plan,
      freePlanError: freePlanConfig.error,
      paidLimitVerified: false,
    };
  } catch (err) {
    console.error("[subscriptionService] Unexpected error in validateAndSyncSubscription:", err);
    return {
      ...freeFallback,
      freePlanVerified: false,
      scanLimit: 0,
      freePlanError: "Unable to verify your subscription status. Please check your connection and try again.",
    };
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
    paidAt?: string | number;
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

  // Guard against replayed or delayed payments overriding a user cancellation made after payment date
  const { data: existingSub } = await supabase
    .from("user_plan_subscription")
    .select("cancel_at_period_end, cancelled_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Client-side fail-safe guard: Do not allow browser to clear an active cancellation on an unverified client timestamp.
  // Authoritative cancellation clearing occurs strictly server-side through verify_payment_intent.
  const isNewerCancellation = Boolean(existingSub?.cancel_at_period_end);

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
    cancel_at_period_end: isNewerCancellation ? true : false,
    cancelled_at: isNewerCancellation ? (existingSub?.cancelled_at ?? null) : null,
    payment_method: options?.paymentMethod || "Online Payment",
    updated_at: new Date().toISOString(),
  };

  const { error: subErr } = await supabase
    .from("user_plan_subscription")
    .upsert(subscriptionRecord, { onConflict: "user_id" });

  if (subErr) {
    console.error("[upgradeSubscriptionToPro] Upsert error:", subErr.message);
    // Client-side RLS does not let a patient flip an existing expired/cancelled row to 'active'.
    // Never claim Pro (cache + events) when the row was not persisted; the caller falls back to
    // server-side fulfillment (paymongo-payment verify_payment_intent), identical for every method.
    throw new Error(`Subscription activation was not persisted: ${subErr.message}`);
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

  // 4. In-App Notification in public.user_notification disabled: receipts and payment confirmations are handled strictly via email.

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
    scanLimit: resolvePlanScanLimit(planRecord?.scan_limit, 3),
    subscription: subscriptionRecord,
    plan: planRecord,
  };
}
