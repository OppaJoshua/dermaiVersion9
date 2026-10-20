import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { withVat } from "@/lib/vat";

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
  planName: string;
  planDescription?: string;
  planFeatures: string[];
  billingCycle?: "monthly" | "yearly";
  renewsAt?: string;
  remainingDays?: number | null;
  cancelAtPeriodEnd?: boolean;
  maxScans: number;
  scansUsed: number;
}

interface BillingTransaction {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: "paid" | "pending" | "failed";
}

const DEFAULT_MAX_FREE_SCANS = 3;

export default function SubscriptionStatusPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [billingHistory, setBillingHistory] =
    useState<BillingTransaction[]>([]);

  useEffect(() => {
    let isMounted = true;

    // Wait until auth is resolved to avoid false unauthenticated state
    if (authLoading) return;

    const loadSubscriptionStatus = async () => {
      setLoading(true);

      try {
        if (!user?.id) {
          // If no user is logged in, fetch the active Free Plan
          const { data: freePlanData } = await supabase
            .from("plan")
            .select(`
              plan_id,
              name,
              description,
              scan_limit,
              plan_feature (
                feature_id,
                feature_text
              )
            `)
            .or("price.eq.0,name.ilike.Free")
            .limit(1)
            .maybeSingle();

          if (!isMounted) return;

          const freeFeatures = Array.isArray(freePlanData?.plan_feature)
            ? freePlanData.plan_feature
                .map((feature: any) => feature.feature_text)
                .filter(Boolean)
            : [];

          setSubscription({
            isPro: false,
            planName: freePlanData?.name ?? "Free Plan",
            planDescription: freePlanData?.description ?? "",
            planFeatures: freeFeatures,
            maxScans:
              freePlanData?.scan_limit === -1
                ? Infinity
                : freePlanData?.scan_limit ?? DEFAULT_MAX_FREE_SCANS,
            scansUsed: 0,
            remainingDays: null,
            cancelAtPeriodEnd: false,
          });
          setBillingHistory([]);
          return;
        }

        // Parallel fetch free plan, active subscription, and billing history
        const [freePlanRes, subRes, payRes] = await Promise.all([
          supabase
            .from("plan")
            .select(`
              plan_id,
              name,
              description,
              scan_limit,
              plan_feature (
                feature_id,
                feature_text
              )
            `)
            .or("price.eq.0,name.ilike.Free")
            .limit(1)
            .maybeSingle(),

          supabase
            .from("user_plan_subscription")
            .select(`
              subscription_id,
              started_at,
              status,
              billing_cycle,
              renews_at,
              current_period_start,
              current_period_end,
              cancel_at_period_end,
              plan:plan_id (
                plan_id,
                name,
                price,
                description,
                scan_limit,
                plan_feature (
                  feature_id,
                  feature_text
                )
              )
            `)
            .eq("user_id", user.id)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),

          supabase
            .from("user_payment")
            .select(
              "payment_id, payment_date, amount, status, plan:plan_id ( name, price )"
            )
            .eq("user_id", user.id)
            .order("payment_date", { ascending: false })
            .limit(10),
        ]);

        if (!isMounted) return;

        const subData = subRes.data;
        const planRaw: any = subData?.plan;
        const plan = Array.isArray(planRaw) ? planRaw[0] : planRaw;

        const periodEndRaw = subData?.current_period_end || subData?.renews_at;
        const periodEnd = periodEndRaw ? new Date(periodEndRaw) : null;

        const paidPeriodValid = Boolean(
          (subData?.status === "active" ||
            subData?.status === "cancelling" ||
            subData?.status === "pending_downgrade") &&
            periodEnd !== null &&
            periodEnd.getTime() > Date.now()
        );

        const isPro = Boolean(
          subData &&
            plan &&
            paidPeriodValid &&
            (Number(plan.price) > 0 ||
              plan.scan_limit === -1 ||
              plan.name?.toLowerCase().includes("pro"))
        );

        // Determine cycleStart for AI scans
        const cycleStart: string =
          isPro && paidPeriodValid
            ? subData?.current_period_start ||
              subData?.started_at ||
              new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
              ).toISOString()
            : new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
              ).toISOString();

        // Fetch AI scans used in this cycle
        const { count: usedScans } = await supabase
          .from("ai_scan_result")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "completed")
          .gte("scanned_at", cycleStart);

        if (!isMounted) return;

        // Map billing transactions
        const formattedPayments: BillingTransaction[] = (
          payRes.data || []
        ).map((p: any) => {
          const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
          const rawAmount = Number(p.total_amount ?? p.amount_paid ?? p.amount ?? 0);

          let resolvedTotal = rawAmount;
          if (p.total_amount != null && Number(p.total_amount) > 0) {
            resolvedTotal = Number(p.total_amount);
          } else if (p.amount_paid != null && Number(p.amount_paid) > 0) {
            resolvedTotal = Number(p.amount_paid);
          } else if (planObj?.price != null && Number(planObj.price) > 0) {
            resolvedTotal = withVat(Number(planObj.price));
          } else if (rawAmount === 177.68) {
            resolvedTotal = 199.00;
          }

          return {
            id: p.payment_id,
            date: new Date(p.payment_date).toLocaleDateString("en-PH", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            description: planObj?.name ?? "Plan Payment",
            amount: `₱${resolvedTotal.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
            status: (p.status === "success"
              ? "paid"
              : p.status === "failed"
              ? "failed"
              : "pending") as BillingTransaction["status"],
          };
        });

        // Atomically set the resolved subscription state
        if (isPro && plan) {
          const remainingDays = periodEnd
            ? Math.max(
                0,
                Math.ceil(
                  (periodEnd.getTime() - Date.now()) / 86400000
                )
              )
            : null;

          const renewsAtFormatted = periodEnd
            ? periodEnd.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : undefined;

          const planFeatures: string[] = Array.isArray(plan.plan_feature)
            ? plan.plan_feature
                .map((feature: any) => feature.feature_text)
                .filter(Boolean)
            : [];

          setSubscription({
            isPro: true,
            planName: plan.name ?? "Pro Plan",
            planDescription: plan.description ?? "",
            planFeatures,
            billingCycle: (subData?.billing_cycle as "monthly" | "yearly") || "monthly",
            renewsAt: renewsAtFormatted,
            remainingDays,
            cancelAtPeriodEnd: Boolean(
              subData?.cancel_at_period_end || subData?.status === "cancelling"
            ),
            maxScans:
              plan.scan_limit === -1
                ? Infinity
                : plan.scan_limit ?? Infinity,
            scansUsed: usedScans ?? 0,
          });
        } else {
          const freePlanData = freePlanRes.data;
          const freeFeatures = Array.isArray(freePlanData?.plan_feature)
            ? freePlanData.plan_feature
                .map((feature: any) => feature.feature_text)
                .filter(Boolean)
            : [];

          setSubscription({
            isPro: false,
            planName: freePlanData?.name ?? "Free Plan",
            planDescription: freePlanData?.description ?? "",
            planFeatures: freeFeatures,
            maxScans:
              freePlanData?.scan_limit === -1
                ? Infinity
                : freePlanData?.scan_limit ?? DEFAULT_MAX_FREE_SCANS,
            scansUsed: usedScans ?? 0,
            remainingDays: null,
            cancelAtPeriodEnd: false,
          });
        }

        setBillingHistory(formattedPayments);
      } catch (err) {
        console.error("Failed to load subscription status:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadSubscriptionStatus();

    return () => {
      isMounted = false;
    };
  }, [user, authLoading]);

  const isPro = subscription?.isPro ?? false;
  const planName = subscription?.planName ?? "Free Plan";
  const planDescription = subscription?.planDescription;
  const planFeatures = subscription?.planFeatures ?? [];
  const maxScans = subscription?.maxScans ?? DEFAULT_MAX_FREE_SCANS;
  const scansUsed = subscription?.scansUsed ?? 0;
  const remainingDays = subscription?.remainingDays ?? null;
  const renewsAt = subscription?.renewsAt;
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd ?? false;

  const scansRemaining = isPro
    ? 999
    : Math.max(0, maxScans - scansUsed);

  const remainingPercentage =
    isPro || maxScans === Infinity
      ? 100
      : maxScans > 0
      ? Math.min(
          100,
          Math.round((scansRemaining / maxScans) * 100)
        )
      : 0;

  return (
    <div className="min-h-screen bg-white text-gray-900 pt-8 pb-20 px-4 font-sans antialiased">
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
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs flex flex-col items-center text-center animate-pulse">
              <div className="h-7 w-32 bg-gray-200 rounded-lg mb-2" />
              <div className="h-4 w-24 bg-gray-100 rounded mb-4" />
              <div className="h-3.5 w-64 max-w-full bg-gray-100 rounded mb-2" />
              <div className="h-3.5 w-48 max-w-full bg-gray-100 rounded mb-6" />

              <div className="w-full space-y-3.5 pt-4 border-t border-gray-100 mb-8">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-gray-200 shrink-0" />
                    <div
                      className="h-3 bg-gray-100 rounded"
                      style={{ width: `${55 + ((i * 13) % 35)}%` }}
                    />
                  </div>
                ))}
              </div>

              <div className="w-full h-11 bg-gray-100 rounded-full" />
            </div>

            {/* Plan Usage Card Skeleton */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs animate-pulse">
              <div className="h-6 w-32 bg-gray-200 rounded-lg mb-6" />

              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <div className="h-3.5 w-24 bg-gray-200 rounded" />
                    <div className="h-3.5 w-32 bg-gray-100 rounded" />
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full" />
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-4 w-28 bg-gray-200 rounded" />
                    <div className="h-3 w-16 bg-gray-100 rounded" />
                  </div>
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-14 rounded-2xl bg-gray-50 border border-gray-100"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 items-start">
            {/* Current Plan Card */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs flex flex-col items-center text-center"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                {planName}
              </h2>

              <p className="text-xs text-gray-500 mb-1 font-medium">
                {isPro
                  ? remainingDays !== null && remainingDays !== undefined
                    ? `${remainingDays} ${remainingDays === 1 ? "day" : "days"} remaining`
                    : "Active Subscription"
                  : "Free access"}
              </p>

              {isPro && renewsAt && (
                <p className="text-[11px] text-gray-400 mb-3">
                  {cancelAtPeriodEnd
                    ? `Access ends on ${renewsAt}`
                    : `Next renewal: ${renewsAt}`}
                </p>
              )}

              {/* Admin-managed plan description */}
              {planDescription && (
                <p className="text-xs text-gray-500 leading-relaxed max-w-sm mb-5">
                  {planDescription}
                </p>
              )}

              {/* Admin-managed plan features */}
              <div className="w-full space-y-3 text-left mb-8 pt-4 border-t border-gray-100">
                {planFeatures.length > 0 ? (
                  planFeatures.map((feature, index) => (
                    <div
                      key={`${feature}-${index}`}
                      className="flex items-center gap-3 text-xs text-gray-700"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    No plan features configured.
                  </p>
                )}
              </div>

              {!isPro && (
                <Link
                  to="/dashboard/upgrade"
                  className="w-full py-3 bg-magenta-600 text-white rounded-full font-semibold text-sm hover:bg-magenta-700 transition-all shadow-sm text-center active:scale-[0.98]"
                >
                  Upgrade to Pro
                </Link>
              )}
            </motion.div>

            {/* Usage Card */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-xs"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                Plan Usage
              </h2>

              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-xs font-semibold text-gray-700">
                      AI Skin Scans
                    </span>

                    <span className="text-xs text-gray-500 font-medium">
                      {isPro
                        ? "Unlimited"
                        : `${scansRemaining} remaining (${scansUsed}/${maxScans} used)`}
                    </span>
                  </div>

                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-magenta-600 rounded-full transition-all duration-500"
                      style={{
                        width: `${remainingPercentage}%`,
                      }}
                    />
                  </div>
                </div>

                {!isPro && scansRemaining <= 0 && (
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex gap-3 text-xs">
                    <p className="text-amber-800 leading-relaxed">
                      You've reached your limit for free AI scans. Upgrade to Pro
                      for unlimited scans and priority booking.
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                      Billing History
                    </h3>

                    {billingHistory.length > 0 && (
                      <span className="text-[11px] text-gray-400 font-medium">
                        {billingHistory.length} transaction
                        {billingHistory.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {billingHistory.length > 0 ? (
                    <div className="space-y-2">
                      {billingHistory.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 border border-gray-100 text-xs"
                        >
                          <div>
                            <p className="font-semibold text-gray-900">
                              {item.description}
                            </p>

                            <p className="text-gray-400 text-[11px]">
                              {item.date}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="font-bold text-gray-900">
                              {item.amount}
                            </p>

                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                item.status === "paid"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-gray-100 text-gray-600 border border-gray-200"
                              }`}
                            >
                              {item.status.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">
                      No recent transactions found.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

