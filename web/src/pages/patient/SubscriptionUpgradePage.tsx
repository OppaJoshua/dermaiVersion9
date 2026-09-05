import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft, Crown, CalendarDays, Calendar, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSubscriptionPlans } from "@/lib/store";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const PAYMONGO_PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || "";

function getActivePlanPrice(billingType: "monthly" | "yearly"): number {
  const plans = getSubscriptionPlans();
  const match = plans.find((p) => p.billingType === billingType && p.status === "active" && p.scanLimit === null);
  if (match) return match.price;
  return billingType === "monthly" ? 199 : 1999;
}

export default function SubscriptionUpgradePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState<string | null>(null);

  // Controlled form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(""); // TODO: Load user email from Supabase session
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "maya">("gcash");
  const [mobileNumber, setMobileNumber] = useState("");

  const basePrice = billingCycle === "monthly" ? getActivePlanPrice("monthly") : getActivePlanPrice("yearly");
  const tax = Math.round(basePrice * 0.12 * 100) / 100;
  const total = Math.round((basePrice + tax) * 100) / 100;
  const billingLabel = billingCycle === "monthly" ? "Monthly" : "Yearly";

  const activateSubscription = (_cycle: "monthly" | "yearly") => {
    // TODO: Update user subscription in Supabase
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
          sessionStorage.removeItem("dermai_pending_billing_cycle");
          navigate("/dashboard", { replace: true });
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
  }, [searchParams, navigate]);

  function formatMobileNumber(value: string) {
    return value.replace(/\D/g, "").slice(0, 11);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubscribing(true);
    setError(null);

    try {
      // 1. Create Payment Intent via our backend
      const intentRes = await fetch(`${BACKEND_URL}/api/payments/create-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: total,
          description: `DermAI Premium ${billingLabel} Subscription`,
          paymentMethod: paymentMethod,
          mobileNumber: mobileNumber,
        }),
      });
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
        activateSubscription(billingCycle);
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
    <div className="min-h-screen bg-magenta-50 pt-8 pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-magenta-500 mb-8 hover:text-magenta-700 font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Billing Cycle Selector */}
        <div className="mb-8">
          <p className="text-center text-sm font-semibold text-magenta-600 mb-4 uppercase tracking-wider">Choose your billing cycle</p>
          <div className="flex gap-4 max-w-md mx-auto">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-4 px-3 rounded-2xl border-2 transition-all font-medium",
                billingCycle === "monthly"
                  ? "border-magenta-500 bg-magenta-50 text-magenta-900 shadow-md shadow-magenta-100"
                  : "border-magenta-100 bg-white text-magenta-500 hover:border-magenta-300"
              )}
            >
              <Calendar className="w-5 h-5" />
              <span className="text-base font-bold">₱199</span>
              <span className="text-xs">per month</span>
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-4 px-3 rounded-2xl border-2 transition-all font-medium relative",
                billingCycle === "yearly"
                  ? "border-magenta-500 bg-magenta-50 text-magenta-900 shadow-md shadow-magenta-100"
                  : "border-magenta-100 bg-white text-magenta-500 hover:border-magenta-300"
              )}
            >
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">SAVE ~16%</span>
              <CalendarDays className="w-5 h-5" />
              <span className="text-base font-bold">₱1,999</span>
              <span className="text-xs">per year</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 xl:gap-16">
          {/* Order Summary & Features */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-2 lg:order-1"
          >
            <div className="bg-white rounded-[24px] shadow-[0_12px_48px_rgba(160,25,90,0.08)] p-6 sm:p-10 border border-magenta-100">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-magenta-100 rounded-2xl text-magenta-500">
                  <Crown className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-3xl font-display font-bold text-magenta-900">
                    Pro Plan
                  </h1>
                  <p className="text-magenta-500 font-medium mt-1">
                    Unlimited Anomaly Scans
                  </p>
                </div>
              </div>

              <div className="space-y-6 mb-8">
                <div className="flex justify-between items-center py-4 border-b border-magenta-100">
                  <span className="text-magenta-700 font-medium text-lg">Billing</span>
                  <span className="text-magenta-900 font-bold text-lg">{billingLabel}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-magenta-100">
                  <span className="text-magenta-700 font-medium text-lg">Subtotal</span>
                  <span className="text-magenta-900 font-bold text-lg">₱{basePrice.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-magenta-100">
                  <span className="text-magenta-700 font-medium text-lg">Tax (12%)</span>
                  <span className="text-magenta-900 font-bold text-lg">₱{tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center py-4 text-xl">
                  <span className="text-magenta-900 font-bold">Total Due Todahaqy</span>
                  <span className="text-magenta-500 font-black text-2xl">₱{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-2xl border border-orange-200">
                <p className="text-orange-800 text-sm font-medium leading-relaxed">
                  Subscription renews automatically every {billingCycle === "monthly" ? "month" : "year"} unless canceled. You can cancel at any time from your account settings.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Payment Form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-1 lg:order-2"
          >
            <div className="bg-white rounded-[24px] shadow-[0_12px_48px_rgba(160,25,90,0.12)] p-6 sm:p-10 border-2 border-magenta-200 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-magenta-400 to-orange-400" />
              <h2 className="text-2xl font-display font-bold text-magenta-900 mb-8">
                Payment Information
              </h2>

              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-magenta-900 mb-2">
                    Full Name
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Juan Dela Cruz"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-magenta-900 mb-2">
                      Country
                    </label>
                    <select
                      className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all appearance-none"
                    >
                      <option>Philippines</option>
                      <option>United States</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-magenta-900 mb-2">
                      Philippine TIN (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="000-000-000-000"
                      className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-magenta-900 mb-2">
                    Address
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Street, City, Province"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-magenta-900 mb-2">
                    Email Address
                  </label>
                  <input
                    required
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all"
                  />
                </div>

                <div className="space-y-4 pt-4 border-t border-magenta-100">
                  <div>
                    <label className="block text-sm font-semibold text-magenta-900 mb-2">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("gcash")}
                        className={cn(
                          "flex items-center justify-center h-14 px-4 rounded-2xl border-2 transition-all cursor-pointer",
                          paymentMethod === "gcash"
                            ? "border-blue-500 bg-blue-50/70 shadow-sm ring-2 ring-blue-500/20"
                            : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/60"
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
                          "flex items-center justify-center h-14 px-4 rounded-2xl border-2 transition-all cursor-pointer",
                          paymentMethod === "maya"
                            ? "border-emerald-500 bg-emerald-50/70 shadow-sm ring-2 ring-emerald-500/20"
                            : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/60"
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
                    <label className="block text-sm font-semibold text-magenta-900 mb-2">
                      {paymentMethod === "gcash" ? "GCash" : "Maya"} Mobile Number
                    </label>
                    <input
                      required
                      type="tel"
                      inputMode="numeric"
                      placeholder="09XXXXXXXXX"
                      maxLength={11}
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(formatMobileNumber(e.target.value))}
                      className="w-full bg-white border border-magenta-200 rounded-xl px-4 py-3 text-sm text-magenta-900 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent transition-all"
                    />
                    <p className="text-xs text-gray-400 mt-1.5">
                      Enter the mobile number linked to your {paymentMethod === "gcash" ? "GCash" : "Maya"} account.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 pt-6">
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="flex-1 py-4 bg-magenta-50 text-magenta-700 rounded-xl font-bold text-sm hover:bg-magenta-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubscribing}
                    className="flex-[2] py-4 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
                  >
                    {isSubscribing ? (
                      "Processing..."
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> Subscribe ₱{total.toFixed(2)}
                      </>
                    )}
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