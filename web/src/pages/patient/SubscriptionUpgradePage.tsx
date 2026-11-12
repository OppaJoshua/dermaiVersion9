import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Calendar, CalendarDays, AlertCircle, CheckCircle2, Loader2, PackageOpen } from "lucide-react";
import { getSubscriptionPlansAsync, type SubscriptionPlan } from "@/lib/store";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { withVat, calculatePricing } from "@/lib/vat";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";
import SubscriptionAgreementModal from "../../components/common/SubscriptionAgreementModal";
import { validateAndSyncSubscription } from "@/lib/subscriptionService";

// PayMongo is handled by the Supabase Edge Function.
const PAYMONGO_PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || "";

/**
 * Validates that a plan is active, visible to patients, and a paid plan (not Free).
 */
function isPlanEligibleForPurchase(
  plan: SubscriptionPlan | null | undefined,
  cycle?: "monthly" | "yearly"
): plan is SubscriptionPlan {
  if (!plan || !plan.id) return false;
  if (plan.status !== "active") return false;
  if ( !(Number(plan.price) > 0) ) return false;
  if (/^free(\s+plan)?$/i.test((plan.name || "").trim())) return false;

  // Respect any optional patient-visibility flags if present on the plan object
  const raw = plan as unknown as Record<string, unknown>;
  if (
    raw.visible_to_patients === false ||
    raw.visibleToPatients === false ||
    raw.is_visible === false ||
    raw.isVisible === false ||
    raw.hidden === true
  ) {
    return false;
  }

  if (cycle && plan.billingType !== cycle) return false;
  return true;
}

function formatScanLimit(scanLimit: number | null | undefined): string {
  if (scanLimit === null || scanLimit === undefined || scanLimit === -1) {
    return "Unlimited AI Scans";
  }
  return `${scanLimit} AI Scan${scanLimit === 1 ? "" : "s"}`;
}

