import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
  validateAndSyncSubscription,
  fetchAdminFreePlanConfig,
  calculateOneTimeFreeScanUsage,
  countPaidPeriodScans,
} from "@/lib/subscriptionService";

interface PlanFeature {
  feature_id: string;
  feature_text: string;
}

export interface PlanDetails {
  plan_id: string;
  name: string;
  description: string;
  scan_limit: number;
  plan_feature: PlanFeature[];
}

interface SubscriptionInfo {
  isPro: boolean;
  isExpired?: boolean;
  planName: string;
  planDescription?: string;
  planFeatures: string[];
  billingCycle?: "monthly" | "yearly";
  renewsAt?: string;
  remainingDays?: number | null;
  cancelAtPeriodEnd?: boolean;
  maxScans: number;
  configuredMaxScans?: number;
  scansUsed: number;
  freePlanActive?: boolean;
  freePlanVerified?: boolean;
  freePlanAmbiguous?: boolean;
  usageVerified?: boolean;
  statusMessage?: string | null;
}

/**
 * Conservatively resolves a plan's scan_limit:
 * - -1 explicitly represents Unlimited (Infinity)
 * - >= 0 represents a finite scan limit (0, 3, 5, 10, etc.)
 * - null, undefined, or invalid values fall back to `fallback` (default 0) and never assume Unlimited.
 */
function resolveMaxScans(rawLimit: unknown, fallback = 0): number {
  if (rawLimit === null || rawLimit === undefined || rawLimit === "") {
    return fallback;
  }
  const num = Number(rawLimit);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num === -1) {
    return Infinity;
  }
  if (num >= 0) {
    return Math.floor(num);
  }
  return fallback;
}

