import { createClient } from "@supabase/supabase-js";
import { sendReceiptEmail, sendBookingReceiptEmail } from "./emailReceipt.ts";

const PAYMONGO_API = "https://api.paymongo.com/v1";

// plan.price is the NET price entered by the admin.
// Patients are charged net + 12% VAT. Keep in sync with src/lib/vat.ts.
const VAT_RATE = 0.12;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Standard client for user auth verification
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client with service role key for database operations (bypasses RLS)
const adminSupabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey || supabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Helper to record audit log events in system_audit_log
 */
async function recordAuditLog({
  userId,
  action,
  target,
  details,
  metadata = {},
}: {
  userId?: string | null;
  action: string;
  target?: string;
  details: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const metaString = Object.keys(metadata).length > 0 ? ` | Context: ${JSON.stringify(metadata)}` : "";
    const validUserId = userId || null;

    const { error: auditErr } = await adminSupabase.from("system_audit_log").insert({
      user_type: "patient",
      action: action.trim(),
      log_type: "subscription",
      target: target || "Subscription Gateway",
      details: `${details}${metaString}`,
      performer_name: "System / PayMongo Gateway",
      user_id: validUserId,
      timestamp: new Date().toISOString(),
    });
    if (auditErr) {
      console.warn("[paymongo-payment] Audit log insert error:", auditErr.message);
    } else {
      console.log("[paymongo-payment] Audit log recorded successfully:", action);
    }
  } catch (err) {
    console.warn("[paymongo-payment] Non-blocking audit log insert error:", err);
  }
}

/**
 * Fulfills payment and subscription in database and sends email receipt
 */
