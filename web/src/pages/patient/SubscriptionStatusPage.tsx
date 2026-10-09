import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";

interface PlanFeature {
  feature_id: string;
  feature_text: string;
}

interface PlanDetails {
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const [freePlan, setFreePlan] = useState<PlanDetails | null>(null);

  const [subscription, setSubscription] = useState<SubscriptionInfo>({
    isPro: false,
    planName: "Free Plan",
    planDescription: "",
    planFeatures: [],
    maxScans: DEFAULT_MAX_FREE_SCANS,
    scansUsed: 0,
    remainingDays: null,
  });

  const [billingHistory, setBillingHistory] =
    useState<BillingTransaction[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadSubscriptionStatus = async () => {
      setLoading(true);

      try {
        // ------------------------------------------------------------
        // 1. Fetch the Free Plan and its Admin-managed features
        // ------------------------------------------------------------
        const {
          data: freePlanData,
          error: freePlanError,
        } = await supabase
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

        if (freePlanError) {
          console.warn(
            "Free plan could not be loaded:",
            freePlanError.message
          );
        }

        if (isMounted && freePlanData) {
          setFreePlan(freePlanData as PlanDetails);
        }

        // ------------------------------------------------------------
        // 2. If no user is logged in, use the Admin Free Plan
        // ------------------------------------------------------------
        if (!user?.id) {
          if (isMounted) {
            const freePlan = freePlanData as PlanDetails | null;

            setSubscription({
              isPro: false,
              planName: freePlan?.name ?? "Free Plan",
              planDescription: freePlan?.description ?? "",
              planFeatures:
                freePlan?.plan_feature
                  ?.map((feature) => feature.feature_text)
                  .filter(Boolean) ?? [],
              maxScans:
                freePlan?.scan_limit === -1
                  ? Infinity
                  : freePlan?.scan_limit ?? DEFAULT_MAX_FREE_SCANS,
              scansUsed: 0,
              remainingDays: null,
            });

            setLoading(false);
          }

          return;
        }

        // ------------------------------------------------------------
        // 3. Fetch active subscription and its complete plan details
        // ------------------------------------------------------------
        const { data: subData, error: subError } = await supabase
          .from("user_plan_subscription")
          .select(`
            subscription_id,
            status,
            billing_cycle,
            renews_at,
            current_period_start,
            plan:plan_id (
              plan_id,
              name,
              description,
              scan_limit,
              plan_feature (
                feature_id,
                feature_text
              )
            )
          `)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();

        if (subError) {
          console.warn(
            "user_plan_subscription not available:",
            subError.message
          );
        }

        // ------------------------------------------------------------
        // 4. Determine billing-cycle start
        // ------------------------------------------------------------
        const cycleStart: string =
          (subData as any)?.current_period_start ||
          new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1
          ).toISOString();

        // ------------------------------------------------------------
        // 5. Count AI scans used during the current cycle
        // ------------------------------------------------------------
        const { count: usedScans, error: scanError } = await supabase
          .from("ai_scan_result")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "completed")
          .gte("scanned_at", cycleStart);

        if (scanError) {
          console.warn(
            "ai_scan_result not available:",
            scanError.message
          );
        }

        // ------------------------------------------------------------
        // 6. Fetch billing history
        // ------------------------------------------------------------
        const { data: payments, error: payError } = await supabase
          .from("user_payment")
          .select(
            "payment_id, payment_date, amount, status, plan:plan_id ( name )"
          )
          .eq("user_id", user.id)
          .order("payment_date", { ascending: false })
          .limit(10);

        if (payError) {
          console.warn(
            "user_payment not available:",
            payError.message
          );
        }

        if (!isMounted) return;

        // ------------------------------------------------------------
        // 7. Build the patient's current plan
        // ------------------------------------------------------------
        if (subData && !subError) {
          const planRaw: any = subData.plan;
          const plan = Array.isArray(planRaw)
            ? planRaw[0]
            : planRaw;

          const isPro = plan?.scan_limit === -1;

          const remainingDays = subData.renews_at
            ? Math.max(
                0,
                Math.ceil(
                  (new Date(subData.renews_at).getTime() -
                    Date.now()) /
                    86400000
                )
              )
            : null;

          const planFeatures: string[] =
            plan?.plan_feature
              ?.map((feature: PlanFeature) => feature.feature_text)
              .filter(Boolean) ?? [];

          setSubscription({
            isPro,
            planName: plan?.name ?? "Free Plan",
            planDescription: plan?.description ?? "",
            planFeatures,
            billingCycle:
              subData.billing_cycle as "monthly" | "yearly",
            renewsAt: subData.renews_at ?? undefined,
            remainingDays,
            maxScans:
              plan?.scan_limit === -1
                ? Infinity
                : plan?.scan_limit ?? DEFAULT_MAX_FREE_SCANS,
            scansUsed: usedScans ?? 0,
          });
        } else {
          // ----------------------------------------------------------
          // 8. No active subscription → use Admin Free Plan
          // ----------------------------------------------------------
          const freePlan = freePlanData as PlanDetails | null;

          setSubscription({
            isPro: false,
            planName: freePlan?.name ?? "Free Plan",
            planDescription: freePlan?.description ?? "",
            planFeatures:
              freePlan?.plan_feature
                ?.map((feature) => feature.feature_text)
                .filter(Boolean) ?? [],
            maxScans:
              freePlan?.scan_limit === -1
                ? Infinity
                : freePlan?.scan_limit ?? DEFAULT_MAX_FREE_SCANS,
            scansUsed: usedScans ?? 0,
            remainingDays: null,
          });
        }

        // ------------------------------------------------------------
        // 9. Format billing history
        // ------------------------------------------------------------
        if (!payError && payments) {
          setBillingHistory(
            payments.map((p: any) => {
              const planObj = Array.isArray(p.plan)
                ? p.plan[0]
                : p.plan;

              return {
                id: p.payment_id,
                date: new Date(
                  p.payment_date
                ).toLocaleDateString("en-PH", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }),
                description:
                  planObj?.name ?? "Plan Payment",
                amount: `₱${Number(
                  p.amount
                ).toLocaleString()}`,
                status:
                  (p.status === "success"
                    ? "paid"
                    : p.status === "failed"
                    ? "failed"
                    : "pending") as BillingTransaction["status"],
              };
            })
          );
        }
      } catch (err) {
        console.error(
          "Failed to load subscription status:",
          err
        );
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
  }, [user]);

  const {
    isPro,
    planName,
    planDescription,
    planFeatures,
    maxScans,
    scansUsed,
    remainingDays,
  } = subscription;

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

  // Use the fetched Free Plan as a fallback while the subscription
  // information is being displayed.
  const displayedFeatures =
    planFeatures.length > 0
      ? planFeatures
      : !isPro && freePlan?.plan_feature
      ? freePlan.plan_feature
          .map((feature) => feature.feature_text)
          .filter(Boolean)
      : [];

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

            <p className="text-xs text-gray-500 mb-3 font-medium">
              {isPro
                ? remainingDays !== null &&
                  remainingDays !== undefined
                  ? `${remainingDays} days remaining`
                  : "Active Subscription"
                : "Free access"}
            </p>

            {/* Admin-managed plan description */}
            {planDescription && (
              <p className="text-xs text-gray-500 leading-relaxed max-w-sm mb-5">
                {planDescription}
              </p>
            )}

            {/* Admin-managed plan features */}
            <div className="w-full space-y-3 text-left mb-8 pt-4 border-t border-gray-100">
              {displayedFeatures.length > 0 ? (
                displayedFeatures.map((feature, index) => (
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
                    {loading
                      ? "Loading..."
                      : isPro
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

              {!isPro &&
                scansRemaining <= 0 &&
                !loading && (
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex gap-3 text-xs">

                    <p className="text-amber-800 leading-relaxed">
                      You've reached your limit for free AI scans.
                      Upgrade to Pro for unlimited scans and
                      priority booking.
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
      </div>
    </div>
  );
}

