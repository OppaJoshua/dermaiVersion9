import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft, Crown, CalendarDays, Calendar, AlertCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSubscriptionPlansAsync, type SubscriptionPlan } from "@/lib/store";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const PAYMONGO_PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || "";

export default function SubscriptionUpgradePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  // Controlled form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "maya">("gcash");
  const [mobileNumber, setMobileNumber] = useState("");

  useEffect(() => {
    getSubscriptionPlansAsync(false).then(setPlans).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email || "");
    if (user?.user_metadata?.full_name) setFullName((prev) => prev || user.user_metadata.full_name || "");
  }, [user]);

  const matchedPlan = plans.find((p) => p.billingType === billingCycle && p.status === "active");
  const basePrice = matchedPlan ? matchedPlan.price : (billingCycle === "monthly" ? 199 : 1999);
  const tax = Math.round(basePrice * 0.12 * 100) / 100;
  const total = Math.round((basePrice + tax) * 100) / 100;
  const billingLabel = billingCycle === "monthly" ? "Monthly" : "Yearly";

  const activateSubscription = async (cycle: "monthly" | "yearly", paymentMethodUsed: string = "gcash") => {
    if (!user?.id) return;
    const now = new Date();
    const renewDate = new Date();
    if (cycle === "yearly") {
      renewDate.setFullYear(now.getFullYear() + 1);
    } else {
      renewDate.setMonth(now.getMonth() + 1);
    }

    // Find the matching Pro plan (monthly or yearly)
    const matchedPlan = plans.find((p) => p.billingType === cycle && p.status === "active");
    // Fallback plan IDs match the seeds: Pro Monthly = ...0003, Pro Annual = ...0004
    const fallbackPlanId =
      cycle === "yearly"
        ? "00000000-0000-0000-0000-000000000004"
        : "00000000-0000-0000-0000-000000000003";
    const planId = matchedPlan?.id || fallbackPlanId;

    try {
      // Upsert subscription row (one active sub per user)
      const { error: subErr } = await supabase.from("user_plan_subscription").upsert(
        {
          user_id: user.id,
          plan_id: planId,
          status: "active",
          billing_cycle: cycle,
          started_at: now.toISOString(),
          renews_at: renewDate.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: renewDate.toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (subErr) console.error("[upgrade] subscription upsert error:", subErr.message);

      // Insert payment receipt
      const { error: payErr } = await supabase.from("user_payment").insert({
        user_id: user.id,
        plan_id: planId,
        amount: total,
        payment_date: now.toISOString(),
        method: paymentMethodUsed,
        status: "success",
      });
      if (payErr) console.error("[upgrade] payment insert error:", payErr.message);
    } catch (dbErr) {
      console.error("[upgrade] DB write failed:", dbErr);
    }

    sessionStorage.removeItem("dermai_pending_billing_cycle");
    navigate("/dashboard", { replace: true });
  };

  // On return from PayMongo 3DS redirect, check payment status
  useEffect(() => {
    const intentId = searchParams.get("payment_intent");
    const clientKey = searchParams.get("payment_intent_client_key");
    if (!intentId || !clientKey) return;

    let isMounted = true;
    (async () => {
      try {
        setIsSubscribing(true);
        setError(null);
        const res = await fetch(
          `${BACKEND_URL}/api/payments/intent/${intentId}?client_key=${encodeURIComponent(clientKey)}`
        );
        const data = await res.json();
        if (!isMounted) return;
        if (data?.attributes?.status === "succeeded") {
          const savedCycle = (sessionStorage.getItem("dermai_pending_billing_cycle") || billingCycle) as "monthly" | "yearly";
          await activateSubscription(savedCycle, paymentMethod);
        } else {
          setError("Payment was not completed. Please try again.");
          setIsSubscribing(false);
        }
      } catch {
        if (!isMounted) return;
        setError("Failed to verify payment. Please contact support.");
        setIsSubscribing(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function formatMobileNumber(value: string) {
    return value.replace(/\D/g, "").slice(0, 11);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubscribing(true);
    setError(null);
    setBackendDown(false);

    try {
      // 1. Create Payment Intent via our backend
      let intentRes: Response;
      try {
        intentRes = await fetch(`${BACKEND_URL}/api/payments/create-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: total,
            description: `DermAI Premium ${billingLabel} Subscription`,
            paymentMethod: paymentMethod,
            mobileNumber: mobileNumber,
          }),
        });
      } catch (networkErr) {
        // Backend is unreachable — offer sandbox activation
        console.warn("[upgrade] Backend unreachable:", networkErr);
        setBackendDown(true);
        setIsSubscribing(false);
        return;
      }

      const intentJson = await intentRes.json();
      if (!intentRes.ok) throw new Error(intentJson.error || "Failed to create payment intent");
      const { paymentIntentId, clientKey } = intentJson;

      // Save billing cycle so we can restore it after a 3DS redirect
      sessionStorage.setItem("dermai_pending_billing_cycle", billingCycle);

      // 2. Create Payment Method directly with PayMongo (uses public key)
      const pmRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(PAYMONGO_PUBLIC_KEY + ":"),
        },
        body: JSON.stringify({
          data: {
            attributes: {
              type: paymentMethod,
              billing: {
                name: fullName,
                email,
                phone: mobileNumber,
                address: { line1: address, city: "Philippines", country: "PH" },
              },
            },
          },
        }),
      });
      const pmJson = await pmRes.json();
      if (!pmRes.ok) {
        throw new Error(pmJson.errors?.[0]?.detail || "Payment method creation failed");
      }
      const paymentMethodId = pmJson.data.id;

      // 3. Attach Payment Method to Intent via our backend
      const returnUrl = `${window.location.origin}/dashboard/upgrade?payment_intent=${paymentIntentId}&payment_intent_client_key=${encodeURIComponent(clientKey)}`;
      const attachRes = await fetch(`${BACKEND_URL}/api/payments/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId, paymentMethodId, clientKey, returnUrl }),
      });
      const intentData = await attachRes.json();
      if (!attachRes.ok) throw new Error(intentData.error || "Payment processing failed");

      const status = intentData?.attributes?.status;

      if (status === "awaiting_next_action") {
        // Redirect user to 3DS authentication page
        const redirectUrl = intentData.attributes.next_action?.redirect?.url;
        if (!redirectUrl) throw new Error("3DS redirect URL not found");
        window.location.href = redirectUrl;
      } else if (status === "succeeded") {
        await activateSubscription(billingCycle, paymentMethod);
      } else {
        throw new Error(`Payment was not successful (status: ${status}). Please try again.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment failed. Please try again.";
      setError(message);
      setIsSubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 pt-8 pb-20 px-4 font-sans antialiased">
      <div className="max-w-5xl mx-auto">
        {/* Top Back Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>

        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-50 text-magenta-600 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Upgrade to DermAI Pro
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Unlock Unlimited AI Skin Analysis
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Get unlimited AI scans, priority clinic booking, and detailed skin progression analytics.
          </p>

          {/* Billing Cycle Toggle */}
          <div className="mt-6 inline-flex p-1 bg-gray-100 rounded-2xl border border-gray-200/60 max-w-xs w-full">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5",
                billingCycle === "monthly"
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Calendar className="w-3.5 h-3.5 text-magenta-500" />
              <span>Monthly • ₱199</span>
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 relative",
                billingCycle === "yearly"
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <CalendarDays className="w-3.5 h-3.5 text-magenta-500" />
              <span>Yearly • ₱1,999</span>
              <span className="absolute -top-2.5 -right-1 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                -16%
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Order Summary & Features (5 cols) */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-5 space-y-4"
          >
            <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-xs">
              <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-100">
                <div className="w-12 h-12 rounded-2xl bg-magenta-50 text-magenta-600 flex items-center justify-center shrink-0">
                  <Crown className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Pro Membership</h2>
                  <p className="text-xs text-gray-500">Unlimited Anomaly Scans</p>
                </div>
              </div>

              {/* Price Breakdown */}
              <div className="space-y-3 text-xs mb-6">
                <div className="flex justify-between items-center text-gray-600">
                  <span>Billing Plan</span>
                  <span className="font-semibold text-gray-900">{billingLabel}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-semibold text-gray-900">₱{basePrice.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span>VAT / Tax (12%)</span>
                  <span className="font-semibold text-gray-900">₱{tax.toFixed(2)}</span>
                </div>
                <div className="pt-3 border-t border-gray-100 flex justify-between items-baseline">
                  <span className="text-sm font-bold text-gray-900">Total Due Today</span>
                  <span className="text-xl font-bold text-magenta-600">
                    ₱{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Pro Features Included */}
              <div className="space-y-2.5 pt-4 border-t border-gray-100 mb-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Included with Pro</p>
                <div className="space-y-2 text-xs text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>Unlimited AI skin disease scans</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>Priority clinic consultation requests</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>Full scan history &amp; severity tracking</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>Continuous instant updates</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-100 text-[11px] text-gray-500 leading-relaxed">
                Auto-renews every {billingCycle === "monthly" ? "month" : "year"}. Cancel anytime directly from your billing settings.
              </div>
            </div>
          </motion.div>

          {/* Payment Form (7 cols) */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="lg:col-span-7"
          >
            <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 shadow-xs">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">Payment Information</h2>
                <p className="text-xs text-gray-500 mt-0.5">Secure payment processing via PayMongo</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{error}</span>
                  </div>
                )}

                {backendDown && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs space-y-3">
                    <div className="flex items-start gap-2">
                      <WifiOff className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
                      <div>
                        <p className="font-semibold">Payment server is currently unreachable</p>
                        <p className="text-amber-700 mt-0.5 leading-relaxed">
                          The PayMongo backend (localhost:3001) could not be contacted. You can activate your
                          subscription directly for testing purposes, or try again later when the server is running.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => activateSubscription(billingCycle, paymentMethod)}
                      className="w-full py-2.5 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                    >
                      Activate Directly (Sandbox / Dev Mode)
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Maria Santos"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="email"
                      placeholder="maria@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Billing Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="City, Province"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                    />
                  </div>
                </div>

                {/* Payment Method Selector */}
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Select E-Wallet <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("gcash")}
                      className={cn(
                        "flex items-center justify-center h-14 px-4 rounded-2xl border transition-all cursor-pointer",
                        paymentMethod === "gcash"
                          ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/15 shadow-xs"
                          : "border-gray-200 bg-white hover:bg-gray-50/60"
                      )}
                      aria-label="Pay with GCash"
                    >
                      <img
                        src={gcashLogo}
                        alt="GCash"
                        className="h-6 w-auto object-contain"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("maya")}
                      className={cn(
                        "flex items-center justify-center h-14 px-4 rounded-2xl border transition-all cursor-pointer",
                        paymentMethod === "maya"
                          ? "border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/15 shadow-xs"
                          : "border-gray-200 bg-white hover:bg-gray-50/60"
                      )}
                      aria-label="Pay with Maya"
                    >
                      <img
                        src={mayaLogo}
                        alt="Maya"
                        className="h-6 w-auto object-contain"
                      />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {paymentMethod === "gcash" ? "GCash" : "Maya"} Mobile Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="tel"
                    inputMode="numeric"
                    placeholder="09XXXXXXXXX"
                    maxLength={11}
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(formatMobileNumber(e.target.value))}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Enter the 11-digit number linked to your {paymentMethod === "gcash" ? "GCash" : "Maya"} account.
                  </p>
                </div>

                {/* Submit & Cancel Buttons */}
                <div className="pt-4 space-y-2.5">
                  <button
                    type="submit"
                    disabled={isSubscribing}
                    className="w-full py-3.5 bg-magenta-600 text-white rounded-full font-semibold text-sm shadow-sm hover:bg-magenta-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubscribing ? (
                      "Processing Payment..."
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> Pay &amp; Activate (₱{total.toFixed(2)})
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="block w-full py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Cancel and Return
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}