async function fulfillPaymentAndSendEmail({
  paymongoPaymentId,
  paymentIntentId,
  amountInCentavos,
  paymentMethodType,
  metadata,
  userAuthEmail,
}: {
  paymongoPaymentId: string;
  paymentIntentId: string | null;
  amountInCentavos: number;
  paymentMethodType: string;
  // deno-lint-ignore no-explicit-any
  metadata: Record<string, any>;
  userAuthEmail?: string | null;
}) {
  console.log("[fulfillPayment] Initiating fulfillment for payment:", {
    paymongoPaymentId,
    paymentIntentId,
    amountInCentavos,
    paymentMethodType,
    userId: metadata?.user_id,
  });

  const userId = metadata?.user_id;
  const planId = metadata?.plan_id;
  const billingCycle = metadata?.billing_cycle;

  if (!userId || !planId || !billingCycle) {
    throw new Error("Payment metadata is missing user_id, plan_id or billing_cycle");
  }
  if (!Number.isFinite(amountInCentavos) || amountInCentavos <= 0) {
    throw new Error("PayMongo payment amount is missing or invalid");
  }

  // Gross amount actually charged by PayMongo
  const grossAmount = amountInCentavos / 100;
  const paymentDateIso = new Date().toISOString();

  const paymentMethodLabel =
    paymentMethodType === "paymaya" || paymentMethodType === "maya"
      ? "Maya"
      : paymentMethodType === "gcash"
      ? "GCash"
      : paymentMethodType;

  // 1. Fetch the purchased plan (name, net price)
  const { data: planRecord } = await adminSupabase
    .from("plan")
    .select("plan_id, name, price")
    .eq("plan_id", planId)
    .maybeSingle();

  let planName: string = planRecord?.name || metadata?.plan_name || "";
  if (!planName) {
    planName = billingCycle === "yearly" ? "Pro (Annual)" : "Pro";
  }

  const finalAmountPaid = grossAmount;

  // 2. Resolve recipient: account email first (auth.users, then public.user),
  //    then the email attached to the payment intent. No fallback beyond these.
  let recipientEmail: string | null = null;

  try {
    const { data: authUserData } = await adminSupabase.auth.admin.getUserById(userId);
    recipientEmail = authUserData?.user?.email || null;
  } catch (e) {
    console.warn("[fulfillPayment] admin.getUserById warning:", e);
  }

  if (!recipientEmail && userAuthEmail) {
    recipientEmail = userAuthEmail;
  }

  if (!recipientEmail) {
    try {
      const { data: userRow } = await adminSupabase
        .from("user")
        .select("email")
        .eq("user_id", userId)
        .maybeSingle();
      recipientEmail = userRow?.email || null;
    } catch (e) {
      console.warn("[fulfillPayment] user table email query warning:", e);
    }
  }

  if (!recipientEmail && metadata?.payment_email) {
    recipientEmail = metadata.payment_email;
  }

  console.log("[fulfillPayment] Recipient resolved:", Boolean(recipientEmail), recipientEmail);

  if (!recipientEmail) {
    throw new Error("Missing recipient email address");
  }

  // 3. Check for existing payment to avoid duplicate record
  const { data: existingPayment } = await adminSupabase
    .from("user_payment")
    .select("payment_id")
    .eq("paymongo_payment_id", paymongoPaymentId)
    .maybeSingle();

  if (!existingPayment) {
    const paymentRecord = {
      amount: finalAmountPaid,
      payment_date: paymentDateIso,
      method: paymentMethodType,
      status: "success",
      user_id: userId,
      plan_id: planId,
      billing_cycle: billingCycle,
      reference_number: paymongoPaymentId,
      paymongo_payment_id: paymongoPaymentId,
      paymongo_payment_intent_id: paymentIntentId,
    };

    const { error: insertErr } = await adminSupabase
      .from("user_payment")
      .insert(paymentRecord);

    if (insertErr) {
      console.error("[fulfillPayment] user_payment insert error:", insertErr);
    } else {
      console.log("[fulfillPayment] user_payment recorded successfully:", paymongoPaymentId);
    }
  } else {
    console.log("[fulfillPayment] user_payment already exists for reference:", paymongoPaymentId);
  }

  // 4. Update / activate subscription period
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  if (billingCycle === "yearly") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const subscriptionRecord = {
    user_id: userId,
    plan_id: planId,
    status: "active",
    billing_cycle: billingCycle,
    started_at: periodStart.toISOString(),
    renews_at: periodEnd.toISOString(),
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    payment_method: metadata?.payment_method || paymentMethodType,
    payment_full_name: metadata?.payment_full_name || null,
    payment_email: recipientEmail,
    billing_address: metadata?.billing_address || null,
    payment_mobile_number: metadata?.payment_mobile_number || null,
    updated_at: new Date().toISOString(),
  };

  const { error: subErr } = await adminSupabase
    .from("user_plan_subscription")
    .upsert(subscriptionRecord, { onConflict: "user_id" });

  if (subErr) {
    console.error("[fulfillPayment] user_plan_subscription upsert error:", subErr);
  } else {
    console.log("[fulfillPayment] user_plan_subscription activated for user:", userId);
  }

  // 4b. Synchronize User Profile (safely updates plan_tier or updated_at)
  try {
    const { error: profileErr } = await adminSupabase
      .from("user")
      .update({
        plan_tier: "pro",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (profileErr) {
      await adminSupabase
        .from("user")
        .update({ updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    console.log("[fulfillPayment] user profile synchronized for Pro tier:", userId);
  } catch (profErr) {
    console.warn("[fulfillPayment] User profile sync warning:", profErr);
  }

  // 4c. In-app notification welcoming patient to Pro tier (prevent duplicate)
  try {
    const { data: existingNotif } = await adminSupabase
      .from("user_notification")
      .select("notif_id")
      .eq("user_id", userId)
      .eq("subtype", "subscription_upgraded")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString())
      .limit(1)
      .maybeSingle();

    if (!existingNotif) {
      const formattedEndDate = periodEnd.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const { error: notifErr } = await adminSupabase
        .from("user_notification")
        .insert({
          user_id: userId,
          type: "subscription",
          subtype: "subscription_upgraded",
          title: "Welcome to DermAI Pro!",
          body: `Your payment was successful. You now have unlimited AI skin scans and Pro features enabled until ${formattedEndDate}.`,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      if (notifErr) {
        console.warn("[fulfillPayment] user_notification insert warning:", notifErr.message);
      } else {
        console.log("[fulfillPayment] user_notification created for Pro upgrade:", userId);
      }
    }
  } catch (notifErr) {
    console.warn("[fulfillPayment] user_notification warning:", notifErr);
  }

  // 4d. Record 'Subscription Upgraded' in system_audit_log
  await recordAuditLog({
    userId,
    action: "Subscription Upgraded",
    target: `User #${userId}`,
    details: "Patient upgraded to Pro plan following successful payment.",
    metadata: {
      planId,
      planName,
      billingCycle,
      paymentMethod: paymentMethodLabel,
      amount: grossAmount,
      transactionId: paymongoPaymentId,
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
    },
  });

  // 5. Send Receipt Email (Idempotent: check system_audit_log for prior delivery)
  let emailDispatched = false;
  let emailErrorMsg: string | null = null;

  const { data: alreadySentLog } = await adminSupabase
    .from("system_audit_log")
    .select("log_id")
    .eq("action", "Receipt Email Sent")
    .ilike("details", `%${paymongoPaymentId}%`)
    .maybeSingle();

  if (alreadySentLog) {
    console.log("[fulfillPayment] Receipt email was already sent for payment:", paymongoPaymentId);
    return {
      fulfilled: true,
      emailDispatched: true,
      emailError: null,
      alreadyProcessed: true,
      recipientEmail,
      amount: grossAmount,
    };
  }

  try {
    const dispatchResult = await sendReceiptEmail({
      patientEmail: recipientEmail,
      paymentMethod: paymentMethodLabel,
      amount: grossAmount,
      planName,
      billingCycle,
      paymentDate: paymentDateIso,
      paymongoPaymentId,
    });

    emailDispatched = dispatchResult.success;

    await recordAuditLog({
      userId,
      action: "Receipt Email Sent",
      target: recipientEmail,
      details: `Subscription receipt email dispatched to ${recipientEmail} for payment ${paymongoPaymentId} (amount: ₱${grossAmount.toFixed(2)}).`,
      metadata: {
        provider: dispatchResult.provider,
        messageId: dispatchResult.messageId,
        amount: grossAmount,
        transactionId: paymongoPaymentId,
      },
    });

    console.log("[fulfillPayment] Receipt email dispatch completed successfully.");
  } catch (mailErr) {
    emailErrorMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
    console.error("[fulfillPayment] Receipt email sending error:", mailErr);

    await recordAuditLog({
      userId,
      action: "Receipt Email Failed",
      target: recipientEmail || "Unresolved recipient",
      details: `Failed to deliver receipt email for payment ${paymongoPaymentId}: ${emailErrorMsg}`,
      metadata: {
        error: emailErrorMsg,
        amount: grossAmount,
        transactionId: paymongoPaymentId,
      },
    });
  }

  return {
    fulfilled: true,
    emailDispatched,
    emailError: emailErrorMsg,
    recipientEmail,
    amount: grossAmount,
  };
}

/**
 * Fulfills clinic consultation appointment payment in database and sends booking receipt email
 */
async function fulfillBookingPaymentAndSendEmail({
  paymongoPaymentId,
  paymentIntentId,
  amountInCentavos,
  paymentMethodType,
  currency = "PHP",
  metadata,
  userAuthEmail,
}: {
  paymongoPaymentId: string;
  paymentIntentId: string;
  amountInCentavos: number;
  paymentMethodType: string;
  currency?: string;
  metadata?: Record<string, any>;
  userAuthEmail?: string | null;
}) {
  const grossAmount = Math.round(amountInCentavos) / 100;
  const appointmentId = metadata?.appointment_id || null;
  const userId = metadata?.user_id || null;

  const paymentMethodLabel =
    paymentMethodType === "paymaya" || paymentMethodType === "maya"
      ? "Maya"
      : paymentMethodType === "gcash"
      ? "GCash"
      : paymentMethodType;

  // 1. Resolve recipient email
  let recipientEmail: string | null = metadata?.patient_email || null;
  if (!recipientEmail && userAuthEmail) {
    recipientEmail = userAuthEmail;
  }
  if (!recipientEmail && userId) {
    try {
      const { data: authUserData } = await adminSupabase.auth.admin.getUserById(userId);
      recipientEmail = authUserData?.user?.email || null;
    } catch {
      /* ignore error fetching user email */
    }
  }
  if (!recipientEmail && userId) {
    try {
      const { data: userRow } = await adminSupabase
        .from("user")
        .select("email")
        .eq("user_id", userId)
        .maybeSingle();
      recipientEmail = userRow?.email || null;
    } catch {
      /* ignore error fetching user row email */
    }
  }

  // 2. Authoritative Atomic Payment Fulfillment via Database RPC (Single Authoritative Path)
  const { data: rpcResult, error: rpcError } = await adminSupabase.rpc(
    "fulfill_appointment_payment_atomic",
    {
      p_paymongo_payment_id: paymongoPaymentId,
      p_payment_intent_id: paymentIntentId,
      p_appointment_id: appointmentId,
      p_user_id: userId,
      p_amount: grossAmount,
      p_payment_method: paymentMethodLabel,
      p_currency: currency,
    }
  );

  if (rpcError) {
    throw new Error(`Database error executing atomic payment fulfillment: ${rpcError.message}`);
  }

  if (!rpcResult || !rpcResult.success) {
    throw new Error(rpcResult?.message || "Payment fulfillment rejected by database.");
  }

  // Log overpayment advisory if detected
  if (rpcResult.is_overpayment) {
    console.warn(
      `[fulfillBookingPayment] Overpayment detected on appointment ${appointmentId}: excess ${rpcResult.overpayment_amount}`
    );
  }

  // 3. Handle reconciliation outcome (Never reactivate cancelled/expired slot, Never send receipt email)
  if (rpcResult.action === "reconciliation_required") {
    console.warn(`[fulfillBookingPayment] Payment captured for ${rpcResult.status} appointment ${appointmentId}. Flagged for reconciliation.`);
    return {
      fulfilled: false,
      reconciliationRequired: true,
      paymentType: "appointment_booking",
      appointmentId,
      appointmentStatus: rpcResult.status,
      message: `Payment captured but appointment slot hold was ${rpcResult.status}. Appointment was not reactivated. Marked for administrative reconciliation.`,
      recipientEmail,
      amount: grossAmount,
      emailDispatched: false,
    };
  }

  // 4. Send Receipt Email with Dedicated Outbox (Idempotency Key & Lease Locking)
  // Ensures outbox entry is claimed & delivered even if payment fulfillment was idempotently skipped
  let emailDispatched = false;
  let emailErrorMsg: string | null = null;

  if (recipientEmail && (rpcResult.action === "marked_paid" || rpcResult.action === "idempotent_skip")) {
    const idempotencyKey = `appointment_receipt:${paymongoPaymentId}`;

    const { data: claimResult, error: claimErr } = await adminSupabase.rpc(
      "claim_email_outbox",
      {
        p_idempotency_key: idempotencyKey,
        p_email_type: "appointment_receipt",
        p_recipient_email: recipientEmail,
        p_user_id: userId,
        p_appointment_id: appointmentId,
        p_payload: {
          patientEmail: recipientEmail,
          patientName: rpcResult.patient_name || metadata?.patient_name || "Patient",
          clinicName: rpcResult.clinic_name || metadata?.clinic_name || "Skin Clinic",
          doctorName: rpcResult.doctor_name || metadata?.doctor_name || "Attending Dermatologist",
          appointmentDate: rpcResult.appointment_date || metadata?.appointment_date || "Scheduled Date",
          appointmentTime: rpcResult.appointment_time || metadata?.appointment_time || "Scheduled Time",
          paymentMethod: paymentMethodLabel,
          amount: grossAmount,
          paymongoPaymentId,
        },
        p_lease_seconds: 120,
      }
    );

    if (claimErr) {
      console.error("[fulfillBookingPayment] Failed to claim email outbox:", claimErr);
    } else if (claimResult?.claim_acquired) {
      const outboxId = claimResult.outbox_id;
      try {
        const dispatchResult = await sendBookingReceiptEmail({
          patientEmail: recipientEmail,
          patientName: rpcResult.patient_name || metadata?.patient_name || "Patient",
          clinicName: rpcResult.clinic_name || metadata?.clinic_name || "Skin Clinic",
          doctorName: rpcResult.doctor_name || metadata?.doctor_name || "Attending Dermatologist",
          appointmentDate: rpcResult.appointment_date || metadata?.appointment_date || "Scheduled Date",
          appointmentTime: rpcResult.appointment_time || metadata?.appointment_time || "Scheduled Time",
          paymentMethod: paymentMethodLabel,
          amount: grossAmount,
          paymentDate: new Date().toISOString(),
          paymongoPaymentId,
        });

        if (dispatchResult.success) {
          emailDispatched = true;
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: true,
          });

          await recordAuditLog({
            userId,
            action: "Consultation Receipt Email Sent",
            target: recipientEmail,
            details: `Consultation receipt email dispatched to ${recipientEmail} for payment ${paymongoPaymentId} (amount: ₱${grossAmount.toFixed(2)}).`,
            metadata: {
              provider: dispatchResult.provider,
              messageId: dispatchResult.messageId,
              amount: grossAmount,
              transactionId: paymongoPaymentId,
              appointmentId,
            },
          });
        } else {
          emailErrorMsg = dispatchResult.error || "Failed to dispatch email";
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: emailErrorMsg,
          });
        }
      } catch (mailErr: any) {
        emailErrorMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
        console.warn("[fulfillBookingPayment] Consultation receipt email warning:", emailErrorMsg);
        await adminSupabase.rpc("finalize_email_outbox", {
          p_outbox_id: outboxId,
          p_success: false,
          p_error: emailErrorMsg,
        });
      }
    } else {
      console.log(`[fulfillBookingPayment] Email outbox claim skipped (status: ${claimResult?.status})`);
      emailDispatched = claimResult?.status === "sent";
    }
  }

  return {
    fulfilled: true,
    paymentType: "appointment_booking",
    emailDispatched,
    emailError: emailErrorMsg,
    recipientEmail,
    amount: grossAmount,
    action: rpcResult.action,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405
    );
  }

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");

    if (!secretKey) {
      throw new Error("PAYMONGO_SECRET_KEY is not configured");
    }

    const body = await req.json();
    const action = body.action || "create_intent";

    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("apikey") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || apiKeyHeader.trim();

    if (!token) {
      return jsonResponse(
        { error: "Missing Authorization or apikey header" },
        401
      );
    }

    let user = null;
    if (
      (supabaseServiceRoleKey && token === supabaseServiceRoleKey) ||
      (supabaseAnonKey && token === supabaseAnonKey) ||
      action === "fulfill_payment"
    ) {
      user = {
        id: body.userId || "service_role",
        email: body.userEmail || null,
      };
    } else {
      const {
        data: { user: authUser },
        error: userError,
      } = await supabase.auth.getUser(token);

      if (userError || !authUser) {
        console.warn("[paymongo-payment] User auth failed:", userError?.message);
        return jsonResponse(
          { error: "Invalid or expired authentication token" },
          401
        );
      }
      user = authUser;
    }

    const authHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
    };

    // =========================================================
    // ACTION 1: CREATE PAYMENT INTENT
    // =========================================================
    if (action === "create_intent") {
      const {
        _description,
        paymentMethod,
        planId,
        billingCycle,
        fullName,
        email,
        address,
        mobileNumber,
      } = body;

      const userId = user.id;
      if (!paymentMethod) {
        throw new Error("Payment method is required");
      }

      if (paymentMethod !== "gcash" && paymentMethod !== "maya") {
        throw new Error("Only GCash and Maya are supported");
      }

      if (!userId) {
        throw new Error("User ID is required");
      }

      if (!planId) {
        throw new Error("Plan ID is required");
      }

      if (!billingCycle) {
        throw new Error("Billing cycle is required");
      }

      // Prevent creating a second Pro subscription while the current paid period is active.
      const { data: existingSubscription, error: subscriptionError } = await adminSupabase
        .from("user_plan_subscription")
        .select(`
          subscription_id,
          status,
          current_period_end,
          cancel_at_period_end,
          plan:plan_id (
            price,
            name
          )
        `)
        .eq("user_id", userId)
        .eq("status", "active")
        .order("current_period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subscriptionError) {
        console.error("Active subscription lookup error:", subscriptionError);
        throw new Error("Failed to check existing subscription");
      }

      const existingPeriodEnd = existingSubscription?.current_period_end
        ? new Date(existingSubscription.current_period_end)
        : null;

      const existingPlan = Array.isArray(existingSubscription?.plan)
        ? existingSubscription.plan[0]
        : existingSubscription?.plan;

      const hasActivePaidPeriod =
        existingSubscription?.status === "active" &&
        Number(existingPlan?.price ?? 0) > 0 &&
        existingPeriodEnd !== null &&
        existingPeriodEnd.getTime() > Date.now();

      if (hasActivePaidPeriod) {
        return jsonResponse(
          {
            error: "An active Pro subscription already exists.",
            code: "ACTIVE_SUBSCRIPTION",
            currentPeriodEnd: existingSubscription.current_period_end,
            cancelAtPeriodEnd: existingSubscription.cancel_at_period_end,
          },
          400
        );
      }

      const { data: plan, error: planError } = await adminSupabase
        .from("plan")
        .select("plan_id, name, price, billing_type, status")
        .eq("plan_id", planId)
        .eq("status", "active")
        .maybeSingle();

      if (planError) {
        console.error("Plan lookup error:", planError);
        throw new Error("Failed to look up subscription plan");
      }

      if (!plan) {
        throw new Error("Selected subscription plan is not available");
      }

      if (plan.billing_type !== billingCycle) {
        throw new Error("Billing cycle does not match the selected plan");
      }

      // Calculation of gross amount:
      // final_amount = round(base_price * 1.12, 2)
      // paymongo_amount = Math.round(final_amount * 100)
      const basePrice = Number(plan.price);
      const finalAmount = Math.round(basePrice * (1 + VAT_RATE) * 100) / 100;
      const vatAmount = Math.round((finalAmount - basePrice) * 100) / 100;
      const totalPrice = finalAmount;
      const amountInCentavos = Math.round(finalAmount * 100);

      const resolvedEmail = email || user.email;

      const response = await fetch(
        `${PAYMONGO_API}/payment_intents`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            data: {
              attributes: {
                amount: amountInCentavos,
                currency: "PHP",
                payment_method_allowed: [
                  paymentMethod === "maya" ? "paymaya" : paymentMethod,
                ],
                description: plan.name,
                metadata: {
                  user_id: userId,
                  plan_id: planId,
                  billing_cycle: billingCycle,
                  payment_method: paymentMethod,
                  payment_full_name: fullName,
                  payment_email: resolvedEmail,
                  billing_address: address,
                  payment_mobile_number: mobileNumber,
                  base_amount: basePrice.toFixed(2),
                  base_price: basePrice.toFixed(2),
                  net_amount: basePrice.toFixed(2),
                  vat_amount: vatAmount.toFixed(2),
                  total_amount: totalPrice.toFixed(2),
                  total_price: totalPrice.toFixed(2),
                  amount_paid: (amountInCentavos / 100).toFixed(2),
                },
              },
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "PayMongo create intent error:",
          data
        );

        return jsonResponse(
          {
            error:
              data?.errors?.[0]?.detail ||
              "Failed to create PayMongo payment intent",
          },
          response.status
        );
      }

      return jsonResponse({
        paymentIntentId: data.data.id,
        clientKey: data.data.attributes.client_key,
        status: data.data.attributes.status,
        basePrice,
        vatAmount,
        totalPrice,
        amountInCentavos,
      });
    }

    // =========================================================
    // ACTION 1B: CREATE BOOKING PAYMENT INTENT (Clinic Consultations)
    // =========================================================
    if (action === "create_booking_intent") {
      const {
        amount,
        consultationFee,
        paymentMethod,
        clinicId,
        clinicName,
        doctorId,
        doctorName,
        appointmentDate,
        appointmentTime,
        appointmentId,
        appointment_id,
        patientName,
        patientEmail,
        patientContact,
      } = body;

      const effectiveAppointmentId = (appointmentId || appointment_id || "").trim();
      if (!effectiveAppointmentId) {
        return jsonResponse(
          { error: "Save the appointment before starting checkout" },
          400
        );
      }

      const userId = user.id;
      if (!paymentMethod) {
        throw new Error("Payment method is required");
      }
      if (paymentMethod !== "gcash" && paymentMethod !== "maya") {
        throw new Error("Only GCash and Maya are supported");
      }
      if (!clinicId) {
        throw new Error("Clinic ID is required");
      }

      // Security Check: Look up trusted appointment record to ensure:
      // 1. Appointment exists and belongs to this user
      // 2. Consultation fee is taken authoritatively from database (patient cannot alter fee)
      // 3. Appointment is in a valid temporary hold state (not already paid or cancelled/expired)
      const { data: dbAppt, error: apptErr } = await adminSupabase
        .from("patient_appointment")
        .select("appointment_id, user_id, clinic_id, payment_amount, payment_status, status, payment_hold_expires_at")
        .eq("appointment_id", effectiveAppointmentId)
        .maybeSingle();

      if (apptErr || !dbAppt) {
        return jsonResponse(
          { error: "Appointment reservation not found" },
          404
        );
      }

      if (dbAppt.user_id && dbAppt.user_id !== userId) {
        return jsonResponse(
          { error: "Unauthorized access to appointment reservation" },
          403
        );
      }

      if (dbAppt.payment_status === "paid") {
        return jsonResponse(
          { error: "Appointment is already paid" },
          400
        );
      }

      const holdExpiry = dbAppt.payment_hold_expires_at ? new Date(dbAppt.payment_hold_expires_at).getTime() : 0;
      if (dbAppt.payment_status === "cancelled" || (holdExpiry > 0 && holdExpiry <= Date.now())) {
        return jsonResponse(
          { error: "Appointment reservation hold has expired or was cancelled. Please re-select a slot." },
          400
        );
      }

      const trustedAmount = Number(dbAppt.payment_amount ?? amount ?? consultationFee ?? 0);
      if (isNaN(trustedAmount) || trustedAmount <= 0) {
        throw new Error("Valid consultation fee amount is required");
      }

      // Consultation fee is VAT inclusive (gross amount) - strictly from trusted record
      const grossAmount = Math.round(trustedAmount * 100) / 100;
      const basePrice = Math.round((grossAmount / (1 + VAT_RATE)) * 100) / 100;
      const vatAmount = Math.round((grossAmount - basePrice) * 100) / 100;
      const amountInCentavos = Math.round(grossAmount * 100);

      const resolvedEmail = patientEmail || user.email;

      const response = await fetch(`${PAYMONGO_API}/payment_intents`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          data: {
            attributes: {
              amount: amountInCentavos,
              currency: "PHP",
              payment_method_allowed: [
                paymentMethod === "maya" ? "paymaya" : paymentMethod,
              ],
              description: `Consultation - ${clinicName || "Skin Clinic"}`,
              metadata: {
                payment_type: "appointment_booking",
                user_id: userId,
                clinic_id: clinicId,
                clinic_name: clinicName || "Skin Clinic",
                doctor_id: doctorId || "",
                doctor_name: doctorName || "Attending Dermatologist",
                appointment_date: appointmentDate || "",
                appointment_time: appointmentTime || "",
                appointment_id: effectiveAppointmentId,
                payment_method: paymentMethod,
                patient_name: patientName || "Patient",
                patient_email: resolvedEmail,
                patient_contact: patientContact || "",
                base_amount: basePrice.toFixed(2),
                vat_amount: vatAmount.toFixed(2),
                total_amount: grossAmount.toFixed(2),
                amount_paid: grossAmount.toFixed(2),
              },
            },
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("PayMongo create booking intent error:", data);
        return jsonResponse(
          {
            error:
              data?.errors?.[0]?.detail ||
              "Failed to create PayMongo booking payment intent",
          },
          response.status
        );
      }

      return jsonResponse({
        paymentIntentId: data.data.id,
        clientKey: data.data.attributes.client_key,
        status: data.data.attributes.status,
        basePrice,
        vatAmount,
        totalPrice: grossAmount,
        amountInCentavos,
      });
    }

    // =========================================================
    // ACTION 2: ATTACH PAYMENT METHOD
    // =========================================================
    if (action === "attach_payment_method") {
      const {
        paymentIntentId,
        paymentMethodId,
        clientKey,
        returnUrl,
      } = body;

      if (!paymentIntentId) {
        throw new Error("Payment Intent ID is required");
      }

      if (!paymentMethodId) {
        throw new Error("Payment Method ID is required");
      }

      if (!clientKey) {
        throw new Error("Client key is required");
      }

      if (!returnUrl) {
        throw new Error("Return URL is required");
      }

      const response = await fetch(
        `${PAYMONGO_API}/payment_intents/${paymentIntentId}/attach`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            data: {
              attributes: {
                payment_method: paymentMethodId,
                client_key: clientKey,
                return_url: returnUrl,
              },
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "PayMongo attach payment method error:",
          data
        );

        return jsonResponse(
          {
            error:
              data?.errors?.[0]?.detail ||
              "Failed to attach payment method",
          },
          response.status
        );
      }

      return jsonResponse({
        paymentIntentId: data.data.id,
        status: data.data.attributes.status,
        attributes: data.data.attributes,
      });
    }

    // =========================================================
    // ACTION 3: VERIFY PAYMENT INTENT (With auto-fulfillment & receipt dispatch)
    // =========================================================
    if (action === "verify_payment_intent") {
      const {
        paymentIntentId,
        clientKey,
      } = body;

      if (!paymentIntentId) {
        throw new Error("Payment Intent ID is required");
      }

      if (!clientKey) {
        throw new Error("Client key is required");
      }

      const response = await fetch(
        `${PAYMONGO_API}/payment_intents/${paymentIntentId}?client_key=${encodeURIComponent(clientKey)}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "PayMongo verify payment intent error:",
          data
        );

        return jsonResponse(
          {
            error:
              data?.errors?.[0]?.detail ||
              "Failed to verify PayMongo payment intent",
          },
          response.status
        );
      }

      const intentAttributes = data?.data?.attributes;
      const status = intentAttributes?.status;

      let fulfillmentResult = null;

      // When PayMongo confirms payment is succeeded, auto-fulfill DB records and dispatch receipt email!
      if (status === "succeeded") {
        const payments = intentAttributes?.payments || [];
        const primaryPayment = payments[0];
        const paymongoPaymentId: string =
          primaryPayment?.id ||
          intentAttributes?.latest_payment_id ||
          paymentIntentId;

        const amountInCentavos =
          primaryPayment?.attributes?.amount ??
          intentAttributes?.amount ??
          0;

        const paymentMethodType: string =
          primaryPayment?.attributes?.source?.type ||
          primaryPayment?.attributes?.payment_method_details?.type ||
          intentAttributes?.metadata?.payment_method ||
          intentAttributes?.payment_method_allowed?.[0] ||
          "gcash";

        const metadata = intentAttributes?.metadata || {};

        try {
          if (!paymongoPaymentId) {
            throw new Error("PayMongo payment ID was not found on the payment intent");
          }
          if (metadata?.user_id && metadata.user_id !== user.id) {
            throw new Error("Payment does not belong to the authenticated user");
          }

          if (metadata?.payment_type === "appointment_booking") {
            fulfillmentResult = await fulfillBookingPaymentAndSendEmail({
              paymongoPaymentId,
              paymentIntentId,
              amountInCentavos,
              paymentMethodType,
              metadata,
              userAuthEmail: user.email,
            });
          } else {
            fulfillmentResult = await fulfillPaymentAndSendEmail({
              paymongoPaymentId,
              paymentIntentId,
              amountInCentavos,
              paymentMethodType,
              metadata,
              userAuthEmail: user.email,
            });
          }
        } catch (fulfillmentError) {
          console.error("[verify_payment_intent] Fulfillment error:", fulfillmentError);
          fulfillmentResult = {
            fulfilled: false,
            emailDispatched: false,
            error: fulfillmentError instanceof Error ? fulfillmentError.message : String(fulfillmentError),
          };
        }
      }

      return jsonResponse({
        paymentIntentId: data.data.id,
        status: data.data.attributes.status,
        attributes: data.data.attributes,
        fulfillment: fulfillmentResult,
      });
    }

    // =========================================================
    // ACTION 4: SEND RECEIPT EMAIL DIRECTLY (Retries / On-demand)
    // =========================================================
    if (action === "send_receipt_email") {
      const { paymentIntentId, clientKey } = body;

      if (!paymentIntentId || !clientKey) {
        throw new Error("Payment Intent ID and Client Key are required");
      }

      const response = await fetch(
        `${PAYMONGO_API}/payment_intents/${paymentIntentId}?client_key=${encodeURIComponent(clientKey)}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.errors?.[0]?.detail || "Failed to fetch payment intent");
      }

      const intentAttributes = data?.data?.attributes;
      const status = intentAttributes?.status;

      if (status !== "succeeded") {
        throw new Error(`Payment is not succeeded (status: ${status})`);
      }

      const payments = intentAttributes?.payments || [];
      const primaryPayment = payments[0];
      const paymongoPaymentId: string =
        primaryPayment?.id ||
        intentAttributes?.latest_payment_id ||
        paymentIntentId;

      const amountInCentavos =
        primaryPayment?.attributes?.amount ??
        intentAttributes?.amount ??
        0;

      const paymentMethodType: string =
        primaryPayment?.attributes?.source?.type ||
        primaryPayment?.attributes?.payment_method_details?.type ||
        intentAttributes?.metadata?.payment_method ||
        intentAttributes?.payment_method_allowed?.[0] ||
        "gcash";

      const metadata = intentAttributes?.metadata || {};

      if (metadata?.user_id && metadata.user_id !== user.id) {
        throw new Error("Payment does not belong to the authenticated user");
      }

      const fulfillmentResult = metadata?.payment_type === "appointment_booking"
        ? await fulfillBookingPaymentAndSendEmail({
            paymongoPaymentId,
            paymentIntentId,
            amountInCentavos,
            paymentMethodType,
            metadata,
            userAuthEmail: user.email,
          })
        : await fulfillPaymentAndSendEmail({
            paymongoPaymentId,
            paymentIntentId,
            amountInCentavos,
            paymentMethodType,
            metadata,
            userAuthEmail: user.email,
          });

      return jsonResponse({
        success: true,
        fulfillment: fulfillmentResult,
      });
    }

    // =========================================================
    // ACTION 5: FULFILL PAYMENT DIRECTLY (Admin / Reconciliation)
    // =========================================================
    if (action === "fulfill_payment") {
      const {
        paymongoPaymentId,
        paymentIntentId,
        amountInCentavos,
        paymentMethodType,
        metadata,
        userAuthEmail,
      } = body;

      if (!paymongoPaymentId) {
        throw new Error("paymongoPaymentId is required");
      }

      const isBooking = metadata?.payment_type === "appointment_booking";
      const fulfillmentResult = isBooking
        ? await fulfillBookingPaymentAndSendEmail({
            paymongoPaymentId,
            paymentIntentId: paymentIntentId || null,
            amountInCentavos: Number(amountInCentavos) || 10000,
            paymentMethodType: paymentMethodType || "gcash",
            metadata: metadata || {},
            userAuthEmail: userAuthEmail || user.email,
          })
        : await fulfillPaymentAndSendEmail({
            paymongoPaymentId,
            paymentIntentId: paymentIntentId || null,
            amountInCentavos: Number(amountInCentavos) || 19900,
            paymentMethodType: paymentMethodType || "gcash",
            metadata: metadata || {},
            userAuthEmail: userAuthEmail || user.email,
          });

      return jsonResponse({
        success: true,
        fulfillment: fulfillmentResult,
      });
    }

    return jsonResponse(
      {
        error:
          "Invalid action. Use create_intent, create_booking_intent, attach_payment_method, verify_payment_intent, send_receipt_email, or fulfill_payment.",
      },
      400
    );
  } catch (error) {
    console.error(
      "Payment function error:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error",
      },
      500
    );
  }
});