export default function SubscriptionUpgradePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAgreementOpen, setIsAgreementOpen] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const hasValidatedPreselection = useRef(false);
  const autoSelectedPlanIdRef = useRef<string | null>(null);

  // Controlled form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "maya">("gcash");
  const [mobileNumber, setMobileNumber] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoadingPlans(true);
    getSubscriptionPlansAsync(false)
      .then((fetchedPlans) => {
        if (cancelled) return;
        setPlans(fetchedPlans);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPlans(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Validate any URL or sessionStorage preselected plan once plans are loaded
  useEffect(() => {
    if (isLoadingPlans || hasValidatedPreselection.current) return;
    hasValidatedPreselection.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlCycle = params.get("billingCycle") || params.get("billing_cycle");
    const urlPlanId =
      params.get("planId") ||
      params.get("plan_id") ||
      params.get("plan");

    let storedPlanId: string | null = null;
    let storedCycle: string | null = null;
    try {
      storedPlanId =
        sessionStorage.getItem("dermai_chosen_plan") ||
        sessionStorage.getItem("dermai_pending_plan_id");
      storedCycle = sessionStorage.getItem("dermai_pending_billing_cycle");
    } catch {
      /* ignore storage errors */
    }

    const candidateCycle =
      urlCycle === "monthly" || urlCycle === "yearly"
        ? urlCycle
        : storedCycle === "monthly" || storedCycle === "yearly"
        ? storedCycle
        : null;

    const candidatePlanId = urlPlanId || storedPlanId;

    if (candidatePlanId) {
      const matched = plans.find((p) => p.id === candidatePlanId);
      if (isPlanEligibleForPurchase(matched)) {
        setBillingCycle(matched.billingType);
        setSelectedPlanId(matched.id);
        autoSelectedPlanIdRef.current = null;
        return;
      } else {
        // Preselected plan is missing, inactive, hidden, or Free — reject selection
        setSelectedPlanId(null);
        try {
          sessionStorage.removeItem("dermai_chosen_plan");
          sessionStorage.removeItem("dermai_pending_plan_id");
        } catch {
          /* ignore */
        }
      }
    }

    if (candidateCycle) {
      setBillingCycle(candidateCycle);
    }
  }, [plans, isLoadingPlans]);

  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    // 1. Initial fast population from user context and metadata
    if (user.email) setEmail((prev) => prev || user.email || "");
    if (user.user_metadata?.full_name) setFullName((prev) => prev || user.user_metadata.full_name || "");
    if (user.user_metadata?.address) setAddress((prev) => prev || user.user_metadata.address || "");

    // 2. Read local profile cache for instant prefill
    try {
      const localSaved = localStorage.getItem(`derm_profile_${userId}`);
      if (localSaved) {
        const parsed = JSON.parse(localSaved);
        if (parsed.fullName) setFullName((prev) => prev || parsed.fullName);
        if (parsed.address) setAddress((prev) => prev || parsed.address);
        if (parsed.contactNumber) {
          const cleaned = String(parsed.contactNumber).replace(/\D/g, "");
          const formatted = cleaned.startsWith("63") && cleaned.length === 12
            ? "0" + cleaned.slice(2)
            : cleaned.slice(0, 11);
          if (formatted) setMobileNumber((prev) => prev || formatted);
        }
      }
    } catch {
      /* ignore */
    }

    // 3. Query Supabase public.user to get the patient's saved personal information
    async function loadPatientProfile() {
      try {
        const { data: dbUser } = await supabase
          .from("user")
          .select("full_name, email, phone, address, district")
          .eq("user_id", userId)
          .maybeSingle();

        if (dbUser) {
          if (dbUser.full_name) setFullName((prev) => prev || dbUser.full_name);
          if (dbUser.email) setEmail((prev) => prev || dbUser.email);

          // Build billing address from personal information (complete address + district)
          let resolvedAddress = (dbUser.address || "").trim();
          const district = (dbUser.district || "").trim();

          if (resolvedAddress && district) {
            if (!resolvedAddress.toLowerCase().includes(district.toLowerCase())) {
              resolvedAddress = `${resolvedAddress}, ${district}`;
            }
          } else if (!resolvedAddress && district) {
            resolvedAddress = district;
          }

          if (resolvedAddress) {
            setAddress((prev) => prev || resolvedAddress);
          }

          if (dbUser.phone) {
            const cleaned = String(dbUser.phone).replace(/\D/g, "");
            const formatted = cleaned.startsWith("63") && cleaned.length === 12
              ? "0" + cleaned.slice(2)
              : cleaned.slice(0, 11);
            if (formatted) setMobileNumber((prev) => prev || formatted);
          }
        }

        // 4. Fallback: check if the patient has a previous subscription with a saved billing_address
        const { data: pastSub } = await supabase
          .from("user_plan_subscription")
          .select("billing_address, payment_mobile_number, payment_full_name")
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pastSub) {
          if (pastSub.billing_address) setAddress((prev) => prev || pastSub.billing_address);
          if (pastSub.payment_mobile_number) {
            const cleaned = String(pastSub.payment_mobile_number).replace(/\D/g, "");
            const formatted = cleaned.startsWith("63") && cleaned.length === 12
              ? "0" + cleaned.slice(2)
              : cleaned.slice(0, 11);
            if (formatted) setMobileNumber((prev) => prev || formatted);
          }
          if (pastSub.payment_full_name) setFullName((prev) => prev || pastSub.payment_full_name);
        }
      } catch (err) {
        console.warn("[upgrade] Could not load profile details for auto-fill:", err);
      }
    }

    loadPatientProfile();
  }, [user]);

  const availablePlans = plans.filter((p) =>
    isPlanEligibleForPurchase(p, billingCycle)
  );

  // Strict selection: never fall back to availablePlans[0]
  const selectedPlan = selectedPlanId
    ? availablePlans.find((p) => p.id === selectedPlanId) ?? null
    : null;

  // Clear selection whenever it does not belong to the active billing cycle or becomes ineligible
  useEffect(() => {
    if (!selectedPlanId || isLoadingPlans) return;
    const match = plans.find((p) => p.id === selectedPlanId);
    if (!isPlanEligibleForPurchase(match, billingCycle)) {
      setSelectedPlanId(null);
    }
  }, [plans, billingCycle, selectedPlanId, isLoadingPlans]);

  // Auto-select when exactly one eligible plan exists for the active billing cycle;
  // If plans increase to 2 or more, safely clear any stale auto-selection so manual selection is preserved.
  useEffect(() => {
    if (isLoadingPlans) return;

    if (availablePlans.length === 1) {
      const singlePlan = availablePlans[0];
      if (selectedPlanId !== singlePlan.id) {
        setSelectedPlanId(singlePlan.id);
        autoSelectedPlanIdRef.current = singlePlan.id;
      }
    } else if (availablePlans.length >= 2) {
      if (autoSelectedPlanIdRef.current && selectedPlanId === autoSelectedPlanIdRef.current) {
        setSelectedPlanId(null);
        autoSelectedPlanIdRef.current = null;
      }
    } else {
      // availablePlans.length === 0
      autoSelectedPlanIdRef.current = null;
    }
  }, [availablePlans, selectedPlanId, isLoadingPlans]);

  const handleBillingCycleChange = (nextCycle: "monthly" | "yearly") => {
    setBillingCycle(nextCycle);
    setError(null);
    setSelectedPlanId((prevId) => {
      if (!prevId) return null;
      const match = plans.find((p) => p.id === prevId);
      return isPlanEligibleForPurchase(match, nextCycle) ? prevId : null;
    });
  };

  const handleSelectPlan = (planId: string) => {
    const target = availablePlans.find((p) => p.id === planId);
    if (!isPlanEligibleForPurchase(target, billingCycle)) {
      setSelectedPlanId(null);
      autoSelectedPlanIdRef.current = null;
      setError("The selected subscription plan is no longer available.");
      return;
    }
    setSelectedPlanId(target.id);
    autoSelectedPlanIdRef.current = null;
    setError(null);
  };

  // Pricing Formula:
  // vat_amount = round(base_price * 0.12, 2)
  // total_price = round(base_price + vat_amount, 2)
  // For base_price = 177.68, vat_amount = 21.32 and total_price = 199.00.
  const basePrice = Number(selectedPlan?.price ?? 0);
  const pricing = calculatePricing(basePrice);
  const total = pricing.totalPrice;
  const vatAmount = pricing.vatAmount;
  const amountInCentavos = pricing.amountInCentavos;
  const billingLabel = billingCycle === "monthly" ? "Monthly" : "Yearly";
  const currentPlanId = selectedPlan?.id;

  // Price shown on the Monthly / Yearly toggle buttons (VAT-inclusive)
  const togglePrice = (type: "monthly" | "yearly") => {
    if (selectedPlan && selectedPlan.billingType === type) {
      return withVat(selectedPlan.price).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    const eligibleForCycle = plans.filter((x) =>
      isPlanEligibleForPurchase(x, type)
    );
    const p = eligibleForCycle[0];
    return p
      ? withVat(p.price).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";
  };


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

      // If this is a normal visit to the upgrade page,
      // there is no payment to verify.
      if (!intentId || !clientKey) {
        setIsSubscribing(false);
        return;
      }

      try {
        setIsSubscribing(true);
        setError(null);

        const { data, error: verifyError } =
          await supabase.functions.invoke("paymongo-payment", {
            body: {
              action: "verify_payment_intent",
              paymentIntentId: intentId,
              clientKey,
            },
          });

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

        if (paymentStatus === "succeeded") {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedPlan || !currentPlanId || !isPlanEligibleForPurchase(selectedPlan, billingCycle) || total <= 0) {
      setError("Please select an available subscription plan before proceeding to payment.");
      return;
    }

    if (!fullName.trim() || !email.trim() || !address.trim() || !mobileNumber.trim()) {
      setError("Please complete your full name, email address, billing address, and mobile number.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!/^\d{11}$/.test(mobileNumber)) {
      setError("Please enter a valid 11-digit mobile number.");
      return;
    }

    if (!user?.id) {
      setError("You must be logged in to subscribe.");
      return;
    }

    setAgreementAccepted(false);
    setIsAgreementOpen(true);
  };

  const handleAgreeAndPay = async () => {
    if (!agreementAccepted) {
      setError("Please review and accept the DermAI Subscription Agreement before proceeding.");
      return;
    }

    if (!user?.id) {
      setError("You must be logged in to subscribe.");
      setIsAgreementOpen(false);
      return;
    }

    if (!selectedPlan || !currentPlanId || !isPlanEligibleForPurchase(selectedPlan, billingCycle) || total <= 0) {
      setSelectedPlanId(null);
      setIsAgreementOpen(false);
      setError("Please select an available subscription plan before proceeding to payment.");
      return;
    }

    setIsAgreementOpen(false);
    setIsSubscribing(true);
    setError(null);

    try {
    // Re-verify plan eligibility from the database right before checkout so deactivated/hidden plans cannot be purchased
    const latestPlans = await getSubscriptionPlansAsync(false);
    setPlans(latestPlans);
    const verifiedPlan = latestPlans.find((p) => p.id === currentPlanId);
    if (!isPlanEligibleForPurchase(verifiedPlan, billingCycle)) {
      setSelectedPlanId(null);
      throw new Error(
        "The selected subscription plan is no longer active or available. Please select an available plan to continue."
      );
    }

    // Frontend guard: validate and auto-synchronize subscription status
    const subInfo = await validateAndSyncSubscription(user.id);
    const existingSubscription = subInfo.subscription;

    if (subInfo.isPro) {
      if (existingSubscription?.cancel_at_period_end) {
        throw new Error(
          "Your Pro subscription is still active until the end of your current billing period. Resume your subscription from Billing Settings instead of purchasing again."
        );
      }

      throw new Error(
        "You already have an active Pro subscription. You cannot purchase another Pro subscription until the current billing period ends."
      );
    }

    // Save calculation and billing cycle so we can restore it after a 3DS redirect and in receipt
    sessionStorage.setItem("dermai_pending_billing_cycle", billingCycle);
    sessionStorage.setItem("dermai_pending_plan_id", currentPlanId);
    sessionStorage.setItem("dermai_pending_plan_base_price", String(basePrice));
    sessionStorage.setItem("dermai_pending_plan_vat_amount", String(vatAmount));
    sessionStorage.setItem("dermai_pending_plan_total_price", String(total));

    // 1. Create Payment Intent through the Supabase Edge Function
    // Passes gross total_price (e.g. 199.00 / 19900 centavos) and breakdown
    const { data: intentJson, error: intentError } =
      await supabase.functions.invoke("paymongo-payment", {
        body: {
          paymentMethod: paymentMethod,
          userId: user.id,
          planId: currentPlanId,
          billingCycle: billingCycle,
          fullName,
          email,
          address,
          mobileNumber,
          basePrice,
          vatAmount,
          totalPrice: total,
          amountInCentavos,
          amount: amountInCentavos,
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

      sessionStorage.removeItem(
        "dermai_pending_billing_cycle"
      );

      sessionStorage.removeItem(
        "dermai_pending_plan_id"
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
    <div className="min-h-screen bg-patient-bg text-gray-900 pt-8 pb-20 px-4 font-sans antialiased">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Unlock Unlimited AI Skin Analysis
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Select a subscription plan to upgrade your DermAI account.
          </p>

          {/* Billing Cycle Toggle */}
          <div className="mt-6 inline-flex p-1 bg-gray-100 rounded-2xl border border-gray-200/60 max-w-xs w-full">
            <button
              type="button"
              onClick={() => handleBillingCycleChange("monthly")}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                billingCycle === "monthly"
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Calendar className="w-3.5 h-3.5 text-magenta-500" />
              <span>Monthly ₱{togglePrice("monthly")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleBillingCycleChange("yearly")}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 relative cursor-pointer",
                billingCycle === "yearly"
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <CalendarDays className="w-3.5 h-3.5 text-magenta-500" />
              <span>Yearly ₱{togglePrice("yearly")}</span>
            </button>
          </div>
        </div>

        {/* Selectable Subscription Plan Cards (hidden when exactly one plan is available) */}
        {(isLoadingPlans || availablePlans.length !== 1) && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3 px-1">
              <div>
                <h2 className="text-sm font-bold text-gray-900">
                  Available {billingLabel} Plans
                </h2>
                <p className="text-xs text-gray-500">
                  Choose one {billingCycle} plan below to continue with payment
                </p>
              </div>
              {availablePlans.length > 0 && (
                <span className="text-xs font-medium text-gray-500">
                  {availablePlans.length} {availablePlans.length === 1 ? "plan" : "plans"} available
                </span>
              )}
            </div>

            {isLoadingPlans ? (
              <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center shadow-xs">
                <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-2.5" />
                <p className="text-xs font-medium text-gray-500">
                  Loading available subscription plans...
                </p>
              </div>
            ) : availablePlans.length === 0 ? (
              <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center shadow-xs">
                <PackageOpen className="w-9 h-9 text-gray-300 mx-auto mb-2.5" />
                <p className="text-sm font-bold text-gray-800">
                  No {billingLabel.toLowerCase()} plans available right now
                </p>
                <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                  There are currently no active {billingLabel.toLowerCase()} subscription plans available for purchase. Please switch billing cycles or check back later.
                </p>
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label={`Available ${billingLabel} Subscription Plans`}
                className={cn(
                  "grid gap-4",
                  availablePlans.length === 1
                    ? "grid-cols-1 max-w-xl mx-auto"
                    : "grid-cols-1 md:grid-cols-2"
                )}
              >
                {availablePlans.map((plan) => {
                  const isSelected = selectedPlan?.id === plan.id;
                  const planPricing = calculatePricing(Number(plan.price));
                  const planCycleLabel = plan.billingType === "yearly" ? "Yearly" : "Monthly";
                  const planScanLimitLabel = formatScanLimit(plan.scanLimit);

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => handleSelectPlan(plan.id)}
                      className={cn(
                        "w-full text-left rounded-3xl p-5 sm:p-6 border transition-all flex flex-col justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-magenta-500/25",
                        isSelected
                          ? "border-2 border-magenta-600 bg-magenta-50/20 shadow-xs ring-2 ring-magenta-500/10"
                          : "border-gray-200 bg-white hover:border-magenta-300 hover:bg-gray-50/40"
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-base font-bold text-gray-900">
                                {plan.name}
                              </h3>
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">
                                {planCycleLabel}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {plan.description || "Subscription Plan"}
                            </p>
                          </div>

                          <div
                            className={cn(
                              "w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                              isSelected
                                ? "border-magenta-600 bg-magenta-600 text-white"
                                : "border-gray-300 bg-white"
                            )}
                          >
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </div>
                        </div>

                        <div className="flex items-baseline gap-1.5 mb-3">
                          <span className="text-2xl font-bold text-gray-900">
                            ₱{planPricing.totalPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <span className="text-xs text-gray-500 font-medium">
                            / {plan.billingType === "yearly" ? "year" : "month"}
                          </span>
                        </div>

                        <div className="mb-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200/60">
                            Scan Limit: {planScanLimitLabel}
                          </span>
                        </div>

                        <div className="space-y-1.5 pt-3 border-t border-gray-100 text-xs text-gray-600">
                          {(plan.features ?? []).map((feature, idx) => (
                            <div
                              key={`${plan.id}-card-feature-${idx}`}
                              className="flex items-center gap-2"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span>{feature}</span>
                            </div>
                          ))}
                          {(!plan.features || plan.features.length === 0) && (
                            <p className="text-gray-400">No additional features listed.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            isSelected ? "text-magenta-600" : "text-gray-500"
                          )}
                        >
                          {isSelected ? "Selected Plan" : "Click to select this plan"}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-magenta-600 text-white text-[10px] font-bold uppercase tracking-wide">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Order Summary & Features (5 cols) */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-5 space-y-4"
          >
            <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-xs">
              <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-100">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {selectedPlan ? selectedPlan.name : "No Plan Selected"}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {selectedPlan
                      ? selectedPlan.description || "Subscription Plan"
                      : `Select a ${billingLabel.toLowerCase()} plan above to view summary`}
                  </p>
                </div>
              </div>

              {/* Price Breakdown */}
              <div className="space-y-3 text-xs mb-6">
                <div className="flex justify-between items-center text-gray-600">
                  <span>Billing Plan</span>
                  <span className="font-semibold text-gray-900">
                    {selectedPlan ? billingLabel : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span>Scan Limit</span>
                  <span className="font-semibold text-gray-900">
                    {selectedPlan ? formatScanLimit(selectedPlan.scanLimit) : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span>Price</span>
                  <span className="font-semibold text-gray-900">
                    ₱{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
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
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    INCLUDED WITH {selectedPlan?.name?.toUpperCase() ?? "SELECTED PLAN"}
                </p>

                {selectedPlan ? (
                  <div className="space-y-2 text-xs text-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>Scan Limit: {formatScanLimit(selectedPlan.scanLimit)}</span>
                    </div>
                    {(selectedPlan.features ?? []).map((feature, index) => (
                      <div key={`${selectedPlan.id}-feature-${index}`} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}

                    {(!selectedPlan.features || selectedPlan.features.length === 0) && (
                      <p className="text-gray-400">
                        No additional features listed.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    Select an available plan above to see its included benefits and scan limit.
                  </p>
                )}
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
                    disabled={isSubscribing || !selectedPlan || availablePlans.length === 0 || total <= 0}
                    className="w-full py-3.5 bg-magenta-600 text-white rounded-full font-semibold text-sm shadow-sm hover:bg-magenta-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubscribing ? (
                      "Processing Payment..."
                    ) : !selectedPlan ? (
                      "Select a Plan to Continue"
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
      <SubscriptionAgreementModal
        open={isAgreementOpen}
        accepted={agreementAccepted}
        onAcceptedChange={setAgreementAccepted}
        onCancel={() => {
          setIsAgreementOpen(false);
          setAgreementAccepted(false);
        }}
        onAgree={handleAgreeAndPay}
      />
    </div>
  );
}