export default function SubscriptionStatusPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!loading) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [loading]);

  useEffect(() => {
    let isMounted = true;

    // Wait until auth is resolved to avoid false unauthenticated state
    if (authLoading) return;

    const loadSubscriptionStatus = async () => {
      setLoading(true);

      try {
        if (!user?.id) {
          const freePlanConfig = await fetchAdminFreePlanConfig();
          if (!isMounted) return;

          const configuredMax = resolveMaxScans(freePlanConfig.configuredScanLimit, 0);
          const effectiveMax =
            freePlanConfig.verified && freePlanConfig.isActive
              ? resolveMaxScans(freePlanConfig.scanLimit, 0)
              : 0;

          setSubscription({
            isPro: false,
            planName: freePlanConfig.plan?.name ?? "Free Plan",
            planDescription: freePlanConfig.plan?.description ?? "",
            planFeatures: freePlanConfig.features,
            maxScans: effectiveMax,
            configuredMaxScans: configuredMax,
            scansUsed: 0,
            remainingDays: null,
            cancelAtPeriodEnd: false,
            freePlanActive: freePlanConfig.isActive,
            freePlanVerified: freePlanConfig.verified,
            freePlanAmbiguous: freePlanConfig.ambiguous,
            usageVerified: freePlanConfig.verified,
            statusMessage: freePlanConfig.error,
          });

          return;
        }

        // Dynamically validate, expire and synchronize the patient's subscription
        const subInfo = await validateAndSyncSubscription(user.id);
        if (!isMounted) return;

        const subData = subInfo.subscription;
        const plan = subInfo.plan;
        const isPro = subInfo.isPro;
        const periodEndRaw = subInfo.currentPeriodEnd;
        const periodEnd = periodEndRaw ? new Date(periodEndRaw) : null;

        // Active Paid Subscription Branch (independent of Free Plan status)
        if (isPro && plan) {
          const cycleStart = subData?.current_period_start || subData?.started_at || null;
          const paidUsage = await countPaidPeriodScans(
            user.id,
            cycleStart,
            subInfo.currentPeriodEnd
          );
          if (!isMounted) return;

          const remainingDays = periodEnd
            ? Math.max(
                0,
                Math.ceil((periodEnd.getTime() - Date.now()) / 86400000)
              )
            : null;

          const renewsAtFormatted = periodEnd
            ? periodEnd.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : undefined;

          const resolvedPlanMaxScans =
            plan.scan_limit === -1
              ? Infinity
              : subInfo.paidLimitVerified !== false
              ? resolveMaxScans(plan.scan_limit, 0)
              : 0;

          let planFeatures: string[] = Array.isArray(plan.plan_feature)
            ? plan.plan_feature
                .map((feature: any) => feature.feature_text)
                .filter(Boolean)
            : [];

          // Also query directly by plan_id if not included in join
          if (planFeatures.length === 0 && (plan.plan_id || subData?.plan_id)) {
            const pid = plan.plan_id || subData?.plan_id;
            const { data: pfRows } = await supabase
              .from("plan_feature")
              .select("feature_text")
              .eq("plan_id", pid);
            if (pfRows && pfRows.length > 0) {
              planFeatures = pfRows.map((f: any) => f.feature_text).filter(Boolean);
            }
          }

          // Fallback features aligned with actual configured scan_limit
          if (planFeatures.length === 0) {
            planFeatures = [
              resolvedPlanMaxScans === Infinity
                ? "Unlimited AI Skin Scans"
                : `${resolvedPlanMaxScans} AI Skin ${resolvedPlanMaxScans === 1 ? "Scan" : "Scans"} per billing cycle`,
              "Unlimited Nearby Clinic Suggestions",
              "Unlimited AI Skin Analysis Results",
              "Access to Clinic Directory",
            ];
          }

          const isUnlimitedPaid = resolvedPlanMaxScans === Infinity;
          const paidVerified =
            isUnlimitedPaid || (subInfo.paidLimitVerified !== false && paidUsage.verified);

          setSubscription({
            isPro: true,
            planName: plan.name ?? "Pro",
            planDescription: plan.description ?? "",
            planFeatures,
            billingCycle: (subData?.billing_cycle as "monthly" | "yearly") || "monthly",
            renewsAt: renewsAtFormatted,
            remainingDays,
            cancelAtPeriodEnd: Boolean(
              subData?.cancel_at_period_end || subData?.status === "cancelling"
            ),
            maxScans: resolvedPlanMaxScans,
            configuredMaxScans: resolvedPlanMaxScans,
            scansUsed: paidUsage.scansUsed,
            freePlanActive: true,
            freePlanVerified: true,
            freePlanAmbiguous: false,
            usageVerified: paidVerified,
            statusMessage: paidVerified ? null : paidUsage.error,
          });
        } else {
          // Free or Expired Subscription Branch (controlled by Admin Free Plan)
          const freeUsage = await calculateOneTimeFreeScanUsage(user.id);
          if (!isMounted) return;

          const freePlanData = subInfo.freePlanDetails;
          const freePlanVerified = subInfo.freePlanVerified === true;
          const freePlanAmbiguous = Boolean(subInfo.freePlanAmbiguous || freeUsage.ambiguous);
          const freePlanActive = freePlanVerified && subInfo.freePlanActive === true;
          const configuredFreeMaxScans = resolveMaxScans(
            subInfo.freePlanConfiguredLimit,
            0
          );
          const effectiveFreeMaxScans = freePlanActive
            ? resolveMaxScans(subInfo.scanLimit, 0)
            : 0;

          let freeFeatures = Array.isArray(freePlanData?.plan_feature)
            ? freePlanData.plan_feature
                .map((feature: any) => feature.feature_text)
                .filter(Boolean)
            : [];

          if (freeFeatures.length === 0 && freePlanVerified && freePlanActive) {
            freeFeatures = [
              effectiveFreeMaxScans === Infinity
                ? "Unlimited AI Skin Scans"
                : `${effectiveFreeMaxScans} One-Time Free AI Skin ${effectiveFreeMaxScans === 1 ? "Scan" : "Scans"}`,
              "Limited Nearby Clinic Suggestions",
              "Limited AI Skin Analysis Results",
              "Access to Clinic Directory",
            ];
          }

          setSubscription({
            isPro: false,
            isExpired: subInfo.isExpired,
            planName: freePlanData?.name || "Free Plan",
            planDescription: freePlanData?.description ?? "",
            planFeatures: freeFeatures,
            maxScans: effectiveFreeMaxScans,
            configuredMaxScans: configuredFreeMaxScans,
            scansUsed: freeUsage.freeScansUsed,
            remainingDays: null,
            cancelAtPeriodEnd: false,
            freePlanActive,
            freePlanVerified,
            freePlanAmbiguous,
            usageVerified: freePlanVerified && freeUsage.verified && !freePlanAmbiguous,
            statusMessage: subInfo.freePlanError || freeUsage.error,
          });
        }
      } catch (err) {
        console.error("Failed to load subscription status:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadSubscriptionStatus();

    const handleSubUpdated = () => {
      loadSubscriptionStatus();
    };

    window.addEventListener("dermai_subscription_updated", handleSubUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener("dermai_subscription_updated", handleSubUpdated);
    };
  }, [user, authLoading]);

  const isPro = subscription?.isPro ?? false;
  const rawPlanName = subscription?.planName ?? "Free Plan";
  // Clean up "Pro Plan" to "Pro" if applicable to match the sleek design in photo
  const planName = isPro && rawPlanName.toLowerCase().includes("pro") ? "Pro" : rawPlanName;
  const planFeatures = subscription?.planFeatures ?? [];
  const maxScans = subscription?.maxScans ?? 0;
  const scansUsed = subscription?.scansUsed ?? 0;
  const remainingDays = subscription?.remainingDays ?? null;
  const renewsAt = subscription?.renewsAt;
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd ?? false;
  const freePlanActive = Boolean(subscription?.freePlanActive);
  const freePlanVerified = subscription?.freePlanVerified !== false;
  const freePlanAmbiguous = Boolean(subscription?.freePlanAmbiguous);
  const usageVerified = subscription?.usageVerified !== false;
  const statusMessage = subscription?.statusMessage ?? null;
  const isAdminDeactivated = !isPro && freePlanVerified && !freePlanActive && !freePlanAmbiguous;
  const isAmbiguousConfig = !isPro && freePlanAmbiguous;

  const isUnlimited = maxScans === Infinity;
  const scansRemaining = isUnlimited
    ? Infinity
    : Math.max(0, maxScans - scansUsed);

  const remainingPercentage =
    isUnlimited
      ? 100
      : maxScans > 0
        ? Math.min(
            100,
            Math.round((scansRemaining / maxScans) * 100)
          )
        : 0;

  return (
    <div className="min-h-screen bg-patient-bg text-gray-900 pt-8 pb-20 px-4 font-sans antialiased">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Subscription Status
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your plan and usage limits
          </p>
        </div>

        {loading || !subscription ? (
          <div className="grid gap-6 md:grid-cols-2 items-start">
            {/* Current Plan Card Skeleton */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs animate-pulse">
              <div className="h-3 w-16 bg-gray-100 rounded mb-2" />
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-24 bg-gray-200 rounded-lg" />
                <div className="h-5 w-16 bg-gray-100 rounded-full" />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-gray-50/60 rounded-2xl p-4 border border-gray-100">
                  <div className="h-3 w-14 bg-gray-100 rounded mb-2" />
                  <div className="h-5 w-20 bg-gray-200 rounded" />
                </div>
                <div className="bg-gray-50/60 rounded-2xl p-4 border border-gray-100">
                  <div className="h-3 w-18 bg-gray-100 rounded mb-2" />
                  <div className="h-5 w-24 bg-gray-200 rounded" />
                </div>
              </div>

              <div className="h-4 w-28 bg-gray-100 rounded mb-3" />
              <div className="rounded-2xl border border-dashed border-gray-200 p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gray-100 shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-40 bg-gray-100 rounded" />
                  <div className="h-3 w-56 bg-gray-100 rounded" />
                </div>
              </div>
            </div>

            {/* Plan Usage Card Skeleton */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs animate-pulse">
              <div className="h-6 w-28 bg-gray-200 rounded-lg mb-6" />

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="h-4 w-24 bg-gray-200 rounded" />
                  <div className="h-6 w-24 bg-gray-100 rounded-full" />
                </div>
                <div className="h-3.5 w-full bg-gray-100 rounded-full" />
                <div className="h-3 w-56 bg-gray-100 rounded mt-3" />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 items-start">
            {/* Left Card: Your Plan */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs flex flex-col"
            >
              {/* Top Header: Your Plan & Status Badge */}
              <span className="text-xs text-gray-500 font-medium">Your plan</span>
              <div className="flex items-center gap-2.5 mt-1">
                <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">
                  {planName}
                </h2>
                <span
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-semibold",
                    isPro
                      ? cancelAtPeriodEnd
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      : subscription?.isExpired
                      ? "bg-rose-50 text-rose-600 border border-rose-100"
                      : isAdminDeactivated || isAmbiguousConfig
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : !usageVerified
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-gray-100 text-gray-600 border border-gray-200"
                  )}
                >
                  {isPro
                    ? cancelAtPeriodEnd
                      ? "Cancelling"
                      : "Active"
                    : subscription?.isExpired
                    ? "Expired"
                    : isAdminDeactivated || isAmbiguousConfig
                    ? "Unavailable"
                    : !usageVerified
                    ? "Verification required"
                    : "Active"}
                </span>
              </div>

              {/* Two Mini Cards: Time Left & Next Renewal */}
              <div className="grid grid-cols-2 gap-3 mt-6">
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-2xs">
                  <span className="text-xs text-gray-500 block mb-1 font-medium">Time left</span>
                  <span className="text-xl font-bold text-gray-900 block">
                    {isPro && remainingDays !== null && remainingDays !== undefined
                      ? `${remainingDays} ${remainingDays === 1 ? "day" : "days"}`
                      : isPro
                      ? "Active"
                      : subscription?.isExpired
                      ? "0 days"
                      : isAdminDeactivated || isAmbiguousConfig
                      ? "Unavailable"
                      : !usageVerified
                      ? "Verify"
                      : "One-time"}
                  </span>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-2xs">
                  <span className="text-xs text-gray-500 block mb-1 font-medium">Next renewal</span>
                  <span className="text-xl font-bold text-gray-900 truncate block">
                    {renewsAt || (isPro ? "Auto-renew" : "N/A")}
                  </span>
                </div>
              </div>

              {/* What's included */}
              <div className="mt-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2.5">
                  What's included
                </h3>

                {planFeatures.length > 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/40 p-4 space-y-2.5">
                    {planFeatures.map((feature, index) => (
                      <div
                        key={`${feature}-${index}`}
                        className="flex items-center gap-2.5 text-xs sm:text-sm text-gray-700"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="font-medium text-gray-800">{feature}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/40 p-4 flex items-center gap-3.5">
                    <div className="w-8 h-8 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center shrink-0 text-pink-600">
                      <Check className="w-4 h-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-gray-900">
                        {isAdminDeactivated
                          ? "Free AI skin scanning is currently unavailable."
                          : isAmbiguousConfig
                          ? "Free AI skin scanning is temporarily unavailable."
                          : !isPro && !usageVerified
                          ? "Unable to verify your scan allowance."
                          : "No plan features configured."}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {isAdminDeactivated
                          ? "Please view the available subscription plans to continue scanning."
                          : isAmbiguousConfig
                          ? "Plan configuration requires administrator review."
                          : !isPro && !usageVerified
                          ? "Please check your internet connection and try again."
                          : "Features of your plan will be listed here."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button: Upgrade for Free/Expired, Manage Subscription for Pro */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                {isPro ? (
                  <Link
                    to="/dashboard/settings/billing"
                    className="w-full py-3 bg-magenta-600 text-white rounded-xl font-bold text-sm hover:bg-magenta-700 transition-all shadow-sm text-center block active:scale-[0.98]"
                  >
                    Manage Subscription
                  </Link>
                ) : (
                  <Link
                    to="/dashboard/upgrade"
                    className="w-full py-3 bg-magenta-600 text-white rounded-xl font-bold text-sm hover:bg-magenta-700 transition-all shadow-sm text-center block active:scale-[0.98]"
                  >
                    {subscription?.isExpired ? "Renew / Upgrade to Pro" : "Upgrade to Pro"}
                  </Link>
                )}
              </div>
            </motion.div>

            {/* Right Card: Plan usage */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs flex flex-col"
            >
              <h2 className="text-lg font-bold text-gray-900 mb-6">
                Plan usage
              </h2>

              <div className="space-y-3">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    AI skin scans
                  </span>

                  {isAdminDeactivated || isAmbiguousConfig ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                      <span>Unavailable</span>
                    </span>
                  ) : !usageVerified && !isUnlimited ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200">
                      <span>Verification required</span>
                    </span>
                  ) : isUnlimited ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-50 text-pink-700 text-xs font-semibold border border-pink-100">
                      <span className="text-sm leading-none font-bold">∞</span>
                      <span>Unlimited</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200">
                      <span>
                        Limited — {maxScans} {maxScans === 1 ? "scan" : "scans"}
                      </span>
                    </span>
                  )}
                </div>

                {isAdminDeactivated ? (
                  <div className="space-y-3 pt-1">
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs text-amber-800 leading-relaxed">
                      <p>
                        Free AI skin scanning is currently unavailable. Please view the available subscription plans to continue scanning.
                      </p>
                      {scansUsed > 0 && (
                        <p className="mt-2 font-medium text-amber-900">
                          Your historical scan records ({scansUsed} completed free{" "}
                          {scansUsed === 1 ? "scan" : "scans"}) are safely preserved.
                        </p>
                      )}
                    </div>
                  </div>
                ) : isAmbiguousConfig ? (
                  <div className="space-y-3 pt-1">
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs text-amber-800 leading-relaxed">
                      <p>
                        {statusMessage ||
                          "Free AI skin scanning is temporarily unavailable due to a plan configuration issue."}
                      </p>
                    </div>
                  </div>
                ) : !usageVerified && !isUnlimited ? (
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-xs text-rose-800 leading-relaxed mt-2">
                    <p>
                      Unable to verify your scan allowance. Please check your internet connection and try again.
                    </p>
                  </div>
                ) : isUnlimited ? (
                  <>
                    {/* Striped Magenta Progress Bar */}
                    <div className="h-3.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${remainingPercentage}%`,
                          background:
                            "repeating-linear-gradient(45deg, #831843, #831843 6px, #9d174d 6px, #9d174d 12px)",
                        }}
                      />
                    </div>

                    <p className="text-xs text-gray-500 font-normal pt-1">
                      Your {planName} plan has no limit on AI skin scans.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs font-medium text-gray-700 pt-0.5">
                      <span>
                        {scansUsed} / {maxScans} {maxScans === 1 ? "scan" : "scans"} used
                      </span>
                      <span className="font-semibold text-gray-900">
                        {scansRemaining} {scansRemaining === 1 ? "scan" : "scans"} remaining
                      </span>
                    </div>

                    {/* Striped Magenta Progress Bar */}
                    <div className="h-3.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${remainingPercentage}%`,
                          background:
                            "repeating-linear-gradient(45deg, #831843, #831843 6px, #9d174d 6px, #9d174d 12px)",
                        }}
                      />
                    </div>

                    {/* Subtext */}
                    <p className="text-xs text-gray-500 font-normal pt-1">
                      {isPro
                        ? `You have used ${scansUsed} of ${maxScans} AI skin ${maxScans === 1 ? "scan" : "scans"} in your current ${planName} billing cycle.`
                        : `You have used ${scansUsed} of ${maxScans} one-time free AI skin ${maxScans === 1 ? "scan" : "scans"}.`}
                    </p>

                    {scansRemaining <= 0 && (
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex gap-3 text-xs mt-4">
                        <p className="text-amber-800 leading-relaxed">
                          {isPro
                            ? `You've reached your limit of ${maxScans} AI ${maxScans === 1 ? "scan" : "scans"} for your current ${planName} billing cycle. Upgrade your plan for additional or unlimited scans.`
                            : "You have used all your available free AI skin scans. Please subscribe to continue scanning."}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
