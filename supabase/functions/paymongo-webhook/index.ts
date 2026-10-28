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

    if (
      (!metadata?.user_id || (!metadata?.plan_id && metadata?.payment_type !== "appointment_booking")) &&
      paymentIntentId
    ) {
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
      if (paymentIntentResponse.ok && paymentIntentJson?.data?.attributes?.metadata) {
        metadata = paymentIntentJson.data.attributes.metadata;
        console.log("[webhook] Metadata retrieved from Payment Intent.");
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

      const amountInCentavos = paymentAttributes?.amount;
      if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
        throw new Error("PayMongo payment amount is missing or invalid for booking");
      }
      const amount = amountInCentavos / 100;
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

      // 1. Check for existing payment to prevent duplicate records
      const { data: existingPayment } = await supabase
        .from("user_payment")
        .select("payment_id")
        .eq("paymongo_payment_id", paymongoPaymentId)
        .maybeSingle();

      if (!existingPayment && userId) {
        const { error: paymentInsertError } = await supabase
          .from("user_payment")
          .insert({
            amount,
            payment_date: paymentDateIso,
            method: paymentMethodType,
            status: "success",
            user_id: userId,
            plan_id: null,
            billing_cycle: null,
            reference_number: paymongoPaymentId,
            paymongo_payment_id: paymongoPaymentId,
            paymongo_payment_intent_id: paymentIntentId,
            appointment_id: appointmentId,
            clinic_id: metadata?.clinic_id || null,
            payment_type: "appointment_consultation",
          });

        if (paymentInsertError) {
          console.error("[webhook] user_payment insert error for booking:", paymentInsertError);
        } else {
          console.log("[webhook] Successful booking payment recorded in user_payment:", paymongoPaymentId);
        }
      }

      // 2. Update patient_appointment table if appointmentId is present
      if (appointmentId) {
        const paySummary = `Paid Online (${paymentMethodLabel} Ref: ${paymongoPaymentId})`;
        const { data: currentAppt } = await supabase
          .from("patient_appointment")
          .select("clinic_note, user_id, payment_status, payment_amount")
          .eq("appointment_id", appointmentId)
          .maybeSingle();

        if (currentAppt) {
          if (userId && currentAppt.user_id && currentAppt.user_id !== userId) {
            console.warn(`[webhook] User ID mismatch for appointment ${appointmentId}: expected ${userId}, got ${currentAppt.user_id}`);
          } else {
            const existingNote = currentAppt.clinic_note || "";
            const updatedNote = existingNote.includes("Paid Online")
              ? existingNote
              : existingNote ? `${existingNote} | ${paySummary}` : paySummary;

            const { error: apptUpdateError } = await supabase
              .from("patient_appointment")
              .update({
                payment_status: "paid",
                payment_reference: paymongoPaymentId,
                payment_amount: amount,
                paid_at: paymentDateIso,
                clinic_note: updatedNote,
                check_in_status: "scheduled",
              })
              .eq("appointment_id", appointmentId);

            if (apptUpdateError) {
              console.warn("[webhook] patient_appointment update note:", apptUpdateError.message);
            } else {
              console.log("[webhook] patient_appointment marked paid for booking:", appointmentId);
            }
          }
        }
      }

      // 3. Resolve recipient email and send consultation booking receipt
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
        try {
          await sendBookingReceiptEmail({
            patientEmail: recipientEmail,
            patientName: metadata.patient_name || "Patient",
            clinicName: metadata.clinic_name || "Skin Clinic",
            doctorName: metadata.doctor_name || "Attending Dermatologist",
            appointmentDate: metadata.appointment_date || "Scheduled Date",
            appointmentTime: metadata.appointment_time || "Scheduled Time",
            paymentMethod: paymentMethodLabel,
            amount,
            paymentDate: paymentDateIso,
            paymongoPaymentId,
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
        } catch (mailErr) {
          console.warn("[webhook] Booking receipt email dispatch warning:", mailErr);
        }
      }

      // 4. Mark webhook event processed
      await supabase
        .from("paymongo_webhook_event")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("event_id", eventId);

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

    // Gross amount actually charged by PayMongo
    const amount = amountInCentavos / 100;
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
      .select("payment_id")
      .eq("paymongo_payment_id", paymongoPaymentId)
      .maybeSingle();

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
      console.log("user_payment already exists for reference:", paymongoPaymentId);
    }

    // Activate subscription
    const periodStart = new Date();
    const periodEnd = new Date(periodStart);

    if (billingCycle === "yearly") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
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
      throw new Error("Missing recipient email address");
    }

    const subscriptionRecord = {
      user_id: metadata.user_id,
      plan_id: metadata.plan_id,
      status: "active",
      billing_cycle: billingCycle,
      started_at: periodStart.toISOString(),
      renews_at: periodEnd.toISOString(),
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
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
    } else {
      console.log("Subscription activated successfully:", metadata.user_id);
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

    // In-app notification welcoming patient to Pro tier (prevent duplicate)
    try {
      const { data: existingNotif } = await supabase
        .from("user_notification")
        .select("notif_id")
        .eq("user_id", metadata.user_id)
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
        const { error: notifErr } = await supabase
          .from("user_notification")
          .insert({
            user_id: metadata.user_id,
            type: "subscription",
            subtype: "subscription_upgraded",
            title: "Welcome to DermAI Pro!",
            body: `Your payment was successful. You now have unlimited AI skin scans and Pro features enabled until ${formattedEndDate}.`,
            is_read: false,
            created_at: new Date().toISOString(),
          });
        if (notifErr) {
          console.warn("[webhook] user_notification insert warning:", notifErr.message);
        } else {
          console.log("[webhook] user_notification created for Pro upgrade:", metadata.user_id);
        }
      }
    } catch (notifErr) {
      console.warn("[webhook] user_notification warning:", notifErr);
    }

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

    // Check if receipt email was already sent
    const { data: alreadySentLog } = await supabase
      .from("system_audit_log")
      .select("log_id")
      .eq("action", "Receipt Email Sent")
      .ilike("details", `%${paymongoPaymentId}%`)
      .maybeSingle();

    if (alreadySentLog) {
      console.log("[Webhook] Receipt email already sent previously for payment:", paymongoPaymentId);
    } else {
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
      } catch (emailError) {
        const errMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.error("[Webhook] Receipt email delivery failed:", errMessage);

        await recordAuditLog({
          userId: metadata.user_id,
          action: "Receipt Email Failed",
          target: recipientEmail || "Unresolved recipient",
          details: `Failed to deliver receipt email for payment ${paymongoPaymentId}: ${errMessage}`,
          metadata: { error: errMessage, amount, transactionId: paymongoPaymentId },
        });
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
