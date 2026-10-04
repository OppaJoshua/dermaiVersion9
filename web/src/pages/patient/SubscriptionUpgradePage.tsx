import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Calendar, CalendarDays, Crown, AlertCircle } from "lucide-react";
import { getSubscriptionPlansAsync, type SubscriptionPlan } from "@/lib/store";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";

// PayMongo is handled by the Supabase Edge Function.
const PAYMONGO_PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || "";


export default function SubscriptionUpgradePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const availablePlans = plans.filter(
  (p) =>
    p.billingType === billingCycle &&
    p.status === "active" &&
    p.price > 0
);

const selectedPlan =
  availablePlans.find((p) => p.id === selectedPlanId) ??
  availablePlans[0];

const basePrice = selectedPlan?.price ?? 0;
const total = Math.round(basePrice * 100) / 100;
const billingLabel = billingCycle === "monthly" ? "Monthly" : "Yearly";
const currentPlanId = selectedPlan?.id;


    // On return from PayMongo 3DS redirect, check payment status
  useEffect(() => {
    const runPaymentVerification = async () => {
      // Read directly from the browser URL.
      const params = new URLSearchParams(window.location.search);

      const intentId =
        params.get("payment_intent") ||
        params.get("payment_intent_id");

      const clientKey =
        params.get("payment_intent_client_key") ||
        sessionStorage.getItem(
          "dermai_pending_payment_intent_client_key"
        );

      console.log("[upgrade] Return from PayMongo:", {
        intentId,
        hasClientKey: !!clientKey,
      });

      // If this is a normal visit to the upgrade page,
      // there is no payment to verify.
      if (!intentId || !clientKey) {
        setIsSubscribing(false);
        return;
      }

      try {
        setIsSubscribing(true);
        setError(null);

        console.log(
          "[upgrade] Verifying PayMongo Payment Intent:",
          intentId
        );

        const { data, error: verifyError } =
          await supabase.functions.invoke("paymongo-payment", {
            body: {
              action: "verify_payment_intent",
              paymentIntentId: intentId,
              clientKey,
            },
          });

        console.log("[upgrade] Verification response:", data);

        if (verifyError) {
          console.error(
            "[upgrade] Payment verification error:",
            verifyError
          );
          
          throw new Error(
            verifyError.message ||
              "Failed to verify payment"
          );
        }

        const paymentStatus =
          data?.attributes?.status || data?.status;

        console.log(
          "[upgrade] PayMongo payment status:",
          paymentStatus
        );

        if (paymentStatus === "succeeded") {
          const savedCycle =
            (sessionStorage.getItem(
              "dermai_pending_billing_cycle"
            ) || billingCycle) as "monthly" | "yearly";

          console.log(
            "[upgrade] PayMongo payment succeeded. Waiting for webhook to activate subscription.",
            {
              billingCycle: savedCycle,
              paymentMethod,
            }
          );

          sessionStorage.removeItem(
            "dermai_pending_billing_cycle"
          );

          sessionStorage.removeItem(
            "dermai_pending_payment_intent_client_key"
          );

          setIsSubscribing(false);
          return;
        }

        setError(
          `Payment was not completed. PayMongo status: ${paymentStatus || "unknown"}`
        );
        setIsSubscribing(false);
      } catch (err: unknown) {
        console.error(
          "[upgrade] Payment verification failed:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "Failed to verify payment. Please try again."
        );

        setIsSubscribing(false);
      }
    };

    runPaymentVerification();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatMobileNumber(value: string) {
    return value.replace(/\D/g, "").slice(0, 11);
  }

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!user?.id) {
    setError("You must be logged in to subscribe.");
    setIsSubscribing(false);
    return;
  }

  setIsSubscribing(true);

  setError(null);

  
    try {
console.log("[upgrade] Payment amount:", {
  basePrice,
  total,
  billingCycle,
  currentPlanId,
});
    // TEMP DEBUG: Check the Supabase session before calling the Edge Function
    const { data: sessionData } = await supabase.auth.getSession();

    console.log("[upgrade] Supabase session check:", {
      hasSession: !!sessionData.session,
      sessionUserId: sessionData.session?.user?.id ?? null,
      contextUserId: user.id,
      hasAccessToken: !!sessionData.session?.access_token,
    });

    // 1. Create Payment Intent through the Supabase Edge Function
const { data: intentJson, error: intentError } =
  await supabase.functions.invoke("paymongo-payment", {
    body: {
      paymentMethod: paymentMethod,
      userId: user.id,
      planId: currentPlanId,
      billingCycle: billingCycle,
    },
  });

if (intentError) {
  console.error("[upgrade] PayMongo Edge Function error:", intentError);
  throw new Error(
    intentError.message || "Failed to create payment intent"
  );
}

if (!intentJson?.paymentIntentId || !intentJson?.clientKey) {
  console.error("[upgrade] Invalid payment intent response:", intentJson);
  throw new Error("PayMongo did not return a valid payment intent");
}

const { paymentIntentId, clientKey } = intentJson;

      // Save billing cycle so we can restore it after a 3DS redirect
      sessionStorage.setItem("dermai_pending_billing_cycle", billingCycle);
      sessionStorage.setItem("dermai_pending_payment_intent_client_key", clientKey);

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
              type: paymentMethod === "maya" ? "paymaya" : paymentMethod,
              billing: {
                name: fullName,
                email,
                phone: mobileNumber,
                address: { line1: address, city: "Cebu City", country: "PH" },
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

      // 3. Attach Payment Method through the Supabase Edge Function
      const returnUrl = `${window.location.origin}/patient/payment/success?payment_intent=${paymentIntentId}&payment_intent_client_key=${encodeURIComponent(clientKey)}`;

      const { data: intentData, error: attachError } =
        await supabase.functions.invoke("paymongo-payment", {
          body: {
            action: "attach_payment_method",
            paymentIntentId,
            paymentMethodId,
            clientKey,
            returnUrl,
          },
        });

      console.log("[upgrade] PayMongo attach response:", {
        intentData,
        attachError,
      });

      if (attachError) {
        console.error("[upgrade] PayMongo attach error:", attachError);
        throw new Error(
          attachError.message || "Payment processing failed"
        );
      }

      if (!intentData?.status) {
        console.error("[upgrade] Invalid attach response:", intentData);
        throw new Error("PayMongo returned an invalid payment response");
      }

      const status = intentData?.attributes?.status;

      if (status === "awaiting_next_action") {
        // Redirect user to 3DS authentication page
        const redirectUrl = intentData.attributes.next_action?.redirect?.url;
        if (!redirectUrl) throw new Error("3DS redirect URL not found");
        window.location.href = redirectUrl;
      } else if (status === "succeeded") {
      console.log(
        "[upgrade] PayMongo payment succeeded immediately. Waiting for webhook to activate subscription.",
        {
          billingCycle,
          paymentMethod,
        }
      );

      sessionStorage.removeItem(
        "dermai_pending_billing_cycle"
      );

      sessionStorage.removeItem(
        "dermai_pending_payment_intent_client_key"
      );

      setIsSubscribing(false);
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
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Unlock Unlimited AI Skin Analysis
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Get unlimited AI scans.
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
             <span>
                Monthly ₱{plans.find((p) => p.billingType === "monthly" && p.status === "active" && p.price > 0)?.price.toLocaleString() ?? "â€”"}
             </span>
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
             <span>
  Yearly ₱{plans.find((p) => p.billingType === "yearly" && p.status === "active" && p.price > 0)?.price.toLocaleString() ?? "—"}
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
                 <h2 className="text-lg font-bold text-gray-900">
                     {selectedPlan?.name ?? "Subscription Plan"}
                </h2>
                  <p className="text-xs text-gray-500">
                     {selectedPlan?.description || "Subscription Plan"}
                </p>
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
                  <span className="font-semibold text-gray-900">{basePrice.toLocaleString()}</span>
                </div>
                <div className="pt-3 border-t border-gray-100 flex justify-between items-baseline">
                  <span className="text-sm font-bold text-gray-900"> Due today</span>
                  <span className="text-xl font-bold text-magenta-600">
                     ₱{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Pro Features Included */}
              <div className="space-y-2.5 pt-4 border-t border-gray-100 mb-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    INCLUDED WITH {selectedPlan?.name?.toUpperCase() ?? "SUBSCRIPTION PLAN"}
                </p>

                <div className="space-y-2 text-xs text-gray-600">
                    {(selectedPlan?.features ?? []).map((feature, index) => (
                        <div key={`${selectedPlan?.id}-feature-${index}`} className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span>{feature}</span>
                        </div>
                    ))}

                    {(!selectedPlan?.features || selectedPlan.features.length === 0) && (
                        <p className="text-gray-400">
                            No additional features listed.
                        </p>
                    )}
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
                         Pay &amp; Activate (₱{total.toFixed(2)})
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









