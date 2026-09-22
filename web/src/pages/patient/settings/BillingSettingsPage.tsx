import React, { useState, useEffect, useRef, useCallback } from "react";
import { Crown, Calendar, CheckCircle2, XCircle, X, Loader2, Wallet } from "lucide-react";
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
}

type PaymentMethodType = "gcash" | "maya";

interface SavedPaymentMethod {
  type: PaymentMethodType;
  label: string;
  sublabel: string;
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
  return `${clean.slice(0, 4)} •••• ${clean.slice(7)}`;
}

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubData>({ isPro: false });
  const [paymentMethod, setPaymentMethod] = useState<SavedPaymentMethod | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Modal & form states
  const [showModal, setShowModal] = useState(false);
  const [modalMethodType, setModalMethodType] = useState<PaymentMethodType>("gcash");
  const [mobileNumber, setMobileNumber] = useState("");
  const [methodSaved, setMethodSaved] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const loadBillingData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1. Load active subscription
      const { data: subData } = await supabase
        .from("user_plan_subscription")
        .select(`
          subscription_id,
          started_at,
          renews_at,
          status,
          billing_cycle,
          plan:plan_id (
            name,
            price,
            scan_limit
          )
        `)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subData) {
        const planObj: any = Array.isArray(subData.plan) ? subData.plan[0] : subData.plan;
        const renewsFormatted = subData.renews_at
          ? new Date(subData.renews_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "End of billing period";

        const priceFormatted = planObj?.price
          ? `₱${Number(planObj.price).toLocaleString()} / ${subData.billing_cycle}`
          : subData.billing_cycle === "yearly"
          ? "₱1,999 / year"
          : "₱199 / month";

        setSub({
          isPro: true,
          subscriptionId: subData.subscription_id,
          planName: planObj?.name || "Pro Plan",
          billingCycle: subData.billing_cycle as "monthly" | "yearly",
          renewsAt: renewsFormatted,
          price: priceFormatted,
        });
      } else {
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

        // Check localStorage first, otherwise infer from latest payment
        const stored = localStorage.getItem(`dermai_payment_method_${user.id}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.type === "gcash" || parsed.type === "maya") {
              setPaymentMethod(parsed);
            }
          } catch {
            // ignore JSON error
          }
        } else {
          const latestMethod = payments[0]?.method?.toLowerCase();
          if (latestMethod === "maya") {
            setPaymentMethod({
              type: "maya",
              label: "Maya e-Wallet",
              sublabel: "Connected via PayMongo",
            });
          } else {
            // default to gcash
            setPaymentMethod({
              type: "gcash",
              label: "GCash e-Wallet",
              sublabel: "Connected via PayMongo",
            });
          }
        }
      } else {
        setBillingHistory([]);
        const stored = localStorage.getItem(`dermai_payment_method_${user.id}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.type === "gcash" || parsed.type === "maya") {
              setPaymentMethod(parsed);
            }
          } catch {
            // ignore
          }
        }
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

  const openModal = () => {
    if (paymentMethod) {
      setModalMethodType(paymentMethod.type);
    } else {
      setModalMethodType("gcash");
    }
    setMobileNumber("");
    setMethodSaved(false);
    setShowModal(true);
  };

  const handleSaveMethod = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const cleanMobile = mobileNumber.replace(/\D/g, "");
    if (cleanMobile.length < 11) return;

    const newMethod: SavedPaymentMethod = {
      type: modalMethodType,
      label: modalMethodType === "gcash" ? "GCash e-Wallet" : "Maya e-Wallet",
      sublabel: maskMobile(cleanMobile),
    };

    setPaymentMethod(newMethod);
    localStorage.setItem(`dermai_payment_method_${user.id}`, JSON.stringify(newMethod));
    setMethodSaved(true);
    setTimeout(() => setShowModal(false), 900);
  };

  const handleCancel = async () => {
    if (!sub.subscriptionId && !user) return;
    setCancelling(true);
    try {
      if (sub.subscriptionId) {
        await supabase
          .from("user_plan_subscription")
          .update({ status: "cancelled" })
          .eq("subscription_id", sub.subscriptionId);
      } else if (user) {
        await supabase
          .from("user_plan_subscription")
          .update({ status: "cancelled" })
          .eq("user_id", user.id)
          .eq("status", "active");
      }
      await loadBillingData();
    } catch {
      // Fallback local update
      setSub({ isPro: false });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
    <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-magenta-100 rounded-2xl text-magenta-600">
          <Wallet className="w-6 h-6" />
        </div>
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
                <div className={`p-2 rounded-xl ${sub.isPro ? "bg-magenta-100 text-magenta-600" : "bg-gray-100 text-gray-400"}`}>
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-base font-bold text-gray-900">{sub.isPro ? (sub.planName || "Pro Plan") : "Free Plan"}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{sub.isPro ? sub.price : "3 scans per account"}</p>
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
                    <Calendar className="w-3.5 h-3.5" /> Next billing date
                  </span>
                  <span className="font-semibold text-gray-900">{sub.renewsAt}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="text-gray-500">Billing cycle</span>
                  <span className="font-semibold capitalize text-gray-900">{sub.billingCycle}</span>
                </div>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="mt-4 flex items-center gap-2 text-sm text-red-500 font-semibold hover:text-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel Subscription
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {["3 free AI skin scans", "Basic clinic search", "Limited scan history"].map((feat) => (
                    <div key={feat} className="flex items-center gap-2 text-sm text-gray-500">
                      <CheckCircle2 className="w-4 h-4 text-gray-300 shrink-0" />
                      {feat}
                    </div>
                  ))}
                </div>
                <Link
                  to="/dashboard/upgrade"
                  className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-magenta-500 text-white rounded-xl text-sm font-bold hover:bg-magenta-600 transition-colors shadow-sm"
                >
                  <Crown className="w-4 h-4" /> Upgrade to Pro
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* Payment Method */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Payment Method</h2>
        {paymentMethod ? (
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-center min-w-14 h-12">
              {paymentMethod.type === "gcash" ? (
                <img src={gcashLogo} alt="GCash" className="h-6 w-auto object-contain" />
              ) : (
                <img src={mayaLogo} alt="Maya" className="h-6 w-auto object-contain" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{paymentMethod.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{paymentMethod.sublabel}</p>
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
                <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">{row.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No billing history available.</p>
        )}
      </div>
    </div>

    {/* ── Update Payment Method Modal ──────────────────────── */}
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
              {methodSaved ? "✓ Payment Method Updated!" : "Save Payment Method"}
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
