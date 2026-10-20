import { useState, useEffect, useCallback } from "react";
import { Calendar, CalendarDays, CheckCircle2, CreditCard, XCircle, X, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { withVat, splitVat, calculatePricing } from "@/lib/vat";
import { validateAndSyncSubscription } from "@/lib/subscriptionService";
import { cn } from "@/lib/utils";

interface SubData {
  isPro: boolean;
  isExpired?: boolean;
  status?: "active" | "expired" | "cancelled" | "free";
  planName?: string;
  billingCycle?: "monthly" | "yearly";
  renewsAt?: string;
  price?: string;
  subscriptionId?: string;
  description?: string;
  features?: string[];
  scanLimit?: number | null;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

interface BillingHistoryItem {
  paymentId: string;
  paymentDate: string;
  date: string;
  amount: string;
  rawAmount: number;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  method: string;
  status: string;
}

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubData>({ isPro: false });

  const [freePlan, setFreePlan] = useState<SubData>({
  isPro: false,
  planName: "Free Plan",
  description: "",
  features: [],
  scanLimit: 3,
});

  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<BillingHistoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);


  const loadBillingData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
  setLoading(true);

  // 1. Load Free Plan details
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
    .eq("price", 0)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (freePlanData) {
    const features = Array.isArray(freePlanData.plan_feature)
      ? freePlanData.plan_feature
          .map((feature: any) => feature.feature_text)
          .filter(Boolean)
      : [];

    setFreePlan({
      isPro: false,
      planName: freePlanData.name || "Free Plan",
      description: freePlanData.description || "",
      features,
      scanLimit:
        freePlanData.scan_limit === -1
          ? null
          : freePlanData.scan_limit,
    });
  }
      // 2. Dynamically validate, expire and synchronize the patient's subscription
      const subInfo = await validateAndSyncSubscription(user.id);

      // Load the patient's active subscription details
      const { data: activeSubscription } = await supabase
        .from("user_plan_subscription")
        .select(`
          subscription_id,
          started_at,
          renews_at,
          status,
          current_period_end,
          cancel_at_period_end,
          billing_cycle,
          payment_method,
          payment_full_name,
          payment_email,
          billing_address,
          payment_mobile_number,
          plan:plan_id (
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
        .maybeSingle();

      const plan = Array.isArray(activeSubscription?.plan)
        ? activeSubscription.plan[0]
        : activeSubscription?.plan;

      const periodEndRaw = activeSubscription?.current_period_end || activeSubscription?.renews_at;
      const periodEndMs = periodEndRaw ? new Date(periodEndRaw).getTime() : null;
      const isPeriodLapsed = periodEndMs !== null ? periodEndMs <= Date.now() : false;
      const isExpired = subInfo.isExpired || isPeriodLapsed || activeSubscription?.status === "expired";
      const hasActivePaidPeriod = subInfo.isPro && !isExpired && activeSubscription?.status === "active";

      // Only a paid subscription with an unexpired current period is Pro.
      if (
        activeSubscription &&
        plan &&
        Number(plan.price) > 0 &&
        hasActivePaidPeriod
      ) {
        const features = Array.isArray(plan.plan_feature)
          ? plan.plan_feature
              .map((feature: any) => feature.feature_text)
              .filter(Boolean)
          : [];

        const renewalRaw = activeSubscription.renews_at || activeSubscription.current_period_end;

        setSub({
          isPro: true,
          isExpired: false,
          status: "active",
          planName: plan.name || "Pro Plan",
          billingCycle:
            activeSubscription.billing_cycle === "yearly"
              ? "yearly"
              : "monthly",
          renewsAt: renewalRaw
            ? new Date(renewalRaw).toLocaleDateString(
                "en-US",
                {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }
              )
            : undefined,
          // plan.price is the NET price; show the VAT-inclusive price the patient pays
          price: `₱${withVat(Number(plan.price)).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} / ${
            activeSubscription.billing_cycle === "yearly"
              ? "year"
              : "month"
          }`,
          subscriptionId: activeSubscription.subscription_id,
          currentPeriodEnd: activeSubscription.current_period_end,
          cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
          description: plan.description || "",
          features,
          scanLimit:
            plan.scan_limit === -1 ? null : plan.scan_limit,
        });
      } else {
        // Expired or Free Plan
        setSub({
          isPro: false,
          isExpired: isExpired,
          status: isExpired ? "expired" : "free",
          planName: "Free Plan",
          subscriptionId: activeSubscription?.subscription_id,
          currentPeriodEnd: activeSubscription?.current_period_end,
          renewsAt: activeSubscription?.current_period_end
            ? new Date(activeSubscription.current_period_end).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : undefined,
        });
      }

      // 2. Load payment transactions
      // user_payment records store transactions. Resolve the actual total paid (VAT-inclusive: ₱199.00).
      const { data: payments } = await supabase
        .from("user_payment")
        .select(`
          payment_id,
          amount,
          payment_date,
          method,
          status,
          plan:plan_id (
            price,
            name
          )
        `)
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false });

      if (payments && payments.length > 0) {
        const mappedHistory: BillingHistoryItem[] = payments.map((p: any) => {
          const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
          const rawAmount = Number(p.total_amount ?? p.amount_paid ?? p.amount ?? 0);

          let resolvedTotal = rawAmount;
          let resolvedBase = Number(p.base_amount ?? 0);
          let resolvedVat = Number(p.vat_amount ?? 0);

          if (resolvedBase > 0 && resolvedVat > 0) {
            resolvedTotal = Math.round((resolvedBase + resolvedVat) * 100) / 100;
          } else if (planObj?.price != null && Number(planObj.price) > 0) {
            const planBase = Number(planObj.price);
            const calc = calculatePricing(planBase);
            resolvedBase = calc.basePrice;
            resolvedVat = calc.vatAmount;
            resolvedTotal = calc.totalPrice;
          } else if (rawAmount === 177.68) {
            const calc = calculatePricing(177.68);
            resolvedBase = calc.basePrice;
            resolvedVat = calc.vatAmount;
            resolvedTotal = calc.totalPrice; // 199.00
          } else if (rawAmount > 0) {
            const split = splitVat(rawAmount);
            resolvedBase = split.net;
            resolvedVat = split.vat;
            resolvedTotal = rawAmount;
          }

          const formattedAmount = `₱${resolvedTotal.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;

          return {
            paymentId: p.payment_id,
            paymentDate: p.payment_date,
            date: new Date(p.payment_date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            amount: formattedAmount,
            rawAmount,
            baseAmount: resolvedBase,
            vatAmount: resolvedVat,
            totalAmount: resolvedTotal,
            method: p.method || "Not provided",
            status: p.status === "success" ? "Paid" : p.status,
          };
        });
        setBillingHistory(mappedHistory);

      } else {
        setBillingHistory([]);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);


  const handleCancel = async () => {
    if (!user || !sub.subscriptionId || !sub.isPro || !sub.currentPeriodEnd) return;
    if (sub.cancelAtPeriodEnd || new Date(sub.currentPeriodEnd).getTime() <= Date.now()) return;


    setCancelling(true);

    try {
      if (sub.subscriptionId) {
        const { error } = await supabase
          .from("user_plan_subscription")
          .update({
            cancel_at_period_end: true,
            updated_at: new Date().toISOString(),
            cancelled_at: new Date().toISOString(),
          })
          .eq("subscription_id", sub.subscriptionId)
          .eq("status", "active");

        if (error) throw error;
      } else if (user) {
        const { error } = await supabase
          .from("user_plan_subscription")
          .update({
            cancel_at_period_end: true,
            cancelled_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);

        if (error) throw error;
      }

      await loadBillingData();

      logAuditEvent({
        userId: user?.id,
        role: "patient",
        category: "Subscription",
        action: "Subscription Cancelled",
        target: sub.planName || "Subscription Plan",
        details: `Patient cancelled renewal for "${sub.planName || "Subscription Plan"}" plan. Active until period end (${sub.currentPeriodEnd || "end of billing cycle"}).`,
        metadata: {
          subscriptionId: sub.subscriptionId,
          planName: sub.planName,
        },
      }).catch(() => {});
    } catch (error) {
      console.error("Failed to schedule subscription cancellation:", error);
    } finally {
      setCancelling(false);
    }
  };

  const handleResume = async () => {
    if (!user || !sub.subscriptionId || !sub.isPro || !sub.currentPeriodEnd) return;
    if (!sub.cancelAtPeriodEnd || new Date(sub.currentPeriodEnd).getTime() <= Date.now()) return;
    setResuming(true);

    try {
      if (sub.subscriptionId) {
        const { error } = await supabase
          .from("user_plan_subscription")
          .update({
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
            cancelled_at: null,
          })
          .eq("subscription_id", sub.subscriptionId)
          .eq("status", "active");

        if (error) throw error;
      } else if (user) {
        const { error } = await supabase
          .from("user_plan_subscription")
          .update({
            cancel_at_period_end: false,
            cancelled_at: null,
          })
          .eq("user_id", user.id)
          .eq("status", "active");

        if (error) throw error;
      }

      await loadBillingData();

      logAuditEvent({
        userId: user?.id,
        role: "patient",
        category: "Subscription",
        action: "Subscription Resumed",
        target: sub.planName || "Subscription Plan",
        details: `Patient resumed renewal for "${sub.planName || "Subscription Plan"}" plan.`,
        metadata: {
          subscriptionId: sub.subscriptionId,
          planName: sub.planName,
        },
      }).catch(() => {});
    } catch (error) {
      console.error("Failed to resume subscription:", error);
    } finally {
      setResuming(false);
    }
  };

  return (
    <>
    <div className="max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your subscription and payment details</p>
      </div>

      {/* Current Plan */}
      <section className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Current Plan</h2>

          {!loading && (
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                sub.isPro
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                  : sub.isExpired
                  ? "bg-rose-50 text-rose-700 ring-rose-600/20"
                  : "bg-gray-50 text-gray-600 ring-gray-500/20"
              )}
            >
              {sub.isPro ? "Active" : sub.isExpired ? "Expired" : "Free"}
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-[#A21D5C]" />
            <p className="text-xs text-gray-400">Loading billing details...</p>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-6 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs font-medium text-gray-500">Plan</dt>
                <dd className="mt-1.5 text-base font-semibold text-gray-900">
                  {sub.isPro ? (sub.planName || "Pro Plan") : "Free Plan"}
                </dd>
              </div>

              {sub.isPro ? (
                <>
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Price</dt>
                    <dd className="mt-1.5 text-base font-semibold text-gray-900">{sub.price}</dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium text-gray-500">Billing cycle</dt>
                    <dd className="mt-1.5 text-base font-semibold capitalize text-gray-900">{sub.billingCycle}</dd>
                  </div>

                  <div>
                    <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                      <Calendar className="h-3.5 w-3.5" />
                      {sub.cancelAtPeriodEnd ? "Pro access until" : "Next billing date"}
                    </dt>
                    <dd className="mt-1.5 text-base font-semibold text-gray-900">{sub.renewsAt}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="text-xs font-medium text-gray-500">Scan limit</dt>
                  <dd className="mt-1.5 text-base font-semibold text-gray-900">
                    {freePlan.scanLimit === null
                      ? "Unlimited scans"
                      : `${freePlan.scanLimit ?? 0} scans per account`}
                  </dd>
                </div>
              )}
            </dl>

            {sub.isPro ? (
              sub.cancelAtPeriodEnd ? (
                <div className="flex flex-col gap-4 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-600">
                    Your Pro access remains active until {sub.renewsAt}. You can resume your subscription before then without paying again.
                  </p>
                  <button
                    onClick={handleResume}
                    disabled={resuming}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-[#A21D5C] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7E1448] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A21D5C] focus-visible:ring-offset-2 disabled:opacity-50 cursor-pointer"
                  >
                    {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Resume Subscription
                  </button>
                </div>
              ) : (
                <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-4">
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:opacity-50 cursor-pointer"
                  >
                    {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel Subscription
                  </button>
                </div>
              )
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-gray-200 bg-gray-50 px-6 py-4">
                {sub.isExpired ? (
                  <p className="text-sm text-rose-700 font-medium">
                    Your Pro plan has expired. Upgrade or renew anytime to regain full Pro access and unlimited scans.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    You are on the Free plan. Upgrade to Pro for unlimited AI scans and priority booking.
                  </p>
                )}
                <Link
                  to="/dashboard/upgrade"
                  className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#A21D5C] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7E1448] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A21D5C] focus-visible:ring-offset-2"
                >
                  {sub.isExpired ? "Renew Subscription" : "Upgrade to Pro"}
                </Link>
              </div>
            )}
          </>
        )}
      </section>


      {/* Billing History */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Billing History</h2>
        </div>

        {billingHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
                  <th scope="col" className="px-6 py-3 font-medium">Date</th>
                  <th scope="col" className="px-6 py-3 font-medium">Description</th>
                  <th scope="col" className="px-6 py-3 font-medium">Payment Method</th>
                  <th scope="col" className="px-6 py-3 font-medium">Transaction ID</th>
                  <th scope="col" className="px-6 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-6 py-3 font-medium">Status</th>
                  <th scope="col" className="px-6 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {billingHistory.map((row) => (
                  <tr key={row.paymentId} className="transition-colors hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-gray-900">{row.date}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-600">DermAI Subscription</td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-600">
                      {row.method.toLowerCase().includes("gcash")
                        ? "GCash"
                        : row.method.toLowerCase().includes("maya") ||
                            row.method.toLowerCase().includes("paymaya")
                          ? "Maya"
                          : row.method || "Online Payment"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="block max-w-[180px] truncate font-mono text-xs text-gray-500" title={row.paymentId}>
                        {row.paymentId}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right font-semibold text-gray-900">{row.amount}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">{row.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <button type="button" onClick={() => setSelectedPayment(row)} className="rounded text-sm font-medium text-[#A21D5C] hover:text-[#7E1448] hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A21D5C]/40" aria-label={`View payment ${row.paymentId}`}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-10 text-center text-sm text-gray-400">No billing history available.</p>
        )}
      </section>
    </div>

      {/* Billing History Payment Details Modal */}
      {selectedPayment && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-6 backdrop-blur-sm"
          onClick={() => setSelectedPayment(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-details-title"
            className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-[#F4C9DC] bg-white shadow-[0_10px_40px_-12px_rgba(162,29,92,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative bg-gradient-to-br from-[#A21D5C] to-[#7E1448] px-6 pb-12 pt-7 text-center sm:px-8">
              <button
                type="button"
                onClick={() => setSelectedPayment(null)}
                aria-label="Close payment details"
                className="absolute right-3 top-3 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-pink-100/90">
                DermAI
              </p>
              <h2 id="payment-details-title" className="mt-1 text-sm tracking-wide text-pink-100/90">
                DermAI - Official Payment Receipt
              </h2>
            </div>

            <div className="relative z-10 -mt-9 w-[72px] h-[72px] rounded-full bg-white border-4 border-white shadow-md flex items-center justify-center mx-auto">
              <div className="w-full h-full rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9 text-emerald-600" />
              </div>

            </div>

            <div className="px-5 pb-6 pt-4 sm:px-8 sm:pb-8">
              <div className="text-center">
                <p className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                  Payment Details
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">
                  Your DermAI subscription transaction record.
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-[#F4C9DC] bg-[#FDF2F7] px-5 py-5 text-center sm:px-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  Total Paid
                </p>
                <p className="mt-1 break-words text-3xl font-bold tracking-tight text-[#A21D5C]">
                  {selectedPayment.amount}
                </p>
              </div>

              <div className="pt-6">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  Payment Details
                </h3>
                <dl className="divide-y divide-gray-100 text-sm">
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Account</dt>
                    <dd className="break-all font-medium text-gray-900 sm:text-right">
                      {user?.email || "Patient Account"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Description</dt>
                    <dd className="font-medium text-gray-900 sm:text-right">
                      DermAI Subscription
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Amount (excl. VAT)</dt>
                    <dd className="font-medium text-gray-900 sm:text-right">
                      ₱{(selectedPayment.baseAmount ?? 177.68).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">VAT (12%)</dt>
                    <dd className="font-medium text-gray-900 sm:text-right">
                      ₱{(selectedPayment.vatAmount ?? 21.32).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Payment Method</dt>
                    <dd className="flex items-center gap-2 font-medium text-gray-900 sm:justify-end">
                      <CreditCard className="h-4 w-4 shrink-0 text-[#A21D5C]" />
                      {selectedPayment.method.toLowerCase().includes("gcash")
                        ? "GCash"
                        : selectedPayment.method.toLowerCase().includes("maya") ||
                            selectedPayment.method.toLowerCase().includes("paymaya")
                          ? "Maya"
                          : selectedPayment.method || "Online Payment"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Date</dt>
                    <dd className="flex items-start gap-2 font-medium text-gray-900 sm:max-w-[70%] sm:justify-end sm:text-right">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#A21D5C]" />
                      <span>
                        {selectedPayment.paymentDate
                          ? new Date(selectedPayment.paymentDate).toLocaleString("en-PH", {
                              dateStyle: "long",
                              timeStyle: "short",
                            })
                          : "Not provided"}
                      </span>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Transaction ID</dt>
                    <dd className="max-w-full break-all rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700 sm:max-w-[70%] sm:text-right">
                      {selectedPayment.paymentId}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <dt className="shrink-0 text-gray-500">Status</dt>
                    <dd>
                      <span
                        className={
                          ["paid", "success"].includes(selectedPayment.status.toLowerCase())
                            ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : "inline-flex rounded-full border border-[#F4C9DC] bg-[#FDF2F7] px-3 py-1 text-xs font-semibold text-[#A21D5C]"
                        }
                      >
                        {selectedPayment.status}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              <button
                type="button"
                onClick={() => setSelectedPayment(null)}
                className="mt-6 w-full rounded-xl bg-[#A21D5C] px-4 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#7E1448] focus:outline-none focus:ring-2 focus:ring-[#A21D5C]/40 focus:ring-offset-2"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}