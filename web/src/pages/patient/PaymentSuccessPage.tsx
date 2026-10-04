import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, CreditCard, CalendarDays, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
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
          setAmount(amountInCentavos / 100);
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

        setPaymentMethod(
          methodType === "paymaya"
            ? "Maya"
            : methodType === "gcash"
            ? "GCash"
            : methodType || "Online Payment"
        );

        setPaymentDate(new Date().toISOString());

        sessionStorage.removeItem(
          "dermai_pending_billing_cycle"
        );

        sessionStorage.removeItem(
          "dermai_pending_payment_intent_client_key"
        );
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-magenta-500 animate-spin mx-auto mb-4" />
          <h1 className="text-lg font-bold text-gray-900">
            Verifying your payment...
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Please wait while we confirm your PayMongo payment.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-3xl border border-gray-100 shadow-sm p-7">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>

          <h1 className="text-xl font-bold text-gray-900">
            Payment Verification Failed
          </h1>

          <p className="text-sm text-gray-500 mt-2">
            {error}
          </p>

          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="mt-6 w-full rounded-xl bg-gray-900 text-white py-3 text-sm font-semibold hover:bg-gray-800 transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-8 text-center border-b border-gray-100">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <h1 className="text-2xl font-bold text-gray-900">
              Payment Received!
            </h1>

            <p className="text-sm text-gray-500 mt-2">
              Your DermAI subscription payment was successfully
              confirmed
            </p>
          </div>

          <div className="p-8">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-lg font-bold text-gray-900">
                Payment Receipt
              </h2>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">
                  Account
                </span>
                <span className="font-semibold text-gray-900 text-right">
                  {user?.email || "Patient Account"}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-gray-500">
                  Description
                </span>
                <span className="font-semibold text-gray-900">
                  DermAI Subscription
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-gray-500">
                  Payment Method
                </span>
                <span className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4" />
                  {paymentMethod || "Online Payment"}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-gray-500">
                  Date
                </span>
                <span className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <CalendarDays className="w-4 h-4" />
                  {paymentDate
                    ? new Date(paymentDate).toLocaleString(
                        "en-PH",
                        {
                          dateStyle: "long",
                          timeStyle: "short",
                        }
                      )
                    : "â€”"}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-gray-500">
                  Transaction ID
                </span>
                <span className="font-mono text-xs text-gray-700 text-right break-all">
                  {paymentId}
                </span>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                <span className="font-bold text-gray-900">
                  Total Paid
                </span>

                <span className="text-xl font-bold text-magenta-600">
                 ₱{formatAmount(amount)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


