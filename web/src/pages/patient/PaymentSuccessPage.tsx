import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, CalendarDays, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { useAuth } from "@/context/AuthContext";
import { splitVat, calculatePricing } from "@/lib/vat";
import { validateAndSyncSubscription, upgradeSubscriptionToPro } from "@/lib/subscriptionService";

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [netAmount, setNetAmount] = useState<number | null>(null);
  const [vatAmount, setVatAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");

  useEffect(() => {
    const verifyPayment = async () => {
      const params = new URLSearchParams(window.location.search);

      const intentId =
        params.get("payment_intent") ||
        params.get("payment_intent_id");

      const clientKey =
        params.get("payment_intent_client_key") ||
        sessionStorage.getItem(
          "dermai_pending_payment_intent_client_key"
        );

      if (!intentId || !clientKey) {
        setError("Payment information was not found.");
        setLoading(false);
        return;
      }

      try {
        
        const { data, error: verifyError } =
          await supabase.functions.invoke("paymongo-payment", {
            body: {
              action: "verify_payment_intent",
              paymentIntentId: intentId,
              clientKey,
            },
          });

        if (verifyError) {
          throw new Error(
            verifyError.message || "Failed to verify payment."
          );
        }

        const status =
          data?.attributes?.status || data?.status;
        if (status !== "succeeded") {
          throw new Error(
            `Payment was not completed. PayMongo status: ${
              status || "unknown"
            }`
          );
        }

        const attributes = data?.attributes;

        const amountInCentavos =
          attributes?.amount ??
          data?.amount ??
          null;

        if (typeof amountInCentavos === "number") {
          const totalCharged = amountInCentavos / 100;

          // VAT breakdown for the receipt.
          // 1. Check metadata from edge function / payment intent
          const metadata = attributes?.metadata ?? {};
          const metaBase = Number(metadata.base_amount ?? metadata.base_price ?? metadata.net_amount);
          const metaVat = Number(metadata.vat_amount);
          const metaTotal = Number(metadata.total_amount ?? metadata.total_price ?? metadata.amount_paid);

          // 2. Check pending calculations stored in sessionStorage during checkout
          const sessBase = Number(sessionStorage.getItem("dermai_pending_plan_base_price"));
          const sessVat = Number(sessionStorage.getItem("dermai_pending_plan_vat_amount"));
          const sessTotal = Number(sessionStorage.getItem("dermai_pending_plan_total_price"));

          // 3. Fallback to plan lookup dynamically if plan_id is available
          let resolvedBase = Number.isFinite(metaBase) && metaBase > 0 ? metaBase : (Number.isFinite(sessBase) && sessBase > 0 ? sessBase : NaN);
          let resolvedVat = Number.isFinite(metaVat) && metaVat > 0 ? metaVat : (Number.isFinite(sessVat) && sessVat > 0 ? sessVat : NaN);
          let resolvedTotal = Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : (Number.isFinite(sessTotal) && sessTotal > 0 ? sessTotal : totalCharged);

          if (!Number.isFinite(resolvedBase) || isNaN(resolvedBase)) {
            const planId = metadata.plan_id;
            if (planId) {
              const { data: planRow } = await supabase
                .from("plan")
                .select("price")
                .eq("plan_id", planId)
                .maybeSingle();
              if (planRow?.price != null) {
                const calc = calculatePricing(Number(planRow.price));
                resolvedBase = calc.basePrice;
                resolvedVat = calc.vatAmount;
                resolvedTotal = calc.totalPrice;
              }
            }
          }

          if (Number.isFinite(resolvedBase) && Number.isFinite(resolvedVat)) {
            setAmount(resolvedTotal);
            setNetAmount(resolvedBase);
            setVatAmount(resolvedVat);
          } else {
            const { net, vat } = splitVat(resolvedTotal);
            setAmount(resolvedTotal);
            setNetAmount(net);
            setVatAmount(vat);
          }
        }

        const payments = attributes?.payments ?? [];

        const payment = payments[0];

        const paymongoPaymentId = payment?.id;

        if (!paymongoPaymentId) {
          throw new Error("PayMongo payment ID was not found.");
        }

        setPaymentId(paymongoPaymentId);

        const methodType =
          payment?.attributes?.source?.type ||
          payment?.attributes?.payment_method_details?.type ||
          "";

        const methodLabel =
          methodType === "paymaya"
            ? "Maya"
            : methodType === "gcash"
            ? "GCash"
            : methodType || "Online Payment";

        setPaymentMethod(methodLabel);
        setPaymentDate(new Date().toISOString());

        sessionStorage.removeItem("dermai_pending_billing_cycle");
        sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
        sessionStorage.removeItem("dermai_pending_plan_base_price");
        sessionStorage.removeItem("dermai_pending_plan_vat_amount");
        sessionStorage.removeItem("dermai_pending_plan_total_price");

        // -------------------------------------------------------------
        // IMMEDIATE PLAN ACTIVATION, PROFILE SYNC & CACHE INVALIDATION
        // -------------------------------------------------------------
        const metadata = attributes?.metadata ?? {};
        let targetUserId = user?.id || metadata.user_id;
        if (!targetUserId) {
          try {
            const { data: authData } = await supabase.auth.getUser();
            targetUserId = authData?.user?.id;
          } catch {}
        }

        const billingCycle = (metadata.billing_cycle || sessionStorage.getItem("dermai_pending_billing_cycle") || "monthly") as "monthly" | "yearly";
        const planId = metadata.plan_id;
        const tierLabel = billingCycle === "yearly" ? "Pro (Annual)" : "Pro";
        const chargedAmount = typeof amountInCentavos === "number" ? amountInCentavos / 100 : 0;

        if (targetUserId) {
          try {
            // Fulfill DB activation, user profile sync, notification and audit log
            await upgradeSubscriptionToPro(targetUserId, {
              planId,
              billingCycle,
              paymentMethod: methodLabel,
              paymongoPaymentId,
              amount: chargedAmount,
            });
          } catch (subErr) {
            console.warn("[PaymentSuccessPage] upgradeSubscriptionToPro fallback warning:", subErr);
            await validateAndSyncSubscription(targetUserId);
          }

          // Clear stale cached plan claims in localStorage so header badge and layout immediately show 'Pro'
          try {
            const direct = localStorage.getItem(`derm_profile_${targetUserId}`);
            const parsedDirect = direct ? JSON.parse(direct) : {};
            localStorage.setItem(
              `derm_profile_${targetUserId}`,
              JSON.stringify({ ...parsedDirect, membershipTier: tierLabel, userId: targetUserId })
            );

            const globalCached = localStorage.getItem("dermai_patient_profile");
            const parsedGlobal = globalCached ? JSON.parse(globalCached) : {};
            localStorage.setItem(
              "dermai_patient_profile",
              JSON.stringify({ ...parsedGlobal, membershipTier: tierLabel, userId: targetUserId })
            );
          } catch {}

          // Invalidate and refetch active subscription queries via custom events
          window.dispatchEvent(
            new CustomEvent("dermai_subscription_updated", {
              detail: { userId: targetUserId, tier: tierLabel, status: "active" },
            })
          );
          window.dispatchEvent(new CustomEvent("derm_profile_updated"));
          window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
          window.dispatchEvent(new Event("storage"));
        }

        logAuditEvent({
          userId: targetUserId || user?.id,
          role: "patient",
          category: "Subscription",
          action: "Payment Completed",
          target: `PayMongo ID: ${paymongoPaymentId}`,
          details: `Patient completed payment of ₱${chargedAmount.toLocaleString()} via ${methodLabel}.`,
          metadata: {
            paymentId: paymongoPaymentId,
            amount: chargedAmount,
            method: methodType,
          },
        }).catch(() => {});

        // Receipt dispatch is recorded in system_audit_log by the edge functions with the
        // real recipient/transaction.
        if (data?.fulfillment?.emailDispatched === false) {
          console.warn(
            "[PaymentSuccessPage] Receipt email was not dispatched initially, attempting retry...",
            data?.fulfillment?.emailError || data?.fulfillment?.error
          );
          try {
            await supabase.functions.invoke("paymongo-payment", {
              body: {
                action: "send_receipt_email",
                paymentIntentId: intentId,
                clientKey,
              },
            });
          } catch (retryErr) {
            console.error("[PaymentSuccessPage] Receipt retry failed:", retryErr);
          }
        }
      } catch (err: unknown) {
        console.error(
          "[PaymentSuccessPage] Verification failed:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "Failed to verify payment."
        );
      } finally {
        setLoading(false);
      }
    };

    verifyPayment();
  }, []);

  const formatAmount = (value: number | null) => {
    if (value === null) return "N/A";

    return `${value.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  /* ------------------------------ Loading ------------------------------ */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDF2F7] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-[#F4C9DC] shadow-sm px-8 py-10 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-[#F4C9DC] border-t-[#A21D5C] animate-spin mx-auto mb-5" />
          <h1 className="text-base font-semibold text-gray-900 tracking-tight">
            Verifying your payment
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
            Please wait while we confirm your PayMongo payment.
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------------- Error ------------------------------- */
  if (error) {
    return (
      <div className="min-h-screen bg-[#FDF2F7] flex items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-[#F4C9DC] shadow-sm overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-[#A21D5C] to-[#7E1448]" />

          <div className="p-8">
            <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 text-red-500 flex items-center justify-center mb-5">
              <AlertCircle className="w-6 h-6" />
            </div>

            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
              Payment Verification Failed
            </h1>

            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              {error}
            </p>

            <div className="mt-6 rounded-xl bg-[#FDF2F7] border border-[#F4C9DC] px-4 py-3 text-xs text-gray-600 leading-relaxed">
              If you were charged, please keep your payment reference and
              contact DermAI support so we can assist you.
            </div>

            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="mt-6 w-full rounded-xl bg-[#A21D5C] text-white py-3 text-sm font-semibold tracking-wide hover:bg-[#7E1448] focus:outline-none focus:ring-2 focus:ring-[#A21D5C]/40 focus:ring-offset-2 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ Success ------------------------------ */
  return (
    <div className="min-h-screen bg-[#FDF2F7] text-gray-900 px-4 py-10 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl border border-[#F4C9DC] shadow-[0_10px_40px_-12px_rgba(162,29,92,0.25)] overflow-hidden">
          {/* Brand header */}
          <div className="bg-gradient-to-br from-[#A21D5C] to-[#7E1448] px-8 pt-8 pb-14 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-pink-100/90">
              DermAI
            </p>
            <p className="text-xs text-pink-100/70 mt-1 tracking-wide">
              Official Payment Receipt
            </p>
          </div>

          {/* Status */}
          <div className="px-8 -mt-9 text-center">
            <div className="w-[72px] h-[72px] rounded-full bg-emerald-500 border-4 border-white shadow-md flex items-center justify-center mx-auto text-white">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mt-4">
              Payment Received
            </h1>

            <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
              Your DermAI subscription payment was successfully confirmed.
            </p>
          </div>

          {/* Amount */}
          <div className="px-8 pt-6">
            <div className="rounded-xl bg-[#FDF2F7] border border-[#F4C9DC] px-6 py-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                Total Paid
              </p>
              <p className="text-3xl font-bold text-[#A21D5C] mt-1 tracking-tight">
                ₱{formatAmount(amount)}
              </p>
            </div>
          </div>

          {/* Receipt details */}
          <div className="px-8 pt-7 pb-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
              Payment Details
            </h2>

            <dl className="divide-y divide-gray-100 text-sm">
              <div className="flex justify-between gap-6 py-3.5">
                <dt className="text-gray-500">Account</dt>
                <dd className="font-medium text-gray-900 text-right break-all">
                  {user?.email || "Patient Account"}
                </dd>
              </div>

              <div className="flex justify-between gap-6 py-3.5">
                <dt className="text-gray-500">Description</dt>
                <dd className="font-medium text-gray-900 text-right">
                  DermAI Subscription
                </dd>
              </div>

              {netAmount != null && vatAmount != null && (
                <>
                  <div className="flex justify-between gap-6 py-3.5">
                    <dt className="text-gray-500">Subtotal (Net of VAT)</dt>
                    <dd className="font-medium text-gray-900 text-right">
                      ₱{formatAmount(netAmount)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-6 py-3.5">
                    <dt className="text-gray-500">VAT (12%)</dt>
                    <dd className="font-medium text-gray-900 text-right">
                      ₱{formatAmount(vatAmount)}
                    </dd>
                  </div>
                </>
              )}

              <div className="flex justify-between gap-6 py-3.5">
                <dt className="text-gray-500">Payment Method</dt>
                <dd className="font-medium text-gray-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#A21D5C]" />
                  {paymentMethod || "Online Payment"}
                </dd>
              </div>

              <div className="flex justify-between gap-6 py-3.5">
                <dt className="text-gray-500">Date</dt>
                <dd className="font-medium text-gray-900 flex items-center gap-1.5 text-right">
                  <CalendarDays className="w-4 h-4 text-[#A21D5C] shrink-0" />
                  {paymentDate
                    ? new Date(paymentDate).toLocaleString(
                        "en-PH",
                        {
                          dateStyle: "long",
                          timeStyle: "short",
                        }
                      )
                    : "—"}
                </dd>
              </div>

              <div className="flex justify-between gap-6 py-3.5">
                <dt className="text-gray-500 shrink-0">Transaction ID</dt>
                <dd className="font-mono text-xs text-gray-700 text-right break-all bg-gray-50 border border-gray-100 rounded-md px-2 py-1">
                  {paymentId}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={async () => {
                if (user?.id) {
                  await validateAndSyncSubscription(user.id);
                }
                navigate("/dashboard");
              }}
              className="mt-7 w-full rounded-xl bg-[#A21D5C] text-white py-3 text-sm font-semibold tracking-wide hover:bg-[#7E1448] focus:outline-none focus:ring-2 focus:ring-[#A21D5C]/40 focus:ring-offset-2 transition-colors cursor-pointer"
            >
              Continue to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
