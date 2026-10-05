import React, { useState, useEffect, useRef, useCallback } from "react";
import { Calendar, CheckCircle2, XCircle, X, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";

interface SubData {
  isPro: boolean;
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

type PaymentMethodType = "gcash" | "maya";

interface SavedPaymentMethod {
  type: PaymentMethodType;
  label: string;
  sublabel: string;
  mobileNumber: string;
  fullName: string;
  email: string;
  billingAddress: string;
}

interface BillingHistoryItem {
  date: string;
  amount: string;
  status: string;
}

function formatMobileNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function maskMobile(value: string) {
  const clean = value.replace(/\D/g, "");
  if (clean.length < 11) return clean;
  return `${clean.slice(0, 4)} **** ${clean.slice(7)}`;
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

  const [paymentMethod, setPaymentMethod] = useState<SavedPaymentMethod | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);

  // Modal & form states
  const [showModal, setShowModal] = useState(false);
  const [modalMethodType, setModalMethodType] = useState<PaymentMethodType>("gcash");
  const [mobileNumber, setMobileNumber] = useState("");
  const [paymentFullName, setPaymentFullName] = useState("");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [methodSaved, setMethodSaved] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

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
      // 2. Load the patient's active subscription
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

            // Pro entitlement is valid only while the paid period is still active.
      const currentPeriodEnd = activeSubscription?.current_period_end
        ? new Date(activeSubscription.current_period_end)
        : null;

      const hasActivePaidPeriod =
        activeSubscription?.status === "active" &&
        currentPeriodEnd !== null &&
        currentPeriodEnd.getTime() > Date.now();

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

        setSub({
          isPro: true,
          planName: plan.name || "Pro Plan",
          billingCycle:
            activeSubscription.billing_cycle === "yearly"
              ? "yearly"
              : "monthly",
          renewsAt: activeSubscription.renews_at
            ? new Date(activeSubscription.renews_at).toLocaleDateString(
                "en-US",
                {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }
              )
            : undefined,
          price: `₱${Number(plan.price).toLocaleString("en-PH", {
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
        // No active paid subscription = Free Plan
        setSub({ isPro: false });
      }

      // 2. Load payment transactions
      const { data: payments } = await supabase
        .from("user_payment")
        .select("payment_id, amount, payment_date, method, status")
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false });

      if (payments && payments.length > 0) {
        const mappedHistory: BillingHistoryItem[] = payments.map((p) => ({
          date: new Date(p.payment_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          amount: `₱${Number(p.amount).toLocaleString()}`,
          status: p.status === "success" ? "Paid" : p.status,
        }));
        setBillingHistory(mappedHistory);

        const currentPeriodEnd = activeSubscription?.current_period_end
          ? new Date(activeSubscription.current_period_end)
          : null;

        const hasActivePaidPeriod =
          activeSubscription?.status === "active" &&
          currentPeriodEnd !== null &&
          currentPeriodEnd.getTime() > Date.now();

        const latestSuccessfulPayment = payments.find((p) => p.status === "success");

        const savedPaymentMethod =
          activeSubscription?.payment_method?.toLowerCase() ||
          latestSuccessfulPayment?.method?.toLowerCase();

        // Use the payment details saved with the current subscription.
        // Do not display the method after cancellation or expiration.
        if (!hasActivePaidPeriod || activeSubscription?.cancel_at_period_end) {
          setPaymentMethod(null);
        } else if (
          savedPaymentMethod === "paymaya" ||
          savedPaymentMethod === "gcash"
        ) {
          const isMaya = savedPaymentMethod === "paymaya";

          setPaymentMethod({
            type: isMaya ? "maya" : "gcash",
            label: isMaya ? "Maya e-Wallet" : "GCash e-Wallet",
            sublabel: activeSubscription.payment_mobile_number
              ? maskMobile(activeSubscription.payment_mobile_number)
              : "Connected via PayMongo",
            mobileNumber: activeSubscription.payment_mobile_number || "",
            fullName: activeSubscription.payment_full_name || "",
            email: activeSubscription.payment_email || "",
            billingAddress: activeSubscription.billing_address || "",
          });
        } else {
          setPaymentMethod(null);
        }
      } else {
        setBillingHistory([]);
        setPaymentMethod(null);
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

  // Close modal on outside click
  useEffect(() => {
    if (!showModal) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowModal(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModal]);

  const openModal = async () => {
    // Show the modal right away using whatever is already loaded.
    const meta = ((user as any)?.user_metadata || {}) as Record<string, any>;
    const accountName = meta.full_name || meta.name || "";
    const accountEmail = (user as any)?.email || "";

    let saved = {
      type: (paymentMethod?.type || "gcash") as PaymentMethodType,
      fullName: paymentMethod?.fullName || "",
      email: paymentMethod?.email || "",
      billingAddress: paymentMethod?.billingAddress || "",
      mobileNumber: paymentMethod?.mobileNumber || "",
    };

    // Re-read the saved checkout details so the form never opens with stale/empty state.
    if (user) {
      const { data } = await supabase
        .from("user_plan_subscription")
        .select("payment_method, payment_full_name, payment_email, billing_address, payment_mobile_number")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        const method = data.payment_method?.toLowerCase();
        saved = {
          type: method === "paymaya" || method === "maya" ? "maya" : method === "gcash" ? "gcash" : saved.type,
          fullName: data.payment_full_name || saved.fullName,
          email: data.payment_email || saved.email,
          billingAddress: data.billing_address || saved.billingAddress,
          mobileNumber: data.payment_mobile_number || saved.mobileNumber,
        };
      }
    }

    setModalMethodType(saved.type);
    setMobileNumber(formatMobileNumber(saved.mobileNumber));
    setPaymentFullName(saved.fullName || accountName);
    setPaymentEmail(saved.email || accountEmail);
    setBillingAddress(saved.billingAddress);

    setMethodSaved(false);
    setShowModal(true);
  };

  const handleSaveMethod = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user || !sub.subscriptionId) return;

    const cleanMobile = mobileNumber.replace(/\D/g, "");

    if (cleanMobile.length < 11) return;

    const databaseMethod =
      modalMethodType === "maya" ? "paymaya" : "gcash";

    try {
      const { error } = await supabase
        .from("user_plan_subscription")
        .update({
          payment_method: databaseMethod,
          payment_full_name: paymentFullName.trim(),
          payment_email: paymentEmail.trim(),
          billing_address: billingAddress.trim(),
          payment_mobile_number: cleanMobile,
        })
        .eq("subscription_id", sub.subscriptionId)
        .eq("status", "active");

      if (error) throw error;

      const newMethod: SavedPaymentMethod = {
        type: modalMethodType,
        label:
          modalMethodType === "gcash"
            ? "GCash e-Wallet"
            : "Maya e-Wallet",
        sublabel: maskMobile(cleanMobile),
        mobileNumber: cleanMobile,
        fullName: paymentFullName.trim(),
        email: paymentEmail.trim(),
        billingAddress: billingAddress.trim(),
      };

      setPaymentMethod(newMethod);
      setMethodSaved(true);

      await loadBillingData();

      setShowModal(false);
    } catch (error) {
      console.error("Failed to update payment method:", error);
    }
  };
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
    } catch (error) {
      console.error("Failed to resume subscription:", error);
    } finally {
      setResuming(false);
    }
  };

  return (
    <>
    <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div className="flex items-center gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your subscription and payment details</p>
        </div>
      </div>

      {/* Current Plan */}
      <div className={`rounded-2xl p-6 mb-6 border ${sub.isPro ? "bg-magenta-50 border-magenta-200" : "bg-white border-gray-100"} shadow-sm`}>
        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-6 h-6 text-magenta-500 animate-spin mx-auto mb-2" />
            <p className="text-xs text-gray-400">Loading billing details...</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-base font-bold text-gray-900">
                    {sub.isPro
                      ? (sub.planName || "Pro Plan")
                      : (freePlan.planName || "Free Plan")}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {sub.isPro
                      ? sub.price
                      : freePlan.scanLimit === null
                      ? "Unlimited scans"
                      : `${freePlan.scanLimit ?? 0} scans per account`}
                  </p>
                </div>
              </div>

              <span className={`text-xs px-3 py-1 rounded-full font-bold ${sub.isPro ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {sub.isPro ? "Active" : "Free"}
              </span>
            </div>

            {sub.isPro ? (
              <div className="pt-4 border-t border-magenta-100 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <Calendar className="w-3.5 h-3.5" />
                    {sub.cancelAtPeriodEnd ? "Pro access until" : "Next billing date"}
                  </span>
                  <span className="font-semibold text-gray-900">{sub.renewsAt}</span>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="text-gray-500">Billing cycle</span>
                  <span className="font-semibold capitalize text-gray-900">{sub.billingCycle}</span>
                </div>

                {sub.cancelAtPeriodEnd ? (
                  <>
                    <p className="mt-3 text-xs text-gray-500">
                      Your Pro access remains active until {sub.renewsAt}. You can resume your subscription before then without paying again.
                    </p>
                    <button
                      onClick={handleResume}
                      disabled={resuming}
                      className="mt-4 flex items-center gap-2 text-sm text-magenta-600 font-semibold hover:text-magenta-700 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Resume Subscription
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="mt-4 flex items-center gap-2 text-sm text-red-500 font-semibold hover:text-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel Subscription
                  </button>
                )}
              </div>
            ) : (
              <div className="pt-4 border-t border-gray-100">
                <Link
                  to="/patient/subscription"
                  className="text-sm text-magenta-500 font-semibold hover:text-magenta-700 transition-colors"
                >
                  Upgrade to Pro
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* Payment Method */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">
          Payment Method
        </h2>

        {paymentMethod ? (
          <div className="flex items-center gap-3">
            <div className="w-12 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center">
              {paymentMethod.type === "gcash" ? (
                <img src={gcashLogo} alt="GCash" className="h-6 w-auto object-contain" />
              ) : (
                <img src={mayaLogo} alt="Maya" className="h-6 w-auto object-contain" />
              )}
            </div>

            <div>
              <p className="text-sm font-bold text-gray-900">{paymentMethod.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{paymentMethod.sublabel}</p>
              {paymentMethod.fullName && (
                <p className="text-xs text-gray-500 mt-1 truncate">{paymentMethod.fullName}</p>
              )}
              {paymentMethod.email && (
                <p className="text-xs text-gray-400 truncate">{paymentMethod.email}</p>
              )}
              {paymentMethod.billingAddress && (
                <p className="text-xs text-gray-400 truncate">{paymentMethod.billingAddress}</p>
              )}
            </div>

            <button
              onClick={openModal}
              className="ml-auto text-xs text-magenta-500 font-semibold hover:text-magenta-700 transition-colors cursor-pointer"
            >
              Update
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">No payment method on file.</p>
            <button
              onClick={openModal}
              className="text-xs text-magenta-500 font-semibold hover:text-magenta-700 transition-colors cursor-pointer"
            >
              Add Payment Method
            </button>
          </div>
        )}
      </div>

      {/* Billing History */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Billing History</h2>

        {billingHistory.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {billingHistory.map((row, i) => (
              <div key={i} className="flex items-center justify-between py-3 text-sm">
                <span className="text-gray-600">{row.date}</span>
                <span className="font-semibold text-gray-900">{row.amount}</span>
                <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No billing history available.</p>
        )}
      </div>
    </div>

      {/* Update Payment Method Modal */}
    {showModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
        <div
          ref={modalRef}
          className="w-full max-w-md bg-white rounded-[28px] shadow-2xl p-7 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Update Payment Method</h2>
            <button
              onClick={() => setShowModal(false)}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Payment Method Selector Tabs: GCash & Maya */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Select E-Wallet</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setModalMethodType("gcash")}
                className={cn(
                  "flex flex-col items-center justify-center py-3.5 px-3 rounded-2xl border transition-all cursor-pointer",
                  modalMethodType === "gcash"
                    ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/15 font-bold shadow-xs"
                    : "border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-medium"
                )}
              >
                <img src={gcashLogo} alt="GCash" className="h-6 w-auto object-contain mb-1.5" />
                <span className="text-xs">GCash</span>
              </button>
              <button
                type="button"
                onClick={() => setModalMethodType("maya")}
                className={cn(
                  "flex flex-col items-center justify-center py-3.5 px-3 rounded-2xl border transition-all cursor-pointer",
                  modalMethodType === "maya"
                    ? "border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/15 font-bold shadow-xs"
                    : "border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-medium"
                )}
              >
                <img src={mayaLogo} alt="Maya" className="h-6 w-auto object-contain mb-1.5" />
                <span className="text-xs">Maya</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveMethod} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                placeholder="Enter your full name"
                value={paymentFullName}
                onChange={(e) => setPaymentFullName(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-magenta-500/10 focus:border-magenta-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="email"
                placeholder="Enter your email address"
                value={paymentEmail}
                onChange={(e) => setPaymentEmail(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-magenta-500/10 focus:border-magenta-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Billing Address <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                placeholder="Enter your billing address"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-magenta-500/10 focus:border-magenta-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                {modalMethodType === "gcash" ? "GCash" : "Maya"} Mobile Number <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="tel"
                inputMode="numeric"
                placeholder="09XXXXXXXXX"
                maxLength={11}
                value={mobileNumber}
                onChange={(e) => setMobileNumber(formatMobileNumber(e.target.value))}
                className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-magenta-500/10 focus:border-magenta-400 transition-all"
              />
              <p className="text-[11px] text-gray-400 mt-1.5">
                Enter the 11-digit mobile number linked to your {modalMethodType === "gcash" ? "GCash" : "Maya"} account.
              </p>
            </div>

            <button
              type="submit"
              className={`w-full py-3.5 rounded-2xl text-sm font-bold transition-all cursor-pointer ${
                methodSaved
                  ? "bg-green-500 text-white"
                  : "bg-magenta-500 text-white hover:bg-magenta-600 active:scale-[0.98]"
              }`}
            >
              {methodSaved ? "Payment Method Updated!" : "Save Payment Method"}
            </button>
          </form>

          <p className="text-center text-[11px] text-gray-400">
            Payment information is securely processed via PayMongo.
          </p>
        </div>
      </div>
    )}
    </>
  );
}














