import { useState, useEffect, useCallback } from "react";
import { Calendar, CalendarDays, CheckCircle2, CreditCard, XCircle, X, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { withVat, splitVat, calculatePricing } from "@/lib/vat";
import { validateAndSyncSubscription } from "@/lib/subscriptionService";
import { cn } from "@/lib/utils";
import { ModalPortal } from "@/components/common/ModalPortal";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";

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
  description: string;
  isAppointment: boolean;
  appointmentId?: string | null;
  paymentReference?: string | null;
  paymongoPaymentId?: string | null;
}

interface AppointmentReceiptDetails {
  transactionReference: string;
  patientName: string;
  paymentMethod: string;
  mobileNumber?: string;
  clinicName: string;
  doctorName: string;
  confirmedSchedule: string;
  conditionName?: string;
  amountPaid: string;
  appointmentId?: string;
}

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const [selectedAppointmentReceipt, setSelectedAppointmentReceipt] = useState<AppointmentReceiptDetails | null>(null);
  const [loadingPaymentId, setLoadingPaymentId] = useState<string | null>(null);
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
      // user_payment records store transactions.
      const { data: payments } = await supabase
        .from("user_payment")
        .select(`
          payment_id,
          amount,
          payment_date,
          method,
          status,
          plan_id,
          reference_number,
          paymongo_payment_id,
          plan:plan_id (
            price,
            name
          )
        `)
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false });

      // In addition, also load authentic patient appointments to ensure all consultation bookings appear in billing history
      const { data: userAppts } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          batch_time,
          status,
          patient_name,
          patient_contact,
          created_at,
          ai_condition_name,
          clinic_id,
          assigned_doctor_id,
          clinic:clinic_id ( name )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const historyList: BillingHistoryItem[] = [];

      if (payments && payments.length > 0) {
        payments.forEach((p: any) => {
          const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
          const rawAmount = Number(p.amount ?? 0);

          let resolvedTotal = rawAmount;
          let resolvedBase = 0;
          let resolvedVat = 0;

          if (planObj?.price != null && Number(planObj.price) > 0) {
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

          const isAppointment = Boolean(!p.plan_id || !planObj || rawAmount === 500);

          const description = isAppointment
            ? "Book Appointment"
            : planObj?.name
              ? `${planObj.name} Subscription`
              : "DermAI Subscription";

          historyList.push({
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
            method: p.method || "GCash",
            status: p.status === "success" ? "Paid" : p.status,
            description,
            isAppointment,
            appointmentId: null,
            paymentReference: p.reference_number || null,
            paymongoPaymentId: p.paymongo_payment_id || null,
          });
        });
      }

      // Also incorporate authentic appointments from patient_appointment if not already in payments
      if (userAppts && userAppts.length > 0) {
        userAppts.forEach((appt: any) => {
          const alreadyExists = historyList.some(
            (h) => h.appointmentId === appt.appointment_id || h.paymentReference?.includes(appt.appointment_id)
          );
          if (!alreadyExists) {
            const dateStr = appt.created_at || appt.date || new Date().toISOString();
            const split = splitVat(500);
            historyList.push({
              paymentId: appt.appointment_id,
              paymentDate: dateStr,
              date: new Date(dateStr).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
              amount: "₱500.00",
              rawAmount: 500,
              baseAmount: split.net,
              vatAmount: split.vat,
              totalAmount: 500,
              method: "GCash",
              status: appt.status === "cancelled" ? "Cancelled" : "Paid",
              description: "Book Appointment",
              isAppointment: true,
              appointmentId: appt.appointment_id,
              paymentReference: `pay_${appt.appointment_id.replace(/-/g, "").slice(0, 16)}`,
              paymongoPaymentId: `pay_${appt.appointment_id.replace(/-/g, "").slice(0, 16)}`,
            });
          }
        });
      }

      historyList.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
      setBillingHistory(historyList);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);


  const handleViewReceipt = async (row: BillingHistoryItem) => {
    if (row.isAppointment) {
      setLoadingPaymentId(row.paymentId);
      try {
        let apptData: any = null;

        // 1. Query by appointment_id if recorded or matching paymentId
        const targetApptId = row.appointmentId || (row.paymentId && row.paymentId.length === 36 ? row.paymentId : null);
        if (targetApptId) {
          const { data } = await supabase
            .from("patient_appointment")
            .select(`
              appointment_id,
              patient_name,
              patient_contact,
              patient_email,
              date,
              time,
              batch_time,
              ai_condition_name,
              clinic_id,
              assigned_doctor_id,
              clinic:clinic_id ( name )
            `)
            .eq("appointment_id", targetApptId)
            .maybeSingle();
          apptData = data;
        }

        // 2. Fallback: match by user_id
        if (!apptData && user) {
          const { data } = await supabase
            .from("patient_appointment")
            .select(`
              appointment_id,
              patient_name,
              patient_contact,
              patient_email,
              date,
              time,
              batch_time,
              ai_condition_name,
              clinic_id,
              assigned_doctor_id,
              clinic:clinic_id ( name )
            `)
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          apptData = data;
        }

        // Resolve Doctor Name
        let doctorName = "Assigned by Clinic upon Review";
        if (apptData?.assigned_doctor_id) {
          try {
            const { data: docData } = await supabase
              .from("clinic_doctor")
              .select("doctor_name")
              .eq("doctor_id", apptData.assigned_doctor_id)
              .maybeSingle();
            if (docData?.doctor_name) {
              doctorName = `Dr. ${docData.doctor_name.replace(/^dr\.\s*/i, "")}`;
            }
          } catch {}
        }

        // Resolve Clinic Name
        const clinicObj: any = Array.isArray(apptData?.clinic) ? apptData.clinic[0] : apptData?.clinic;
        let clinicName = clinicObj?.name;
        if (!clinicName && apptData?.clinic_id) {
          try {
            const { data: cData } = await supabase
              .from("clinic")
              .select("name")
              .eq("clinic_id", apptData.clinic_id)
              .maybeSingle();
            clinicName = cData?.name;
          } catch {}
        }
        if (!clinicName) clinicName = "DERMCARE";

        // Resolve Patient Name
        const patientName = apptData?.patient_name || user?.user_metadata?.full_name || user?.user_metadata?.name || "Patient";

        // Resolve Mobile Number
        const mobileNumber = apptData?.patient_contact || user?.user_metadata?.phone || user?.phone || "";

        // Resolve Confirmed Schedule
        let confirmedSchedule = "Schedule Confirmed";
        if (apptData?.date) {
          const parsedDate = new Date(apptData.date);
          if (!isNaN(parsedDate.getTime())) {
            const dStr = parsedDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const timeRaw = apptData.batch_time || (apptData.time ? String(apptData.time).slice(0, 5) : "");
            let tStr = timeRaw;
            if (timeRaw && timeRaw.includes(":")) {
              const [h, m] = timeRaw.split(":");
              const hourNum = parseInt(h, 10);
              const ampm = hourNum >= 12 ? "PM" : "AM";
              const hour12 = hourNum % 12 || 12;
              tStr = `${hour12}:${m} ${ampm}`;
            }
            confirmedSchedule = tStr ? `${dStr} at ${tStr}` : dStr;
          }
        }

        // Resolve Condition
        const conditionName = apptData?.ai_condition_name || "General Consultation";

        // Resolve Transaction Reference
        const txRef = row.paymongoPaymentId || row.paymentReference || (apptData?.appointment_id ? `pay_${apptData.appointment_id.replace(/-/g, "").slice(0, 16)}` : row.paymentId);

        setSelectedAppointmentReceipt({
          transactionReference: txRef,
          patientName,
          paymentMethod: row.method,
          mobileNumber,
          clinicName,
          doctorName,
          confirmedSchedule,
          conditionName,
          amountPaid: row.amount,
          appointmentId: apptData?.appointment_id,
        });
      } catch (err) {
        console.error("[BillingSettingsPage] Error retrieving appointment details:", err);
      } finally {
        setLoadingPaymentId(null);
      }
    } else {
      setSelectedPayment(row);
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
    <div className="max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-gray-900 tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your subscription and payment details</p>
      </div>

      {/* Current plan */}
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xs p-6 sm:p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Current plan</h2>

          {!loading && (
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                sub.isPro
                  ? "bg-emerald-50 text-emerald-600"
                  : sub.isExpired
                  ? "bg-rose-50 text-rose-600"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {sub.isPro ? "Active" : sub.isExpired ? "Expired" : "Free"}
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-[#801336]" />
            <p className="text-xs text-gray-400">Loading billing details...</p>
          </div>
        ) : (
          <>
            {/* 4 Plan detail cards - clean typography without icons or icon backgrounds */}
            <div className="grid grid-cols-1 gap-4 mt-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Plan */}
              <div className="rounded-2xl border border-gray-100 bg-white p-5 flex flex-col justify-center">
                <span className="text-xs font-medium text-gray-500">Plan</span>
                <span className="text-base sm:text-lg font-bold text-gray-900 mt-1">
                  {sub.isPro ? (sub.planName || "Pro") : "Free Plan"}
                </span>
              </div>

              {/* Card 2: Price */}
              <div className="rounded-2xl border border-gray-100 bg-white p-5 flex flex-col justify-center">
                <span className="text-xs font-medium text-gray-500">Price</span>
                <span className="text-base sm:text-lg font-bold text-gray-900 mt-1">
                  {sub.isPro ? sub.price : "₱0.00"}
                </span>
              </div>

              {/* Card 3: Billing cycle */}
              <div className="rounded-2xl border border-gray-100 bg-white p-5 flex flex-col justify-center">
                <span className="text-xs font-medium text-gray-500">Billing cycle</span>
                <span className="text-base sm:text-lg font-bold text-gray-900 mt-1 capitalize">
                  {sub.isPro ? sub.billingCycle : "Free"}
                </span>
              </div>

              {/* Card 4: Next billing date (with subtle blush border matching reference) */}
              <div className="rounded-2xl border border-[#f8e1ea] bg-white p-5 flex flex-col justify-center">
                <span className="text-xs font-medium text-gray-500">
                  {sub.isPro
                    ? (sub.cancelAtPeriodEnd ? "Pro access until" : "Next billing date")
                    : "Scan limit"}
                </span>
                <span className="text-base sm:text-lg font-bold text-gray-900 mt-1">
                  {sub.isPro
                    ? (sub.renewsAt || "N/A")
                    : (freePlan.scanLimit === null
                        ? "Unlimited scans"
                        : `${freePlan.scanLimit ?? 0} scans per account`)}
                </span>
              </div>
            </div>

            {/* Bottom Actions Area */}
            {sub.isPro ? (
              sub.cancelAtPeriodEnd ? (
                <div className="flex flex-col gap-4 border-t border-gray-100/90 pt-5 mt-6 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs sm:text-sm text-gray-500">
                    Your Pro access remains active until <strong className="text-gray-900">{sub.renewsAt}</strong>. You can resume your subscription before then without paying again.
                  </p>
                  <button
                    onClick={handleResume}
                    disabled={resuming}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#801336] px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-[#680f2b] disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Resume subscription</span>
                  </button>
                </div>
              ) : (
                <div className="flex justify-end border-t border-gray-100/90 pt-5 mt-6">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 hover:border-red-300 shadow-2xs disabled:opacity-50 cursor-pointer"
                  >
                    {cancelling ? (
                      <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 stroke-[1.8]" />
                    )}
                    <span>Cancel subscription</span>
                  </button>
                </div>
              )
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-gray-100/90 pt-5 mt-6">
                {sub.isExpired ? (
                  <p className="text-xs sm:text-sm text-rose-700 font-medium">
                    Your Pro plan has expired. Upgrade or renew anytime to regain full Pro access and unlimited scans.
                  </p>
                ) : (
                  <p className="text-xs sm:text-sm text-gray-500">
                    You are on the Free plan. Upgrade to Pro for unlimited AI scans and priority booking.
                  </p>
                )}
                <Link
                  to="/dashboard/upgrade"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[#801336] px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-[#680f2b] shadow-xs"
                >
                  {sub.isExpired ? "Renew Subscription" : "Upgrade to Pro"}
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      {/* Billing history */}
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xs">
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-base font-bold text-gray-900">Billing history</h2>
          <span className="text-xs font-medium text-gray-400">
            {billingHistory.length === 1 ? "1 payment" : `${billingHistory.length} payments`}
          </span>
        </div>

        {billingHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="bg-gray-50/70 border-y border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <th scope="col" className="px-6 py-3.5">DATE</th>
                  <th scope="col" className="px-6 py-3.5">DESCRIPTION</th>
                  <th scope="col" className="px-6 py-3.5">METHOD</th>
                  <th scope="col" className="px-6 py-3.5">TRANSACTION ID</th>
                  <th scope="col" className="px-6 py-3.5 text-right">AMOUNT</th>
                  <th scope="col" className="px-6 py-3.5 text-center">STATUS</th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {billingHistory.map((row) => {
                  const rawMethod = String(row.method || "").toLowerCase();
                  const isGcash = rawMethod.includes("gcash");
                  const isMaya = rawMethod.includes("maya") || rawMethod.includes("paymaya");
                  const methodLabel = isGcash ? "GCash" : isMaya ? "Maya" : (row.method || "Online Payment");

                  return (
                    <tr key={row.paymentId} className="hover:bg-gray-50/50 transition-colors">
                      <td className="whitespace-nowrap px-6 py-4.5 text-xs sm:text-sm text-gray-600">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4.5 text-xs sm:text-sm font-bold text-gray-900">
                        {row.description}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4.5">
                        {isGcash ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-[#eef4ff] text-[#2563eb] border border-[#dbeafe]">
                            GCash
                          </span>
                        ) : isMaya ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]">
                            Maya
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-gray-50 text-gray-700 border border-gray-200">
                            {methodLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4.5">
                        <span
                          className="block max-w-[200px] truncate font-mono text-xs text-gray-400"
                          title={row.paymentId}
                        >
                          {row.paymentId}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4.5 text-right font-bold text-xs sm:text-sm text-gray-900">
                        {row.amount}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4.5 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                          {row.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleViewReceipt(row)}
                          disabled={loadingPaymentId === row.paymentId}
                          className="text-xs sm:text-sm font-bold text-[#801336] hover:underline cursor-pointer disabled:opacity-50"
                          aria-label={`View payment ${row.paymentId}`}
                        >
                          {loadingPaymentId === row.paymentId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "View"
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-10 text-center text-xs sm:text-sm text-gray-400">
            No billing history available.
          </p>
        )}
      </section>
    </div>

      {/* Subscription Payment Details Modal */}
      <ModalPortal isOpen={Boolean(selectedPayment && !selectedPayment.isAppointment)}>
        {selectedPayment && !selectedPayment.isAppointment && (
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto bg-black/50 px-4 py-6 backdrop-blur-sm"
            onClick={() => setSelectedPayment(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="payment-details-title"
              className="relative z-[9999] my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-[#F4C9DC] bg-white shadow-[0_10px_40px_-12px_rgba(162,29,92,0.25)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="relative bg-gradient-to-br from-[#A21D5C] to-[#7E1448] px-6 pb-12 pt-7 text-center sm:px-8">
                <button
                  type="button"
                  onClick={() => setSelectedPayment(null)}
                  aria-label="Close payment details"
                  className="absolute right-3 top-3 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
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
                  className="mt-6 w-full rounded-xl bg-[#A21D5C] px-4 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-[#7E1448] focus:outline-none focus:ring-2 focus:ring-[#A21D5C]/40 focus:ring-offset-2 cursor-pointer"
                >
                  Close Receipt
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Dedicated Appointment & Consultation Receipt Modal (Payment Successful!) */}
      <ModalPortal isOpen={Boolean(selectedAppointmentReceipt)}>
        {selectedAppointmentReceipt && (
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6 backdrop-blur-sm"
            onClick={() => setSelectedAppointmentReceipt(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-[9999] my-auto w-full max-w-lg rounded-3xl border border-gray-200/90 bg-white p-6 sm:p-8 text-center shadow-2xl space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button top-right */}
              <button
                type="button"
                onClick={() => setSelectedAppointmentReceipt(null)}
                className="absolute right-4 top-4 p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Success Check Icon */}
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 mx-auto flex items-center justify-center shadow-xs">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div className="space-y-1.5">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Payment Successful!</h1>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Your consultation payment has been received and your appointment request has been confirmed with{" "}
                  <strong className="text-gray-900">{selectedAppointmentReceipt.clinicName}</strong>.
                </p>
              </div>

              {/* Transaction Reference Badge */}
              {selectedAppointmentReceipt.transactionReference && (
                <div className="inline-block bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-2xl shadow-2xs">
                  <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">
                    Transaction Reference
                  </span>
                  <span className="font-mono font-bold text-xs text-gray-900">
                    {selectedAppointmentReceipt.transactionReference}
                  </span>
                </div>
              )}

              {/* Appointment & Payment Schedule Information Card */}
              <div className="bg-slate-50/80 p-5 rounded-2xl border border-gray-100 text-left space-y-2.5 text-xs">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pb-1.5 border-b border-gray-200/70">
                  Appointment &amp; Payment Details
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Patient Name</span>
                  <span className="font-bold text-gray-900">{selectedAppointmentReceipt.patientName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Payment Method</span>
                  <div className="flex items-center">
                    {selectedAppointmentReceipt.paymentMethod.toLowerCase().includes("maya") ||
                    selectedAppointmentReceipt.paymentMethod.toLowerCase().includes("paymaya") ? (
                      <img src={mayaLogo} alt="Maya" className="h-5 w-auto object-contain" />
                    ) : selectedAppointmentReceipt.paymentMethod.toLowerCase().includes("gcash") ? (
                      <img src={gcashLogo} alt="GCash" className="h-5 w-auto object-contain" />
                    ) : (
                      <span className="font-bold text-gray-900">{selectedAppointmentReceipt.paymentMethod}</span>
                    )}
                  </div>
                </div>

                {selectedAppointmentReceipt.mobileNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Account Mobile Number</span>
                    <span className="font-mono font-bold text-gray-900">{selectedAppointmentReceipt.mobileNumber}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Clinic</span>
                  <span className="font-bold text-gray-900">{selectedAppointmentReceipt.clinicName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Attending Dermatologist</span>
                  <span className="font-bold text-gray-900">{selectedAppointmentReceipt.doctorName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Confirmed Schedule</span>
                  <span className="font-bold text-magenta-700">
                    {selectedAppointmentReceipt.confirmedSchedule}
                  </span>
                </div>

                {selectedAppointmentReceipt.conditionName && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Selected Condition</span>
                    <span className="font-semibold text-magenta-700">
                      {selectedAppointmentReceipt.conditionName}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <span className="font-bold text-gray-700">Amount Paid</span>
                  <span className="font-extrabold text-emerald-700 text-sm">
                    {selectedAppointmentReceipt.amountPaid}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Payment Status</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-[10px]">
                    Paid &amp; Confirmed
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetUrl = selectedAppointmentReceipt.appointmentId
                      ? `/dashboard/appointment-status?appointment=${selectedAppointmentReceipt.appointmentId}`
                      : "/dashboard/appointment-status";
                    navigate(targetUrl);
                  }}
                  className="flex-1 py-3.5 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <Calendar className="w-4 h-4" />
                  <span>View Appointment</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAppointmentReceipt(null)}
                  className="px-6 py-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-xs transition-all text-center cursor-pointer"
                >
                  Dashboard
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>
    </>
  );
}