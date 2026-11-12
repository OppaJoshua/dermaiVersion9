import { createClient } from "@supabase/supabase-js";
import { sendReceiptEmail, sendBookingReceiptEmail } from "./emailReceipt.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
if (!webhookSecret) {
  throw new Error("PAYMONGO_WEBHOOK_SECRET is not configured");
}

const paymongoSecretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
if (!paymongoSecretKey) {
  throw new Error("PAYMONGO_SECRET_KEY is not configured");
}

const PAYMONGO_API = "https://api.paymongo.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, paymongo-signature",
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

    const { error: auditErr } = await supabase.from("system_audit_log").insert({
      user_type: "patient",
      action: action.trim(),
      log_type: "subscription",
      target: target || "PayMongo Webhook",
      details: `${details}${metaString}`,
      performer_name: "PayMongo Webhook Service",
      user_id: validUserId,
      timestamp: new Date().toISOString(),
    });
    if (auditErr) {
      console.warn("[paymongo-webhook] Audit log insert error:", auditErr.message);
    } else {
      console.log("[paymongo-webhook] Audit log recorded successfully:", action);
    }
  } catch (err) {
    console.warn("[paymongo-webhook] Non-blocking audit log insert error:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  console.log("[webhook] PayMongo request received", {
    method: req.method,
    hasSignature: !!req.headers.get("Paymongo-Signature"),
  });

  let eventId: string | undefined;

  try {
    const signature = req.headers.get("Paymongo-Signature");

    if (!signature) {
      return jsonResponse({ error: "Missing Paymongo-Signature header" }, 401);
    }

    const rawBody = await req.text();
    const parts = signature.split(",");

    console.log(
      "[webhook] Signature parts:",
      parts.map((part) => part.split("=")[0])
    );

    const timestampPart = parts.find((part) => part.startsWith("t="));
    // Support both test signatures (te=) and live signatures (li=)
    const signaturePart = parts.find(
      (part) => part.startsWith("te=") || part.startsWith("li=")
    );

    if (!timestampPart || !signaturePart) {
      console.error("[webhook] Signature missing required timestamp or signature part", {
        parts: parts.map((p) => p.split("=")[0]),
      });
      return jsonResponse({ error: "Invalid PayMongo signature format" }, 401);
    }

    const timestamp = timestampPart.substring(2);
    const prefix = signaturePart.startsWith("te=") ? "te=" : "li=";
    const receivedSignature = signaturePart.substring(prefix.length);

    console.log("[webhook] Signature verification details:", {
      timestamp,
      signatureType: prefix.replace("=", ""),
      currentTime: Math.floor(Date.now() / 1000),
    });

    const signedPayload = `${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const calculatedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    if (calculatedSignature !== receivedSignature) {
      console.error("[webhook] Signature mismatch:", {
        calculatedLen: calculatedSignature.length,
        receivedLen: receivedSignature.length,
      });
      return jsonResponse({ error: "Invalid PayMongo webhook signature" }, 401);
    }

    console.log("[webhook] Signature verification passed successfully");

    const event = JSON.parse(rawBody);
    const eventType = event?.data?.attributes?.type;

    console.log("Received PayMongo webhook event:", eventType);

    // Support both payment.paid and checkout_session.payment.paid
    const supportedEvents = ["payment.paid", "checkout_session.payment.paid"];
    if (!supportedEvents.includes(eventType)) {
      return jsonResponse({
        received: true,
        message: "Event ignored.",
        eventType: eventType || "unknown",
      });
    }

    eventId = event?.data?.id;

    if (!eventId) {
      return jsonResponse({ error: "Missing PayMongo event ID" }, 400);
    }

    console.log("PayMongo event ID:", eventId);

    const { data: existingEvent, error: existingEventError } = await supabase
      .from("paymongo_webhook_event")
      .select("event_id, status")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingEventError) {
      console.error("Webhook event lookup error:", existingEventError);
      throw new Error("Failed to check webhook event");
    }

    if (existingEvent?.status === "processed") {
      console.log("Webhook event already processed:", eventId);
      return jsonResponse({
        received: true,
        message: "Webhook event already processed.",
        eventId,
      });
    }

    if (!existingEvent) {
      const { error: insertEventError } = await supabase
        .from("paymongo_webhook_event")
        .insert({
          event_id: eventId,
          event_type: eventType,
          status: "received",
          payload: event,
        });

      if (insertEventError) {
        console.error("Webhook event insert error:", insertEventError);
      }
    }

    // Resolve payment resource data
    let paymentData = event?.data?.attributes?.data;

    // If event is checkout_session.payment.paid, payment data may be in attributes.payments
    if (eventType === "checkout_session.payment.paid" && !paymentData?.id) {
      const sessionPayments = event?.data?.attributes?.data?.attributes?.payments;
      if (Array.isArray(sessionPayments) && sessionPayments.length > 0) {
        paymentData = sessionPayments[0];
      }
    }

    if (!paymentData?.id) {
      throw new Error("Missing PayMongo Payment ID in webhook event");
    }

    const paymongoPaymentId = paymentData.id;
    const paymentResource = paymentData;
    const paymentAttributes = paymentData?.attributes;

    if (!paymentAttributes) {
      throw new Error("PayMongo webhook payment data is missing attributes");
    }

    const paymentStatus = paymentAttributes?.status;
    if (paymentStatus !== "paid") {
      throw new Error(`PayMongo payment is not paid: ${paymentStatus || "unknown"}`);
    }

    const paymentIntentId =
      paymentAttributes?.payment_intent_id ??
      paymentResource?.relationships?.payment_intent?.data?.id ??
      null;

    let metadata = paymentAttributes?.metadata ?? {};

    if (!metadata?.user_id || (!metadata?.plan_id && metadata?.payment_type !== "appointment_booking")) {
      const eventMetadata = paymentData?.attributes?.metadata ?? {};
      if (eventMetadata?.user_id) {
        metadata = eventMetadata;
      }
    }

    // deno-lint-ignore no-explicit-any
    let paymentIntentAttributes: any = null;

    if (paymentIntentId) {
      try {
        const paymentIntentResponse = await fetch(
          `${PAYMONGO_API}/payment_intents/${paymentIntentId}`,
          {
            method: "GET",
            headers: {
              Authorization: "Basic " + btoa(paymongoSecretKey + ":"),
              "Content-Type": "application/json",
            },
          }
        );

        const paymentIntentJson = await paymentIntentResponse.json();
        if (paymentIntentResponse.ok && paymentIntentJson?.data?.attributes) {
          paymentIntentAttributes = paymentIntentJson.data.attributes;
          if (paymentIntentJson.data.attributes.metadata) {
            metadata = { ...paymentIntentJson.data.attributes.metadata, ...metadata };
            console.log("[webhook] Metadata retrieved from Payment Intent.");
          }
        }
      } catch (piErr) {
        console.warn("[webhook] Failed to fetch PaymentIntent for cross-verification:", piErr);
      }
    }

    // =========================================================================
    // APPOINTMENT BOOKING PAYMENT WEBHOOK BRANCH
    // =========================================================================
    if (metadata?.payment_type === "appointment_booking") {
      console.log("[webhook] Processing appointment booking payment:", {
        paymongoPaymentId,
        paymentIntentId,
        userId: metadata.user_id,
        appointmentId: metadata.appointment_id,
        clinicName: metadata.clinic_name,
      });

      const currency = paymentAttributes?.currency ?? "PHP";
      if (currency && currency.toUpperCase() !== "PHP") {
        throw new Error(`Unsupported payment currency: ${currency}. Only PHP is accepted for consultation bookings.`);
      }

      const amountInCentavos = paymentAttributes?.amount;
      if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
        throw new Error("PayMongo payment amount is missing or invalid for booking");
      }
      const amount = Math.round(amountInCentavos) / 100;
      const paymentDateIso = new Date().toISOString();
      const paymentMethodType: string =
        paymentAttributes?.source?.type ||
        paymentAttributes?.payment_method_details?.type ||
        metadata?.payment_method ||
        "gcash";

      const paymentMethodLabel =
        paymentMethodType === "paymaya" || paymentMethodType === "maya"
          ? "Maya"
          : paymentMethodType === "gcash"
          ? "GCash"
          : paymentMethodType;

      const appointmentId = metadata.appointment_id || null;
      const userId = metadata.user_id || null;

      // 1. Authoritative Atomic Payment Fulfillment via Database RPC (Single Authoritative Path)
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "fulfill_appointment_payment_atomic",
        {
          p_paymongo_payment_id: paymongoPaymentId,
          p_payment_intent_id: paymentIntentId,
          p_appointment_id: appointmentId,
          p_user_id: userId,
          p_amount: amount,
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

      if (rpcResult.is_overpayment) {
        console.warn(
          `[webhook] Overpayment detected on appointment ${appointmentId}: excess ${rpcResult.overpayment_amount}`
        );
      }

      const isReconciliation = rpcResult.action === "reconciliation_required";
      const reconciliationReason = rpcResult.status || "cancelled";

      // 2. Resolve recipient email and send consultation booking receipt with Dedicated Outbox
      if (!isReconciliation && (rpcResult.action === "marked_paid" || rpcResult.action === "idempotent_skip")) {
        let recipientEmail = metadata.patient_email || null;
        if (!recipientEmail && userId) {
          try {
            const { data: authUser } = await supabase.auth.admin.getUserById(userId);
            recipientEmail = authUser?.user?.email || null;
          } catch {
            /* ignore error fetching user */
          }
        }

        if (recipientEmail) {
          const idempotencyKey = `appointment_receipt:${paymongoPaymentId}`;

          const { data: claimResult, error: claimErr } = await supabase.rpc(
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
                amount,
                paymongoPaymentId,
              },
              p_lease_seconds: 120,
            }
          );

          if (claimErr) {
            console.error("[webhook] Failed to claim email outbox:", claimErr);
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
                amount,
                paymentDate: paymentDateIso,
                paymongoPaymentId,
              });

              if (dispatchResult.success) {
                await supabase.rpc("finalize_email_outbox", {
                  p_outbox_id: outboxId,
                  p_success: true,
                });

                await recordAuditLog({
                  userId,
                  action: "Consultation Receipt Email Sent",
                  target: recipientEmail,
                  details: `Consultation receipt email dispatched to ${recipientEmail} for payment ${paymongoPaymentId} (amount: ₱${amount.toFixed(2)}).`,
                  metadata: {
                    amount,
                    transactionId: paymongoPaymentId,
                    appointmentId,
                  },
                });
              } else {
                await supabase.rpc("finalize_email_outbox", {
                  p_outbox_id: outboxId,
                  p_success: false,
                  p_error: dispatchResult.error || "Failed to dispatch email",
                });
              }
            } catch (mailErr: unknown) {
              const errText = mailErr instanceof Error ? mailErr.message : String(mailErr);
              console.warn("[webhook] Booking receipt email dispatch warning:", errText);
              await supabase.rpc("finalize_email_outbox", {
                p_outbox_id: outboxId,
                p_success: false,
                p_error: errText,
              });
            }
          } else {
            console.log(`[webhook] Email outbox claim skipped (status: ${claimResult?.status})`);
          }
        }
      }

      if (isReconciliation) {
        console.warn(`[webhook] Payment ${paymongoPaymentId} processed for ${reconciliationReason} appointment ${appointmentId}. Routed to reconciliation.`);
        return jsonResponse({
          received: true,
          reconciliationRequired: true,
          appointmentStatus: reconciliationReason,
          message: `Payment captured for ${reconciliationReason} appointment. Appointment was not reactivated. Marked for manual reconciliation.`,
          paymongoPaymentId,
          appointmentId,
        });
      }

      return jsonResponse({
        received: true,
        message: "Appointment booking payment processed successfully.",
        eventId,
        paymentIntentId,
        paymongoPaymentId,
        appointmentId,
      });
    }

    // =========================================================================
    // BRANCH 2: SUBSCRIPTION PAYMENT WEBHOOK (Existing logic untouched)
    // =========================================================================
    if (!metadata?.user_id) {
      throw new Error("Payment metadata is missing user_id");
    }

    if (!metadata?.plan_id) {
      throw new Error("Payment metadata is missing plan_id");
    }

    const billingCycle = metadata?.billing_cycle;
    if (billingCycle !== "monthly" && billingCycle !== "yearly") {
      throw new Error("Payment metadata has a missing or invalid billing_cycle");
    }
    const amountInCentavos = paymentAttributes?.amount;

    if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
      throw new Error("PayMongo payment amount is missing or invalid");
    }

    // Authoritative Expected Amount Validation:
    // Must verify from at least one trusted source: PaymentIntent authoritative amount or checkout snapshot
    let authoritativeExpectedCentavos: number | null = null;

    if (
      typeof paymentIntentAttributes?.amount === "number" &&
      Number.isFinite(paymentIntentAttributes.amount) &&
      paymentIntentAttributes.amount > 0
    ) {
      authoritativeExpectedCentavos = paymentIntentAttributes.amount;
    } else {
      const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
      if (snapshotAmountStr) {
        const parsed = Math.round(Number(snapshotAmountStr) * 100);
        if (Number.isFinite(parsed) && parsed > 0) {
          authoritativeExpectedCentavos = parsed;
        }
      }
    }

    // Reject activation if no authoritative expected amount can be established
    if (authoritativeExpectedCentavos === null || !Number.isFinite(authoritativeExpectedCentavos) || authoritativeExpectedCentavos <= 0) {
      throw new Error(
        `Cannot verify payment amount for webhook payment ${paymongoPaymentId}: authoritative expected transaction amount is missing or malformed.`
      );
    }

    // Strict equality check: paid amount MUST match authoritative expected amount
    if (amountInCentavos !== authoritativeExpectedCentavos) {
      throw new Error(
        `Payment amount mismatch: payment has ${amountInCentavos} centavos, but authoritative expected transaction amount is ${authoritativeExpectedCentavos} centavos`
      );
    }

    // Cross-verify both sources if both are present
    const snapshotStr = metadata?.amount_paid || metadata?.total_amount;
    if (
      typeof paymentIntentAttributes?.amount === "number" &&
      Number.isFinite(paymentIntentAttributes.amount) &&
      paymentIntentAttributes.amount > 0 &&
      snapshotStr
    ) {
      const snapshotParsed = Math.round(Number(snapshotStr) * 100);
      if (Number.isFinite(snapshotParsed) && snapshotParsed > 0 && snapshotParsed !== paymentIntentAttributes.amount) {
        throw new Error(
          `Authoritative amount conflict: PaymentIntent amount (${paymentIntentAttributes.amount}) does not match checkout snapshot (${snapshotParsed})`
        );
      }
    }

    if (paymentAttributes?.currency && paymentAttributes.currency.toUpperCase() !== "PHP") {
      throw new Error(`Invalid payment currency: ${paymentAttributes.currency}, expected PHP`);
    }

    // Gross amount actually charged by PayMongo
    const amount = amountInCentavos / 100;
    // Authoritative gateway timestamp resolution & fail-safe cancellation guard
    const hasTrustedTime = typeof paymentAttributes?.paid_at === "number" && Number.isFinite(paymentAttributes.paid_at) && paymentAttributes.paid_at > 0;
    const paymentTimeMs = hasTrustedTime ? paymentAttributes.paid_at * 1000 : null;

    const paymentMethodType: string =
      paymentAttributes?.source?.type ||
      paymentAttributes?.payment_method_details?.type ||
      metadata?.payment_method ||
      "gcash";

    const paymentMethodLabel =
      paymentMethodType === "paymaya" || paymentMethodType === "maya"
        ? "Maya"
        : paymentMethodType === "gcash"
        ? "GCash"
        : paymentMethodType;

    // Read the purchased plan record (name and net price)
    const { data: planRecord } = await supabase
      .from("plan")
      .select("plan_id, name, price")
      .eq("plan_id", metadata.plan_id)
      .maybeSingle();

    let planName: string = planRecord?.name || metadata?.plan_name || "";
    if (!planName) {
      planName = billingCycle === "yearly" ? "Pro (Annual)" : "Pro";
    }

    const finalAmountPaid = amount;

    // Check if user_payment is already recorded
    const { data: existingPayment } = await supabase
      .from("user_payment")
      .select("payment_id, payment_date")
      .eq("paymongo_payment_id", paymongoPaymentId)
      .maybeSingle();

    // Query existing subscription early for exact-payment idempotency & cancellation guard
    const { data: existingSub } = await supabase
      .from("user_plan_subscription")
      .select("subscription_id, plan_id, status, started_at, current_period_start, current_period_end, cancel_at_period_end, cancelled_at")
      .eq("user_id", metadata.user_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Validate existing payment_date if present
    const existingPaymentDateMs = existingPayment?.payment_date
      ? new Date(existingPayment.payment_date).getTime()
      : null;
    const validExistingDateMs =
      typeof existingPaymentDateMs === "number" &&
      Number.isFinite(existingPaymentDateMs) &&
      existingPaymentDateMs > 0
        ? existingPaymentDateMs
        : null;

    // Authoritative reference payment timestamp (gateway paid_at first, then recorded payment_date)
    const refPaymentTimeMs = paymentTimeMs ?? validExistingDateMs;

    // Strict Fail-Closed Safety Gate:
    // If an incoming payment has NO verifiable payment timestamp from PayMongo or existing payment record:
    // DO NOT manufacture a timestamp using new Date() or Date.now().
    // DO NOT grant an arbitrary subscription period.
    // Reject safely with an explicit, recoverable error requiring verification.
    if (refPaymentTimeMs === null || !Number.isFinite(refPaymentTimeMs) || refPaymentTimeMs <= 0) {
      throw new Error(
        `Cannot safely fulfill payment ${paymongoPaymentId}: authoritative payment timestamp is missing or invalid. Client re-verification required.`
      );
    }

    const paymentDateIso = new Date(refPaymentTimeMs).toISOString();

    // Scenario C Check: If reference payment time is older than the current subscription's start,
    // do NOT overwrite the newer subscription! (Preserves newer subscription and cancellation state)
    const existingStartedMs = existingSub?.started_at ? new Date(existingSub.started_at).getTime() : 0;
    const isOlderPayment = Boolean(
      existingSub &&
      existingStartedMs > 0 &&
      existingStartedMs > refPaymentTimeMs + 5000
    );

    if (isOlderPayment) {
      console.log(
        "[webhook] Incoming payment timestamp is older than current subscription started_at:",
        { paymentTime: refPaymentTimeMs, existingStartedAt: existingSub?.started_at },
        "- Preserving newer subscription. Idempotent skip."
      );
      return jsonResponse({ received: true, idempotentSkip: true, reason: "older_payment_ignored" }, 200);
    }

    // Recipient: account email first (auth.users, then public.user), then the
    // email attached to the payment intent. No other fallback.
    let recipientEmail: string | null = null;

    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(metadata.user_id);
      recipientEmail = authUser?.user?.email || null;
    } catch (authErr) {
      console.warn("[webhook] admin.getUserById warning:", authErr);
    }

    if (!recipientEmail) {
      try {
        const { data: userRow } = await supabase
          .from("user")
          .select("email")
          .eq("user_id", metadata.user_id)
          .maybeSingle();
        recipientEmail = userRow?.email || null;
      } catch (uErr) {
        console.warn("[webhook] user table lookup warning:", uErr);
      }
    }

    if (!recipientEmail && metadata?.payment_email) {
      recipientEmail = metadata.payment_email;
    }

    if (!recipientEmail) {
      console.warn("[webhook] No recipient email resolved yet; subscription is activated before aborting.");
    }

    // Scenario A Check: Exact-payment fulfillment idempotency
    // If this exact PayMongo payment is already recorded in user_payment AND the subscription is
    // already active on this plan with period start anchored to this payment, do NOT recalculate dates or re-upsert.
    const subPeriodStartMs = existingSub?.current_period_start ? new Date(existingSub.current_period_start).getTime() : 0;

    const isAlreadyFullyFulfilled = Boolean(
      existingPayment &&
      existingSub &&
      existingSub.status === "active" &&
      existingSub.plan_id === metadata.plan_id &&
      Math.abs(subPeriodStartMs - refPaymentTimeMs) < 10000
    );

    if (isAlreadyFullyFulfilled) {
      console.log("[webhook] Exact payment already fulfilled (anchored start matches):", paymongoPaymentId, "- Idempotent skip.");

      // Check if receipt email has already been sent (using .limit(1) to avoid PGRST116 multi-row error)
      let emailAlreadySent = false;
      try {
        const { data: auditLogRows, error: auditErr } = await supabase
          .from("system_audit_log")
          .select("log_id")
          .eq("action", "Receipt Email Sent")
          .ilike("details", `%${paymongoPaymentId}%`)
          .limit(1);

        if (!auditErr && Array.isArray(auditLogRows) && auditLogRows.length > 0) {
          emailAlreadySent = true;
        }
      } catch {
        // Non-blocking check
      }

      if (emailAlreadySent) {
        return jsonResponse({ received: true, idempotentSkip: true }, 200);
      }
      console.log("[webhook] Subscription fulfilled but receipt not recorded as sent. Proceeding to atomic email delivery.");
    }

    if (!isAlreadyFullyFulfilled) {
    if (!existingPayment) {
      const paymentRecord = {
        amount: finalAmountPaid,
        payment_date: paymentDateIso,
        method: paymentMethodType,
        status: "success",
        user_id: metadata.user_id,
        plan_id: metadata.plan_id,
        billing_cycle: billingCycle,
        reference_number: paymongoPaymentId,
        paymongo_payment_id: paymongoPaymentId,
        paymongo_payment_intent_id: paymentIntentId,
      };

      const { error: paymentInsertError } = await supabase
        .from("user_payment")
        .insert(paymentRecord);

      if (paymentInsertError) {
        console.error("user_payment insert error:", paymentInsertError);
      } else {
        console.log("Successful payment recorded in user_payment:", paymongoPaymentId);
      }
    } else {
      console.log("user_payment already exists; completing subscription activation for:", paymongoPaymentId);
    }

    // Activate subscription anchored to authoritative payment timestamp
    const periodStart = new Date(refPaymentTimeMs);
    const periodEnd = new Date(periodStart);

    if (billingCycle === "yearly") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }



    const cancelledTime = existingSub?.cancelled_at ? new Date(existingSub.cancelled_at).getTime() : 0;

    // Fail-safe rule: If the user currently has a cancellation scheduled (cancel_at_period_end: true),
    // ONLY clear it if we have an authoritative gateway timestamp proving the payment occurred AFTER the cancellation.
    // If the timestamp is missing, invalid, unverified, or equal/older than cancelledTime, preserve the cancellation.
    const isNewerCancellation = Boolean(
      existingSub?.cancel_at_period_end &&
      (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
    );

    const subscriptionRecord = {
      user_id: metadata.user_id,
      plan_id: metadata.plan_id,
      status: "active",
      billing_cycle: billingCycle,
      started_at: periodStart.toISOString(),
      renews_at: periodEnd.toISOString(),
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: isNewerCancellation ? true : false,
      cancelled_at: isNewerCancellation ? (existingSub?.cancelled_at ?? null) : null,
      payment_method: metadata.payment_method || paymentMethodType,
      payment_full_name: metadata.payment_full_name || null,
      payment_email: recipientEmail,
      billing_address: metadata.billing_address || null,
      payment_mobile_number: metadata.payment_mobile_number || null,
      updated_at: new Date().toISOString(),
    };

    const { error: subscriptionUpsertError } = await supabase
      .from("user_plan_subscription")
      .upsert(subscriptionRecord, { onConflict: "user_id" });

    if (subscriptionUpsertError) {
      console.error("user_plan_subscription upsert error:", subscriptionUpsertError);

      // Maya/any method: retry with progressively safer payloads so the account still becomes Pro.
      const fallbackResult = await activateSubscriptionWithFallback(
        supabase,
        subscriptionRecord,
        "[webhook]",
      );

      if (!fallbackResult.ok) {
        // Throwing marks the webhook event as failed so PayMongo retries delivery.
        throw new Error(`Subscription activation failed: ${fallbackResult.error}`);
      }
    } else {
      console.log("Subscription activated successfully:", metadata.user_id);
    }

    // Subscription is now persisted; only then enforce that a receipt recipient exists.
    if (!recipientEmail) {
      throw new Error("Missing recipient email address");
    }

    // Synchronize User Profile (safely updates plan_tier or updated_at)
    try {
      const { error: profileErr } = await supabase
        .from("user")
        .update({
          plan_tier: "pro",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", metadata.user_id);

      if (profileErr) {
        await supabase
          .from("user")
          .update({ updated_at: new Date().toISOString() })
          .eq("user_id", metadata.user_id);
      }
      console.log("[webhook] user profile synchronized for Pro tier:", metadata.user_id);
    } catch (profErr) {
      console.warn("[webhook] User profile sync warning:", profErr);
    }

    // In-app subscription notifications disabled: receipts and payment confirmations are handled strictly via email.

    // Record 'Subscription Upgraded' in system_audit_log
    await recordAuditLog({
      userId: metadata.user_id,
      action: "Subscription Upgraded",
      target: `User #${metadata.user_id}`,
      details: "Patient upgraded to Pro plan following successful payment.",
      metadata: {
        planId: metadata.plan_id,
        planName,
        billingCycle,
        paymentMethod: paymentMethodLabel,
        amount,
        transactionId: paymongoPaymentId,
        currentPeriodStart: periodStart.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      },
    });
    }

    // 5. Send Receipt Email (Atomic Outbox Claim with system_audit_log defense-in-depth)
    let alreadySentLog = null;
    try {
      const { data: auditLogRows, error: auditErr } = await supabase
        .from("system_audit_log")
        .select("log_id, details")
        .eq("action", "Receipt Email Sent")
        .ilike("details", `%${paymongoPaymentId}%`)
        .limit(1);

      if (auditErr) {
        console.warn("[Webhook] system_audit_log query warning (falling back to email_outbox claim):", auditErr.message);
      } else if (Array.isArray(auditLogRows) && auditLogRows.length > 0) {
        alreadySentLog = auditLogRows[0];
      }
    } catch (auditCatchErr) {
      console.warn("[Webhook] system_audit_log exception:", auditCatchErr);
    }

    if (alreadySentLog) {
      console.log("[Webhook] Receipt email already sent previously for payment:", paymongoPaymentId);
    } else if (recipientEmail && paymongoPaymentId && paymongoPaymentId.startsWith("pay_")) {
      const idempotencyKey = `subscription_receipt:${paymongoPaymentId}`;

      const { data: claimResult, error: claimErr } = await supabase.rpc(
        "claim_email_outbox",
        {
          p_idempotency_key: idempotencyKey,
          p_email_type: "subscription_payment_receipt",
          p_recipient_email: recipientEmail,
          p_user_id: metadata.user_id,
          p_appointment_id: null,
          p_payload: {
            patientEmail: recipientEmail,
            patientName: metadata.patient_name || "Patient",
            paymentMethod: paymentMethodLabel,
            amount,
            planName,
            billingCycle,
            paymentDate: paymentDateIso,
            paymongoPaymentId,
          },
          p_lease_seconds: 120,
        }
      );

      if (claimErr) {
        console.error("[Webhook] Failed to claim email outbox for subscription receipt:", claimErr);
      } else if (claimResult?.claim_acquired) {
        const outboxId = claimResult.outbox_id;
        try {
          const emailResult = await sendReceiptEmail({
            patientEmail: recipientEmail,
            paymentMethod: paymentMethodLabel,
            amount,
            planName,
            billingCycle,
            paymentDate: paymentDateIso,
            paymongoPaymentId,
          });

          if (emailResult.success) {
            await supabase.rpc("finalize_email_outbox", {
              p_outbox_id: outboxId,
              p_success: true,
            });

            await recordAuditLog({
              userId: metadata.user_id,
              action: "Receipt Email Sent",
              target: recipientEmail,
              details: `Receipt email dispatched to ${recipientEmail} for payment ${paymongoPaymentId} (amount: ₱${amount.toFixed(2)}).`,
              metadata: {
                provider: emailResult.provider,
                messageId: emailResult.messageId,
                amount,
                transactionId: paymongoPaymentId,
              },
            });

            console.log("[Webhook] Receipt email sent successfully.");
          } else {
            const errMessage = emailResult.error || "Email provider dispatch failed";
            console.error("[Webhook] Receipt email delivery failed:", errMessage);
            await supabase.rpc("finalize_email_outbox", {
              p_outbox_id: outboxId,
              p_success: false,
              p_error: errMessage,
            });

            await recordAuditLog({
              userId: metadata.user_id,
              action: "Receipt Email Failed",
              target: recipientEmail || "Unresolved recipient",
              details: `Failed to deliver receipt email for payment ${paymongoPaymentId}: ${errMessage}`,
              metadata: { error: errMessage, amount, transactionId: paymongoPaymentId },
            });
          }
        } catch (emailError) {
          const errMessage = emailError instanceof Error ? emailError.message : String(emailError);
          console.error("[Webhook] Receipt email delivery exception:", errMessage);
          await supabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: errMessage,
          });

          await recordAuditLog({
            userId: metadata.user_id,
            action: "Receipt Email Failed",
            target: recipientEmail || "Unresolved recipient",
            details: `Failed to deliver receipt email for payment ${paymongoPaymentId}: ${errMessage}`,
            metadata: { error: errMessage, amount, transactionId: paymongoPaymentId },
          });
        }
      } else {
        console.log(`[Webhook] Subscription receipt email outbox claim skipped (status: ${claimResult?.status})`);
      }
    }

    // Mark webhook event processed
    await supabase
      .from("paymongo_webhook_event")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("event_id", eventId);

    return jsonResponse({
      received: true,
      message: "Payment and subscription processed successfully.",
      eventId,
      paymentIntentId,
      paymongoPaymentId,
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unexpected server error";

    if (typeof eventId === "string" && eventId) {
      await supabase
        .from("paymongo_webhook_event")
        .update({
          status: "failed",
          error_message: errorMessage,
        })
        .eq("event_id", eventId);
    }

    return jsonResponse({ error: errorMessage }, 500);
  }
});


/**
 * Resilient activation of public.user_plan_subscription (used by every payment method).
 *
 * The caller always tries the normal upsert first (GCash path is unchanged). Only when that
 * write fails (e.g. a live-DB CHECK constraint on payment_method rejecting "maya"/"paymaya",
 * a missing optional column, or a stale expired/cancelled row) do we walk down this ladder:
 *   1. same record + reset cancel flags
 *   2. same record with every known spelling of the payment method (maya / Maya / paymaya ...)
 *   3. record without the optional billing columns
 *   4. plain UPDATE by user_id, then INSERT
 * so that a successful payment can never leave the account on Free / expired.
 */
async function activateSubscriptionWithFallback(
  // deno-lint-ignore no-explicit-any
  client: any,
  // deno-lint-ignore no-explicit-any
  record: Record<string, any>,
  logTag = "[subscription]",
): Promise<{ ok: boolean; error: string | null; attempt: string }> {
  const TABLE = "user_plan_subscription";
  const rawMethod = String(record.payment_method ?? "").toLowerCase().trim();
  const isMaya = rawMethod === "maya" || rawMethod === "paymaya";
  const isGcash = rawMethod === "gcash";
  const methodVariants: string[] = isMaya
    ? ["maya", "Maya", "paymaya", "PayMaya"]
    : isGcash
    ? ["gcash", "GCash"]
    : [String(record.payment_method ?? "Online Payment")];

  const optionalKeys = [
    "payment_method",
    "payment_full_name",
    "payment_email",
    "billing_address",
    "payment_mobile_number",
  ];
  const resetFields = { cancel_at_period_end: false, cancelled_at: null };

  // deno-lint-ignore no-explicit-any
  const stripped: Record<string, any> = { ...record };
  for (const key of optionalKeys) delete stripped[key];

  // deno-lint-ignore no-explicit-any
  const candidates: Array<{ label: string; row: Record<string, any> }> = [
    { label: "reset-cancel-flags", row: { ...record, ...resetFields } },
    ...methodVariants.map((m) => ({
      label: `payment_method=${m}`,
      row: { ...record, payment_method: m },
    })),
    { label: "without-optional-columns+reset", row: { ...stripped, ...resetFields } },
    { label: "without-optional-columns", row: stripped },
  ];

  let lastError: string | null = null;

  for (const candidate of candidates) {
    const { error } = await client
      .from(TABLE)
      .upsert(candidate.row, { onConflict: "user_id" });
    if (!error) {
      console.log(`${logTag} subscription activated via fallback attempt: ${candidate.label}`);
      return { ok: true, error: null, attempt: candidate.label };
    }
    lastError = error.message || String(error);
    console.warn(`${logTag} subscription fallback attempt "${candidate.label}" failed:`, lastError);
  }

  // Last resort: explicit UPDATE of the existing row, then INSERT when there is none.
  const { data: updatedRows, error: updateError } = await client
    .from(TABLE)
    .update(stripped)
    .eq("user_id", record.user_id)
    .select("subscription_id");

  if (!updateError && Array.isArray(updatedRows) && updatedRows.length > 0) {
    console.log(`${logTag} subscription activated via explicit UPDATE fallback`);
    return { ok: true, error: null, attempt: "update-by-user_id" };
  }
  if (updateError) lastError = updateError.message || lastError;

  const { error: insertError } = await client.from(TABLE).insert(stripped);
  if (!insertError) {
    console.log(`${logTag} subscription activated via INSERT fallback`);
    return { ok: true, error: null, attempt: "insert" };
  }
  lastError = insertError.message || lastError;

  console.error(`${logTag} all subscription activation fallbacks failed:`, lastError);
  return { ok: false, error: lastError, attempt: "none" };
}
