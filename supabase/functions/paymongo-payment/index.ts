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

  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",

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

  // deno-lint-ignore no-explicit-any
  metadata?: Record<string, any>;

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

 * Safely attempts to cancel a PayMongo PaymentIntent after database tracking fails.

 * Fails gracefully and logs status if the gateway cannot cancel or is unreachable.

 */

async function attemptCancelPayMongoIntent(intentId: string, headers: Record<string, string>): Promise<boolean> {

  try {

    const res = await fetch(`${PAYMONGO_API}/payment_intents/${intentId}/cancel`, {

      method: "POST",

      headers,

      body: JSON.stringify({ data: {} }),

    });

    if (!res.ok) {

      console.warn(`[paymongo-payment] Gateway refused intent cancellation for ${intentId}: HTTP ${res.status}`);

      return false;

    }

    console.log(`[paymongo-payment] Successfully cancelled orphaned intent ${intentId} on gateway.`);

    return true;

  } catch (err) {

    console.warn(`[paymongo-payment] Failed to reach gateway to cancel intent ${intentId}:`, err);

    return false;

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

  paidAtSeconds,

  expectedAmountInCentavos,

}: {

  paymongoPaymentId: string;

  paymentIntentId: string | null;

  amountInCentavos: number;

  paymentMethodType: string;

  // deno-lint-ignore no-explicit-any
  metadata: Record<string, any>;

  userAuthEmail?: string | null;

  paidAtSeconds?: number | null;

  expectedAmountInCentavos?: number | null;

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

  // Authoritative Expected Amount Validation:
  // Must verify from at least one trusted source: PaymentIntent authoritative amount or checkout snapshot
  let authoritativeExpectedCentavos: number | null = null;

  if (typeof expectedAmountInCentavos === "number" && Number.isFinite(expectedAmountInCentavos) && expectedAmountInCentavos > 0) {
    authoritativeExpectedCentavos = expectedAmountInCentavos;
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
      `Cannot verify payment amount for payment ${paymongoPaymentId}: authoritative expected transaction amount is missing or malformed.`
    );
  }

  // Strict equality check: paid amount MUST match authoritative expected amount
  if (amountInCentavos !== authoritativeExpectedCentavos) {
    throw new Error(
      `Payment amount mismatch: received ${amountInCentavos} centavos, but authoritative expected transaction amount is ${authoritativeExpectedCentavos} centavos`
    );
  }

  // Cross-verify both sources if both are present
  const snapshotStr = metadata?.amount_paid || metadata?.total_amount;
  if (
    typeof expectedAmountInCentavos === "number" &&
    Number.isFinite(expectedAmountInCentavos) &&
    expectedAmountInCentavos > 0 &&
    snapshotStr
  ) {
    const snapshotParsed = Math.round(Number(snapshotStr) * 100);
    if (Number.isFinite(snapshotParsed) && snapshotParsed > 0 && snapshotParsed !== expectedAmountInCentavos) {
      throw new Error(
        `Authoritative amount conflict: PaymentIntent amount (${expectedAmountInCentavos}) does not match checkout snapshot (${snapshotParsed})`
      );
    }
  }

  // Gross amount actually charged by PayMongo

  const grossAmount = amountInCentavos / 100;

  // Authoritative gateway timestamp resolution & fail-safe cancellation guard
  const hasTrustedTime = typeof paidAtSeconds === "number" && Number.isFinite(paidAtSeconds) && paidAtSeconds > 0;
  const paymentTimeMs = hasTrustedTime ? paidAtSeconds * 1000 : null;

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

    console.warn("[fulfillPayment] No recipient email resolved yet; subscription is activated before aborting.");

  }

  // 3. Check for existing payment to avoid duplicate record & duplicate fulfillment
  const { data: existingPayment } = await adminSupabase
    .from("user_payment")
    .select("payment_id, payment_date")
    .eq("paymongo_payment_id", paymongoPaymentId)
    .maybeSingle();

  // Query existing subscription early for exact-payment idempotency & cancellation guard
  const { data: existingSub } = await adminSupabase
    .from("user_plan_subscription")
    .select("subscription_id, plan_id, status, started_at, current_period_start, current_period_end, cancel_at_period_end, cancelled_at")
    .eq("user_id", userId)
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
      "[fulfillPayment] Incoming payment timestamp is older than current subscription started_at:",
      { paymentTime: refPaymentTimeMs, existingStartedAt: existingSub?.started_at },
      "- Preserving newer subscription. Idempotent skip."
    );
    return {
      success: true,
      idempotentSkip: true,
      paymongoPaymentId,
      planId,
      userId,
    };
  }

  // Scenario A Check: Exact-payment fulfillment idempotency
  // If this exact PayMongo payment is already recorded in user_payment AND the subscription is
  // already active on this plan with period start anchored to this payment, do NOT recalculate dates or re-upsert.
  const subPeriodStartMs = existingSub?.current_period_start ? new Date(existingSub.current_period_start).getTime() : 0;

  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === planId &&
    Math.abs(subPeriodStartMs - refPaymentTimeMs) < 10000
  );

  if (isAlreadyFullyFulfilled) {
    console.log("[fulfillPayment] Exact payment already fulfilled (anchored start matches):", paymongoPaymentId, "- Idempotent skip.");

    // Check if receipt email has already been sent (using .limit(1) to avoid PGRST116 multi-row error)
    let emailAlreadySent = false;
    try {
      const { data: auditLogRows, error: auditErr } = await adminSupabase
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
      return {
        success: true,
        fulfilled: true,
        idempotentSkip: true,
        emailDispatched: true,
        paymongoPaymentId,
        planId,
        userId,
      };
    }
    console.log("[fulfillPayment] Subscription fulfilled but receipt not recorded as sent. Proceeding to atomic email delivery.");
  }

  if (!isAlreadyFullyFulfilled) {
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

    console.log("[fulfillPayment] user_payment already exists; completing subscription activation for:", paymongoPaymentId);

  }

  // 4. Update / activate subscription period anchored to authoritative payment timestamp
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

    user_id: userId,

    plan_id: planId,

    status: "active",

    billing_cycle: billingCycle,

    started_at: periodStart.toISOString(),

    renews_at: periodEnd.toISOString(),

    current_period_start: periodStart.toISOString(),

    current_period_end: periodEnd.toISOString(),

    cancel_at_period_end: isNewerCancellation ? true : false,

    cancelled_at: isNewerCancellation ? (existingSub?.cancelled_at ?? null) : null,

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

    // Maya/any method: retry with progressively safer payloads so the account still becomes Pro.
    const fallbackResult = await activateSubscriptionWithFallback(
      adminSupabase,
      subscriptionRecord,
      "[fulfillPayment]",
    );

    if (!fallbackResult.ok) {
      throw new Error(`Subscription activation failed: ${fallbackResult.error}`);
    }

  } else {

    console.log("[fulfillPayment] user_plan_subscription activated for user:", userId);

  }

  // Subscription is now persisted; only then enforce that a receipt recipient exists.
  if (!recipientEmail) {
    throw new Error("Missing recipient email address");
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

  // 4c. In-app subscription notifications disabled: receipts and payment confirmations are handled strictly via email.

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
  }

  // 5. Send Receipt Email (Atomic Outbox Claim with system_audit_log defense-in-depth)

  let emailDispatched = false;

  let emailErrorMsg: string | null = null;

  // Defense-in-depth: Check historical system_audit_log with .limit(1) to avoid PGRST116 multi-row error
  let alreadySentLog = null;
  try {
    const { data: auditLogRows, error: auditErr } = await adminSupabase
      .from("system_audit_log")
      .select("log_id, details")
      .eq("action", "Receipt Email Sent")
      .ilike("details", `%${paymongoPaymentId}%`)
      .limit(1);

    if (auditErr) {
      console.warn("[fulfillPayment] system_audit_log query warning (falling back to email_outbox claim):", auditErr.message);
    } else if (Array.isArray(auditLogRows) && auditLogRows.length > 0) {
      alreadySentLog = auditLogRows[0];
    }
  } catch (auditCatchErr) {
    console.warn("[fulfillPayment] system_audit_log exception:", auditCatchErr);
  }

  if (alreadySentLog) {
    console.log("[fulfillPayment] Receipt email was already sent for payment (historical audit log match):", paymongoPaymentId);
    return {
      fulfilled: true,
      emailDispatched: true,
      emailError: null,
      alreadyProcessed: true,
      recipientEmail,
      amount: grossAmount,
      paymongoPaymentId,
    };
  }

  let claimResult: { claim_acquired?: boolean; status?: string; outbox_id?: string } | null = null;

  if (recipientEmail && paymongoPaymentId && paymongoPaymentId.startsWith("pay_")) {
    const idempotencyKey = `subscription_receipt:${paymongoPaymentId}`;

    const { data: claimData, error: claimErr } = await adminSupabase.rpc(
      "claim_email_outbox",
      {
        p_idempotency_key: idempotencyKey,
        p_email_type: "subscription_payment_receipt",
        p_recipient_email: recipientEmail,
        p_user_id: userId,
        p_appointment_id: null,
        p_payload: {
          patientEmail: recipientEmail,
          patientName: metadata?.patient_name || "Patient",
          paymentMethod: paymentMethodLabel,
          amount: grossAmount,
          planName,
          billingCycle,
          paymentDate: paymentDateIso,
          paymongoPaymentId,
        },
        p_lease_seconds: 120,
      }
    );

    if (claimErr) {
      console.error("[fulfillPayment] Failed to claim email outbox for subscription receipt:", claimErr);
      emailErrorMsg = claimErr.message;
    } else {
      claimResult = claimData;
    }

    if (claimResult?.claim_acquired) {
      const outboxId = claimResult.outbox_id;
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

        if (dispatchResult.success) {
          emailDispatched = true;
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: true,
          });

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
        } else {
          emailErrorMsg = dispatchResult.error || "Email provider dispatch failed";
          console.error("[fulfillPayment] Receipt email delivery failed:", emailErrorMsg);
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: emailErrorMsg,
          });
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
      } catch (mailErr) {
        emailErrorMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
        console.error("[fulfillPayment] Receipt email sending exception:", emailErrorMsg);
        await adminSupabase.rpc("finalize_email_outbox", {
          p_outbox_id: outboxId,
          p_success: false,
          p_error: emailErrorMsg,
        });
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
    } else {
      console.log(`[fulfillPayment] Subscription receipt email outbox claim skipped (status: ${claimResult?.status})`);
      emailDispatched = claimResult?.status === "sent";
      if (claimResult?.status === "processing") {
        emailErrorMsg = "Receipt email delivery in progress by another worker";
      }
    }
  }

  return {
    fulfilled: true,
    emailDispatched,
    emailError: emailErrorMsg,
    alreadyProcessed: Boolean(alreadySentLog || claimResult?.status === "sent"),
    recipientEmail,
    amount: grossAmount,
    paymongoPaymentId,
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

  // deno-lint-ignore no-explicit-any
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

      } catch (mailErr: unknown) {

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

  // Handle browser redirect return for mobile e-wallet payments
  if (req.method === "GET") {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "success";
    const appointmentId = url.searchParams.get("appointment_id") || url.searchParams.get("booking_id") || "";
    const paymentIntentId = url.searchParams.get("payment_intent") || url.searchParams.get("payment_intent_id") || "";
    const clientKey = url.searchParams.get("payment_intent_client_key") || url.searchParams.get("client_key") || "";

    const appRedirect = url.searchParams.get("app_redirect") || "";

    let deepLink: string;
    if (appRedirect) {
      const joiner = appRedirect.includes("?") ? "&" : "?";
      deepLink = `${appRedirect}${joiner}status=${encodeURIComponent(status)}&appointment_id=${encodeURIComponent(appointmentId)}&booking_id=${encodeURIComponent(appointmentId)}&payment_intent=${encodeURIComponent(paymentIntentId)}&client_key=${encodeURIComponent(clientKey)}`;
    } else {
      deepLink = `dermaimobile://payment-success?status=${encodeURIComponent(status)}&appointment_id=${encodeURIComponent(appointmentId)}&booking_id=${encodeURIComponent(appointmentId)}&payment_intent=${encodeURIComponent(paymentIntentId)}&client_key=${encodeURIComponent(clientKey)}`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${deepLink}">
  <title>Payment Completed - Returning to DermAI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa; color: #1e293b; text-align: center; padding: 24px; box-sizing: border-box; }
    .card { background: #ffffff; padding: 32px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 400px; width: 100%; }
    .btn { display: inline-block; margin-top: 24px; padding: 14px 28px; background: #be185d; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="color: #059669; margin-top: 0;">Payment Authorized</h2>
    <p>Redirecting you back to the DermAI app...</p>
    <a class="btn" href="${deepLink}">Open DermAI App</a>
  </div>
  <script>
    window.location.href = "${deepLink}";
  </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
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

    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    const token = bearerToken || apiKeyHeader.trim();

    if (!token) {

      return jsonResponse(

        { error: "Missing Authorization or apikey header" },

        401

      );

    }

    let user: { id: string; email?: string | null } | null = null;

    const isServiceRoleRequest = Boolean(supabaseServiceRoleKey && token === supabaseServiceRoleKey);

    let isAuthenticatedPatient = false;

    if (isServiceRoleRequest) {

      user = {

        id: "service_role",

        email: null,

      };

    } else {

      if (supabaseAnonKey && token === supabaseAnonKey) {

        return jsonResponse(

          { error: "Authenticated user session required" },

          401

        );

      }

      const {

        data: { user: authUser },

        error: userError,

      } = await supabase.auth.getUser(token);

      if (userError || !authUser?.id) {

        console.warn("[paymongo-payment] User auth failed:", userError?.message);

        return jsonResponse(

          { error: "Invalid or expired authentication token" },

          401

        );

      }

      user = authUser;

      isAuthenticatedPatient = true;

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

      if (isServiceRoleRequest || !isAuthenticatedPatient || !user?.id) {
        return jsonResponse(
          {
            error: isServiceRoleRequest
              ? "Booking checkout requires an authenticated patient session."
              : "Authenticated user session required.",
            code: isServiceRoleRequest ? "ERR_FORBIDDEN" : "ERR_UNAUTHORIZED",
          },
          isServiceRoleRequest ? 403 : 401
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

      // Canonical Payload Fingerprinting (SHA-256)
      const resolvedEmail = (patientEmail || user.email || "").toLowerCase().trim();
      const normalizedMethod = paymentMethod === "maya" ? "paymaya" : paymentMethod.toLowerCase().trim();
      const canonicalPayloadString = [
        effectiveAppointmentId.toLowerCase().trim(),
        clinicId.toLowerCase().trim(),
        userId.toLowerCase().trim(),
        normalizedMethod,
        resolvedEmail,
      ].join(":");

      const msgUint8 = new TextEncoder().encode(canonicalPayloadString);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      const payloadHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Concurrency Protection: Acquire exclusive 60-second checkout claim with state machine validation
      const claimId = crypto.randomUUID();
      const { data: claimData, error: claimErr } = await adminSupabase.rpc("claim_checkout_intent", {
        p_appointment_id: effectiveAppointmentId,
        p_claim_id: claimId,
        p_payment_method: paymentMethod,
        p_payload_hash: payloadHash,
        p_lease_seconds: 60,
      });

      if (claimErr || !claimData?.success) {
        const errCode = claimData?.code || (claimErr as { code?: string })?.code;
        if (errCode === "ERR_CLAIM_IN_PROGRESS") {
          return jsonResponse(
            {
              error: "Another checkout request is currently acquiring a payment intent for this reservation. Please wait a moment.",
              code: "ERR_CLAIM_IN_PROGRESS",
            },
            409
          );
        }
        if (errCode === "ERR_ALREADY_PAID") {
          return jsonResponse(
            { error: "Appointment is already paid", code: "ERR_ALREADY_PAID" },
            400
          );
        }
        if (errCode === "ERR_HOLD_EXPIRED") {
          return jsonResponse(
            {
              error: "Appointment reservation hold has expired or was cancelled. Please re-select a slot.",
              code: "ERR_HOLD_EXPIRED",
            },
            400
          );
        }
        if (errCode === "ERR_NOT_FOUND") {
          return jsonResponse(
            { error: "Appointment reservation not found", code: "ERR_NOT_FOUND" },
            404
          );
        }
        if (errCode === "ERR_CHECKOUT_COMMITTED") {
          return jsonResponse(
            {
              error: "A checkout session is already active or committed for this reservation.",
              code: "ERR_CHECKOUT_COMMITTED",
              paymentReference: claimData?.payment_reference,
            },
            409
          );
        }
        if (errCode === "ERR_METHOD_SWITCH_BLOCKED") {
          return jsonResponse(
            {
              error: claimData?.message || "Cannot switch payment methods while previous checkout attempt is unresolved. Please cancel the pending attempt first.",
              code: "ERR_METHOD_SWITCH_BLOCKED",
              pendingMethod: claimData?.pending_method,
            },
            409
          );
        }
        if (errCode === "ERR_IDEMPOTENCY_EXPIRED") {
          return jsonResponse(
            {
              error: "Checkout attempt exceeded the 24-hour gateway idempotency retention window and cannot be safely replayed. Please cancel this reservation or contact clinic support.",
              code: "ERR_IDEMPOTENCY_EXPIRED",
            },
            410
          );
        }
        return jsonResponse(
          { error: claimData?.message || claimErr?.message || "Failed to initialize checkout session." },
          400
        );
      }

      if (!claimData.user_id || claimData.user_id !== userId) {
        await adminSupabase.rpc("release_checkout_claim", {
          p_appointment_id: effectiveAppointmentId,
          p_claim_id: claimId,
        });
        return jsonResponse(
          { error: "Unauthorized access to appointment reservation", code: "ERR_FORBIDDEN" },
          403
        );
      }

      const attemptId = claimData.attempt_id;
      let idempotencyKey =
        claimData.idempotency_key ||
        claimData.checkout_idempotency_key ||
        `dermai_appt_${effectiveAppointmentId}`;

      // SEC-03: Proactively attempt recovery / cancellation of any pending or failed orphaned intents for this appointment
      try {
        const { data: pendingOrphans } = await adminSupabase
          .from("payment_intent_orphan")
          .select("paymongo_payment_id")
          .eq("appointment_id", effectiveAppointmentId)
          .in("status", ["pending_cancellation", "failed_cancellation"]);

        if (pendingOrphans && pendingOrphans.length > 0) {
          for (const orphan of pendingOrphans) {
            const cancelled = await attemptCancelPayMongoIntent(orphan.paymongo_payment_id, authHeaders);
            if (cancelled) {
              await adminSupabase.rpc("resolve_orphaned_intent", {
                p_paymongo_payment_id: orphan.paymongo_payment_id,
                p_status: "cancelled",
              });
            }
          }
        }
      } catch (orphanErr) {
        console.warn("[paymongo-payment] Non-fatal error checking orphaned intents:", orphanErr);
      }

      const trustedAmount = Number(claimData.payment_amount ?? amount ?? consultationFee ?? 0);
      if (isNaN(trustedAmount) || trustedAmount <= 0) {
        await adminSupabase.rpc("release_checkout_claim", {
          p_appointment_id: effectiveAppointmentId,
          p_claim_id: claimId,
        });
        throw new Error("Valid consultation fee amount is required");
      }

      // Consultation fee is VAT inclusive (gross amount) - strictly from trusted record
      const grossAmount = Math.round(trustedAmount * 100) / 100;
      const basePrice = Math.round((grossAmount / (1 + VAT_RATE)) * 100) / 100;
      const vatAmount = Math.round((grossAmount - basePrice) * 100) / 100;
      const amountInCentavos = Math.round(grossAmount * 100);

      // Check existing payment attempt: verify before creating a competing second intent
      const existingIntentId = claimData.payment_reference?.startsWith("pi_") ? claimData.payment_reference : null;
      if (existingIntentId) {
        try {
          const checkRes = await fetch(`${PAYMONGO_API}/payment_intents/${existingIntentId}`, {
            method: "GET",
            headers: authHeaders,
          });

          if (!checkRes.ok) {
            console.warn(`[paymongo-payment] Failed to verify existing intent ${existingIntentId} (HTTP ${checkRes.status}). Fail closed.`);
            await adminSupabase.rpc("release_checkout_claim", {
              p_appointment_id: effectiveAppointmentId,
              p_claim_id: claimId,
            });
            return jsonResponse(
              {
                error: "An existing payment attempt could not be verified with the gateway. Please wait a moment before retrying.",
                code: "ERR_GATEWAY_UNAVAILABLE",
              },
              502
            );
          }

          const checkData = await checkRes.json();
          const existingStatus = checkData?.data?.attributes?.status;
          const existingClientKey = checkData?.data?.attributes?.client_key;

          if (existingStatus === "succeeded") {
            await adminSupabase.rpc("release_checkout_claim", {
              p_appointment_id: effectiveAppointmentId,
              p_claim_id: claimId,
            });
            return jsonResponse(
              { error: "Appointment has already been paid and confirmed.", code: "ERR_ALREADY_PAID" },
              400
            );
          }

          if (existingStatus === "processing" || existingStatus === "awaiting_next_action") {
            await adminSupabase.rpc("release_checkout_claim", {
              p_appointment_id: effectiveAppointmentId,
              p_claim_id: claimId,
            });
            return jsonResponse(
              {
                error: "A payment attempt is currently in progress for this reservation. Please complete your existing checkout or wait for confirmation.",
                code: "ERR_PAYMENT_IN_PROGRESS",
                paymentIntentId: existingIntentId,
              },
              409
            );
          }

          // If awaiting_payment_method and valid clientKey, reuse existing intent atomically instead of creating a conflicting duplicate
          if (existingStatus === "awaiting_payment_method" && existingClientKey) {
            console.log(`[paymongo-payment] Reusing existing valid intent ${existingIntentId} for appointment ${effectiveAppointmentId}`);
            const { data: reuseCommit, error: reuseErr } = await adminSupabase.rpc("commit_checkout_intent", {
              p_appointment_id: effectiveAppointmentId,
              p_claim_id: claimId,
              p_attempt_id: attemptId,
              p_intent_id: existingIntentId,
              p_method: paymentMethod,
              p_amount: grossAmount,
              p_clinic_id: clinicId,
              p_user_id: userId,
            });

            if (reuseErr || !reuseCommit?.success) {
              console.error("[paymongo-payment] Failed to commit user_payment during intent reuse:", reuseErr || reuseCommit);
              await adminSupabase.rpc("release_checkout_claim", {
                p_appointment_id: effectiveAppointmentId,
                p_claim_id: claimId,
              });
              return jsonResponse(
                {
                  error: "Failed to securely record payment transaction in database. Payment cannot proceed.",
                  code: "ERR_DB_TRACKING_FAILED",
                },
                500
              );
            }

            return jsonResponse({
              paymentIntentId: existingIntentId,
              clientKey: existingClientKey,
              status: existingStatus,
              basePrice,
              vatAmount,
              totalPrice: grossAmount,
              amountInCentavos,
            });
          }

          // If confirmed failed or cancelled, update user_payment to record terminal state before creating fresh intent
          if (existingStatus === "failed" || existingStatus === "cancelled") {
            const { error: ledgerUpdateErr } = await adminSupabase
              .from("user_payment")
              .update({ status: existingStatus })
              .eq("paymongo_payment_id", existingIntentId)
              .eq("appointment_id", effectiveAppointmentId)
              .in("status", ["pending", "processing"]);

            if (ledgerUpdateErr) {
              console.error("[paymongo-payment] Failed to update terminal user_payment status before retry:", ledgerUpdateErr);
              await adminSupabase.rpc("release_checkout_claim", {
                p_appointment_id: effectiveAppointmentId,
                p_claim_id: claimId,
              });
              return jsonResponse(
                {
                  error: "Failed to record prior payment status before retrying checkout.",
                  code: "ERR_DB_TRACKING_FAILED",
                },
                500
              );
            }

            // Rotate idempotency key for fresh logical checkout attempt and verify persistence before calling gateway
            const freshKey = `dermai_appt_${effectiveAppointmentId}_${crypto.randomUUID().slice(0, 8)}`;
            const { data: rotatedAppt, error: rotateKeyErr } = await adminSupabase
              .from("patient_appointment")
              .update({ checkout_idempotency_key: freshKey })
              .eq("appointment_id", effectiveAppointmentId)
              .eq("checkout_claim_id", claimId)
              .select("appointment_id")
              .maybeSingle();

            if (rotateKeyErr || !rotatedAppt) {
              console.error("[paymongo-payment] Failed to persist rotated idempotency key before retry:", rotateKeyErr);
              await adminSupabase.rpc("release_checkout_claim", {
                p_appointment_id: effectiveAppointmentId,
                p_claim_id: claimId,
              });
              return jsonResponse(
                {
                  error: "Failed to persist new checkout idempotency key before creating payment intent.",
                  code: "ERR_DB_TRACKING_FAILED",
                },
                500
              );
            }

            idempotencyKey = freshKey;
          }
        } catch (verifyErr) {
          console.warn("[paymongo-payment] Network error verifying existing intent, failing closed:", verifyErr);
          await adminSupabase.rpc("release_checkout_claim", {
            p_appointment_id: effectiveAppointmentId,
            p_claim_id: claimId,
          });
          return jsonResponse(
            {
              error: "Network error verifying existing payment attempt. Please wait a moment before retrying.",
              code: "ERR_GATEWAY_UNAVAILABLE",
            },
            502
          );
        }
      }

      // SEC-02: Configure explicit bounded HTTP timeout shorter than claim lease (25s vs 60s lease)
      const INTENT_HTTP_TIMEOUT_MS = 25000;
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), INTENT_HTTP_TIMEOUT_MS);

      let response: Response;
      // deno-lint-ignore no-explicit-any
      let data: any;

      try {
        response = await fetch(`${PAYMONGO_API}/payment_intents`, {
          signal: abortController.signal,
          method: "POST",
          headers: {
            ...authHeaders,
            "Idempotency-Key": idempotencyKey,
          },
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

        data = await response.json();
      } catch (fetchErr: unknown) {
        const isAbort = (fetchErr as Error)?.name === "AbortError" || abortController.signal.aborted;
        console.warn(`[paymongo-payment] PaymentIntent creation HTTP failure (isAbort: ${isAbort}):`, fetchErr);

        // SEC-02 PAYMENT SAFETY:
        // Gateway outcome uncertain: retain 60s DB lease to prevent concurrent duplicate intent creation
        await recordAuditLog({
          userId,
          action: isAbort ? "checkout_gateway_timeout" : "checkout_gateway_network_error",
          target: `appointment:${effectiveAppointmentId}`,
          details: `PaymentIntent creation HTTP failure (isAbort: ${isAbort}). Lease retained for idempotency protection.`,
          metadata: { appointmentId: effectiveAppointmentId, claimId, idempotencyKey, isAbort, payloadHash },
        });

        return jsonResponse(
          {
            error: isAbort
              ? "Payment gateway request timed out. The transaction status is being verified. Please do not retry immediately."
              : "Network error communicating with payment gateway. Please wait a moment while we verify transaction status.",
            code: isAbort ? "ERR_GATEWAY_TIMEOUT" : "ERR_GATEWAY_NETWORK_ERROR",
            uncertain: true,
            attemptId,
          },
          504
        );
      } finally {
        clearTimeout(timeoutId);
      }

      // Handle PayMongo 409 Conflict (idempotency in progress)
      if (response.status === 409) {
        console.warn(`[paymongo-payment] Gateway reported 409 idempotency conflict for key ${idempotencyKey}`);
        return jsonResponse(
          {
            error: "A checkout request is already actively being processed by the gateway. Please wait a moment.",
            code: "ERR_IDEMPOTENCY_IN_PROGRESS",
          },
          409
        );
      }

      if (!response.ok) {
        console.error("PayMongo create booking intent error:", data);
        if (response.status === 408) {
          // HTTP 408 Request Timeout: retain 60s lease to preserve idempotency key
          await recordAuditLog({
            userId,
            action: "checkout_gateway_timeout",
            target: `appointment:${effectiveAppointmentId}`,
            details: `PayMongo request timed out (HTTP 408). Retaining lease for idempotency protection.`,
            metadata: { appointmentId: effectiveAppointmentId, claimId, status: 408, payloadHash },
          });
          return jsonResponse(
            {
              error: "Payment gateway request timed out. Status is being verified. Please wait a moment before retrying.",
              code: "ERR_GATEWAY_TIMEOUT",
              uncertain: true,
            },
            408
          );
        }

        if (response.status === 429) {
          // HTTP 429 Rate Limited: retain 60s lease to prevent rapid retries hammering the gateway
          await recordAuditLog({
            userId,
            action: "checkout_gateway_rate_limited",
            target: `appointment:${effectiveAppointmentId}`,
            details: `PayMongo rate limit reached (HTTP 429). Retaining lease for idempotency protection.`,
            metadata: { appointmentId: effectiveAppointmentId, claimId, status: 429, payloadHash },
          });
          return jsonResponse(
            {
              error: "Payment gateway rate limit reached. Please wait a moment before retrying.",
              code: "ERR_GATEWAY_RATE_LIMITED",
              uncertain: true,
            },
            429
          );
        }

        if (response.status >= 500) {
          // 5xx Gateway Server Error: outcome uncertain, retain 60s lease to preserve idempotency key
          await recordAuditLog({
            userId,
            action: "checkout_gateway_5xx",
            target: `appointment:${effectiveAppointmentId}`,
            details: `PayMongo reported internal server error (${response.status}). Retaining lease for idempotency protection.`,
            metadata: { appointmentId: effectiveAppointmentId, claimId, status: response.status, payloadHash },
          });
          return jsonResponse(
            {
              error: "Payment gateway reported internal server error. Status is being verified.",
              code: "ERR_GATEWAY_5XX",
              uncertain: true,
            },
            502
          );
        }

        // Deterministic rejection handling: release lease ONLY for verified deterministic statuses
        const deterministicRejections = [400, 401, 403, 404, 422];
        if (deterministicRejections.includes(response.status)) {
          await adminSupabase.rpc("release_checkout_claim", {
            p_appointment_id: effectiveAppointmentId,
            p_claim_id: claimId,
          });
        } else {
          // Unclassified / unknown status: retain lease fail-closed
          await recordAuditLog({
            userId,
            action: "checkout_gateway_unknown_status",
            target: `appointment:${effectiveAppointmentId}`,
            details: `PayMongo returned unclassified status (${response.status}). Retaining lease fail-closed.`,
            metadata: { appointmentId: effectiveAppointmentId, claimId, status: response.status, payloadHash },
          });
        }

        return jsonResponse(
          {
            error:
              data?.errors?.[0]?.detail ||
              "Failed to create PayMongo booking payment intent",
          },
          response.status
        );
      }

      // Mandatory Database Tracking via Atomic Commit RPC:
      // Records intent in patient_appointment AND user_payment within a single atomic database transaction.
      // Clears the checkout lease atomically, verifying claim ownership and lease boundary.
      const newIntentId = data.data.id;
      const { data: commitData, error: commitErr } = await adminSupabase.rpc("commit_checkout_intent", {
        p_appointment_id: effectiveAppointmentId,
        p_claim_id: claimId,
        p_attempt_id: attemptId,
        p_intent_id: newIntentId,
        p_method: paymentMethod,
        p_amount: grossAmount,
        p_clinic_id: clinicId,
        p_user_id: userId,
      });

      if (commitErr || !commitData?.success) {
        const isClaimLost = commitData?.code === "ERR_CLAIM_LOST";
        console.error(`[paymongo-payment] Intent tracking failed (claimLost: ${isClaimLost}):`, commitErr || commitData);

        // SEC-03: Persist orphaned intent immediately BEFORE attempting cancellation
        await adminSupabase.rpc("record_orphaned_intent", {
          p_appointment_id: effectiveAppointmentId,
          p_paymongo_payment_id: newIntentId,
          p_amount: grossAmount,
          p_claim_id: claimId,
          p_idempotency_key: idempotencyKey,
        });

        // Attempt immediate cancellation on gateway
        const cancelled = await attemptCancelPayMongoIntent(newIntentId, authHeaders);
        if (cancelled) {
          await adminSupabase.rpc("resolve_orphaned_intent", {
            p_paymongo_payment_id: newIntentId,
            p_status: "cancelled",
          });
        } else {
          await adminSupabase.rpc("resolve_orphaned_intent", {
            p_paymongo_payment_id: newIntentId,
            p_status: "failed_cancellation",
            p_cancellation_error: "Gateway refused or network unreachable during cancellation.",
          });
        }

        return jsonResponse(
          {
            error: isClaimLost
              ? "Checkout session expired or was superseded. Please try again."
              : "Failed to securely record payment reservation in database. Payment cannot proceed.",
            code: isClaimLost ? "ERR_CLAIM_LOST" : "ERR_DB_TRACKING_FAILED",
            orphanedIntentId: newIntentId,
          },
          isClaimLost ? 409 : 500
        );
      }

      return jsonResponse({
        paymentIntentId: newIntentId,
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

      let data = await response.json();

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

      // Maya (paymaya) intents can still be "processing" for a moment after the redirect
      // returns. Re-check briefly so fulfillment runs for Maya exactly like it does for GCash.
      for (let recheckAttempt = 0; recheckAttempt < 5 && data?.data?.attributes?.status === "processing"; recheckAttempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const recheckResponse = await fetch(
          `${PAYMONGO_API}/payment_intents/${paymentIntentId}?client_key=${encodeURIComponent(clientKey)}`,
          { method: "GET", headers: authHeaders }
        );
        const recheckData = await recheckResponse.json();
        if (recheckResponse.ok && recheckData?.data) {
          data = recheckData;
        }
      }


      const intentAttributes = data?.data?.attributes;

      const status = intentAttributes?.status;

      let fulfillmentResult = null;

      // When PayMongo confirms payment is succeeded, auto-fulfill DB records and dispatch receipt email!

      if (status === "succeeded") {

        // deno-lint-ignore no-explicit-any
        const payments: any[] = Array.isArray(intentAttributes?.payments) ? intentAttributes.payments : [];
        const expectedPaymentId: string | null = (typeof intentAttributes?.latest_payment_id === "string" && intentAttributes.latest_payment_id.trim())
          ? intentAttributes.latest_payment_id.trim()
          : null;

        // deno-lint-ignore no-explicit-any
        let primaryPayment: any = null;

        if (expectedPaymentId) {
          // deno-lint-ignore no-explicit-any
          const matchingPayment = payments.find((p: any) => p?.id === expectedPaymentId);
          if (!matchingPayment) {
            throw new Error(`Expected PayMongo payment ${expectedPaymentId} not found in payment intent`);
          }
          if (matchingPayment.attributes?.status !== "paid") {
            throw new Error(`PayMongo payment ${expectedPaymentId} status is not paid (${matchingPayment.attributes?.status || "unknown"})`);
          }
          primaryPayment = matchingPayment;
        } else {
          // deno-lint-ignore no-explicit-any
          const paidPayments = payments.filter((p: any) => p && p.attributes?.status === "paid");
          if (paidPayments.length === 1) {
            primaryPayment = paidPayments[0];
          } else if (paidPayments.length === 0) {
            throw new Error("No verified paid payment found on payment intent");
          } else {
            throw new Error(`Multiple paid payments (${paidPayments.length}) found without authoritative latest_payment_id`);
          }
        }

        const paymongoPaymentId: string = primaryPayment?.id;
        if (!paymongoPaymentId || typeof paymongoPaymentId !== "string" || !paymongoPaymentId.startsWith("pay_")) {
          throw new Error(`Invalid or missing PayMongo payment ID: ${paymongoPaymentId}`);
        }

        const amountInCentavos: number = primaryPayment.attributes?.amount ?? intentAttributes?.amount ?? 0;
        if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
          throw new Error(`PayMongo payment amount is missing or invalid: ${amountInCentavos}`);
        }

        if (typeof intentAttributes?.amount === "number" && intentAttributes.amount > 0) {
          if (primaryPayment.attributes?.amount !== intentAttributes.amount) {
            throw new Error(
              `Payment amount mismatch: payment has ${primaryPayment.attributes?.amount} centavos, but PaymentIntent expected ${intentAttributes.amount} centavos`
            );
          }
        }

        if (intentAttributes?.currency && primaryPayment.attributes?.currency) {
          if (primaryPayment.attributes.currency.toUpperCase() !== intentAttributes.currency.toUpperCase()) {
            throw new Error(
              `Payment currency mismatch: payment has ${primaryPayment.attributes?.currency}, but PaymentIntent expected ${intentAttributes.currency}`
            );
          }
        }

        const paymentMethodType: string =
          primaryPayment.attributes?.source?.type ||
          primaryPayment.attributes?.payment_method_details?.type ||
          intentAttributes?.metadata?.payment_method ||
          intentAttributes?.payment_method_allowed?.[0] ||
          "gcash";

        const metadata = intentAttributes?.metadata || {};

        const paidAtSeconds: number | null =
          (typeof primaryPayment.attributes?.paid_at === "number" && primaryPayment.attributes.paid_at > 0)
            ? primaryPayment.attributes.paid_at
            : (typeof intentAttributes?.paid_at === "number" && intentAttributes.paid_at > 0)
            ? intentAttributes.paid_at
            : null;

        try {

          if (!paymongoPaymentId) {

            throw new Error("PayMongo payment ID was not found on the payment intent");

          }

          if (!isServiceRoleRequest && metadata?.user_id && metadata.user_id !== user.id) {

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

              paidAtSeconds,

              expectedAmountInCentavos: intentAttributes?.amount ?? null,

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

    // ACTION: SAFE CANCEL BOOKING HOLD (Authoritative PayMongo Verification)

    // =========================================================

    if (action === "safe_cancel_booking_hold") {

      const { appointmentId, paymentIntentId, clientKey } = body;

      if (!appointmentId) {

        return jsonResponse({ error: "Missing appointment ID" }, 400);

      }

      // 1. Fetch current appointment state using service role

      const { data: appt, error: apptErr } = await adminSupabase

        .from("patient_appointment")

        .select("appointment_id, user_id, payment_status, status, payment_reference, clinic_id, payment_amount")

        .eq("appointment_id", appointmentId)

        .maybeSingle();

      if (apptErr || !appt) {

        return jsonResponse({ success: false, code: "ERR_NOT_FOUND", message: "Appointment not found." }, 404);

      }

      // Security check: must belong to verified authenticated user unless authorized via trusted service_role token

      if (!isServiceRoleRequest) {

        if (!isAuthenticatedPatient || !user?.id) {

          return jsonResponse({ success: false, code: "ERR_UNAUTHORIZED", message: "Authenticated user session required." }, 401);

        }

        if (!appt.user_id || appt.user_id !== user.id) {

          return jsonResponse({ success: false, code: "ERR_FORBIDDEN", message: "Unauthorized." }, 403);

        }

      }

      // If already paid, refuse cancellation

      if (appt.payment_status === "paid") {

        return jsonResponse({

          success: false,

          code: "ERR_ALREADY_PAID",

          alreadyPaid: true,

          message: "Appointment is already paid; hold cannot be cancelled.",

        });

      }

      // If already inactive, return idempotent success

      if (appt.payment_status === "cancelled" || appt.payment_status === "expired" || appt.status === "cancelled") {

        return jsonResponse({

          success: true,

          alreadyInactive: true,

          message: "Hold is already inactive.",

        });

      }

      // Resolve payment intent ID (stored database reference takes strict priority)

      const dbIntentId =
        typeof appt.payment_reference === "string" && appt.payment_reference.startsWith("pi_")
          ? appt.payment_reference
          : null;

      const callerIntentId =
        typeof paymentIntentId === "string" && paymentIntentId.trim().length > 0
          ? paymentIntentId.trim()
          : null;

      if (dbIntentId && callerIntentId && callerIntentId !== dbIntentId) {
        return jsonResponse(
          {
            success: false,
            code: "ERR_INTENT_MISMATCH",
            message: "Provided paymentIntentId does not match the appointment's active PaymentIntent.",
          },
          409
        );
      }

      let effectiveIntentId: string | null = dbIntentId;

      if (!effectiveIntentId && callerIntentId) {
        if (!/^pi_[A-Za-z0-9_-]{1,128}$/.test(callerIntentId)) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_INVALID_PARAMS",
              message: "Invalid PayMongo PaymentIntent ID format.",
            },
            400
          );
        }

        const { data: ledgerRows, error: ledgerErr } = await adminSupabase
          .from("user_payment")
          .select("payment_id, appointment_id, user_id, paymongo_payment_id, paymongo_payment_intent_id, status")
          .or(`paymongo_payment_id.eq.${callerIntentId},paymongo_payment_intent_id.eq.${callerIntentId}`);

        if (ledgerErr) {
          console.error("[safe_cancel_booking_hold] Failed to verify caller PaymentIntent ownership:", ledgerErr);
          return jsonResponse(
            {
              success: false,
              code: "ERR_PAYMENT_LOOKUP_FAILED",
              message: "Unable to verify PaymentIntent ownership; hold preserved.",
            },
            500
          );
        }

        const { data: orphanRow, error: orphanErr } = await adminSupabase
          .from("payment_intent_orphan")
          .select("orphan_id, appointment_id")
          .eq("paymongo_payment_id", callerIntentId)
          .maybeSingle();

        if (orphanErr && orphanErr.code !== "42P01" && orphanErr.code !== "PGRST205") {
          console.error("[safe_cancel_booking_hold] Failed checking orphaned PaymentIntent ownership:", orphanErr);
          return jsonResponse(
            {
              success: false,
              code: "ERR_PAYMENT_LOOKUP_FAILED",
              message: "Unable to verify PaymentIntent ownership; hold preserved.",
            },
            500
          );
        }

        if (orphanRow && orphanRow.appointment_id !== appointmentId) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_INTENT_OWNERSHIP_CONFLICT",
              message: "PaymentIntent belongs to another appointment.",
            },
            409
          );
        }

        if (ledgerRows && ledgerRows.some((row) => row.appointment_id !== appointmentId)) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_INTENT_OWNERSHIP_CONFLICT",
              message: "PaymentIntent belongs to another appointment.",
            },
            409
          );
        }

        const matchingForAppt = (ledgerRows || []).filter((row) => row.appointment_id === appointmentId);
        if (matchingForAppt.length === 0) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_FORBIDDEN",
              message: "PaymentIntent ownership could not be verified for this appointment.",
            },
            403
          );
        }

        if (!isServiceRoleRequest) {
          if (
            matchingForAppt.some(
              (row) => !row.user_id || row.user_id !== appt.user_id || row.user_id !== user.id
            )
          ) {
            return jsonResponse(
              {
                success: false,
                code: "ERR_FORBIDDEN",
                message: "PaymentIntent user does not match the appointment and authenticated user.",
              },
              403
            );
          }
        } else if (appt.user_id && matchingForAppt.some((row) => !row.user_id || row.user_id !== appt.user_id)) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_INTENT_OWNERSHIP_CONFLICT",
              message: "PaymentIntent user does not match the appointment owner.",
            },
            409
          );
        }

        effectiveIntentId = callerIntentId;
      }

      if (effectiveIntentId && !/^pi_[A-Za-z0-9_-]{1,128}$/.test(effectiveIntentId)) {
        return jsonResponse(
          {
            success: false,
            code: "ERR_INVALID_PARAMS",
            message: "Stored PayMongo PaymentIntent reference is malformed.",
          },
          400
        );
      }

      let gatewayVerified = false;
      let verifiedIntentId: string | null = null;
      let verifiedIntentStatus: "cancelled" | "failed" | null = null;

      if (effectiveIntentId) {

        let pmRes: Response;

        try {

          const pmUrl = clientKey

            ? `${PAYMONGO_API}/payment_intents/${effectiveIntentId}?client_key=${encodeURIComponent(clientKey)}`

            : `${PAYMONGO_API}/payment_intents/${effectiveIntentId}`;

          const controller = new AbortController();

          const timeoutId = setTimeout(() => controller.abort(), 10000);

          pmRes = await fetch(pmUrl, {

            method: "GET",

            headers: authHeaders,

            signal: controller.signal,

          });

          clearTimeout(timeoutId);

        } catch (pmCheckErr) {

          console.warn("[safe_cancel_booking_hold] PayMongo network/timeout error, preserving hold:", pmCheckErr);

          return jsonResponse({

            success: false,

            code: "ERR_PAYMENT_UNCERTAIN",

            message: "Payment status could not be verified due to gateway network error or timeout; hold preserved.",

          });

        }

        // FAIL CLOSED: Never interpret non-200 (429, 500, 502, 404) as permission to cancel hold

        if (!pmRes.ok) {

          console.warn(`[safe_cancel_booking_hold] PayMongo returned HTTP ${pmRes.status}, preserving hold.`);

          return jsonResponse({

            success: false,

            code: "ERR_PAYMENT_UNCERTAIN",

            message: `Payment gateway returned HTTP ${pmRes.status}; hold preserved.`,

          });

        }

        // deno-lint-ignore no-explicit-any
        let pmData: any;

        try {

          pmData = await pmRes.json();

        } catch (jsonErr) {

          console.warn("[safe_cancel_booking_hold] PayMongo returned malformed JSON, preserving hold:", jsonErr);

          return jsonResponse({

            success: false,

            code: "ERR_PAYMENT_UNCERTAIN",

            message: "Malformed response from payment gateway; hold preserved.",

          });

        }

        let intentStatus = pmData?.data?.attributes?.status;

        const metaApptId = pmData?.data?.attributes?.metadata?.appointment_id;
        if (metaApptId && metaApptId !== appointmentId) {
          return jsonResponse(
            {
              success: false,
              code: "ERR_INTENT_OWNERSHIP_CONFLICT",
              message: "Gateway PaymentIntent metadata does not match this appointment.",
            },
            409
          );
        }

        if (intentStatus === "succeeded") {

          console.warn(`[safe_cancel_booking_hold] Intent ${effectiveIntentId} already succeeded! Auto-fulfilling appointment ${appointmentId}.`);

          const payments = pmData?.data?.attributes?.payments || [];

          const primaryPayment = payments[0];

          const paymongoPaymentId = primaryPayment?.id || effectiveIntentId;

          const amountInCentavos = primaryPayment?.attributes?.amount ?? pmData?.data?.attributes?.amount ?? 0;

          const paymentMethodType = primaryPayment?.attributes?.source?.type || "gcash";

          const metadata = pmData?.data?.attributes?.metadata || {};

          await fulfillBookingPaymentAndSendEmail({

            paymongoPaymentId,

            paymentIntentId: effectiveIntentId,

            amountInCentavos,

            paymentMethodType,

            metadata: { ...metadata, appointment_id: appointmentId, user_id: appt.user_id },

            userAuthEmail: user.email,

          });

          return jsonResponse({

            success: false,

            code: "ERR_ALREADY_PAID",

            alreadyPaid: true,

            message: "Payment has succeeded on PayMongo. Appointment has been confirmed.",

          });

        }

        if (intentStatus === "processing" || intentStatus === "awaiting_next_action") {

          console.warn(`[safe_cancel_booking_hold] Intent ${effectiveIntentId} is ${intentStatus}; preserving hold.`);

          return jsonResponse({

            success: false,

            code: "ERR_PAYMENT_UNCERTAIN",

            message: "Payment is currently in progress; hold preserved.",

          });

        }

        if (intentStatus === "awaiting_payment_method") {
          console.log(`[safe_cancel_booking_hold] Intent ${effectiveIntentId} is awaiting_payment_method; attempting PayMongo cancellation.`);
          const cancelSuccess = await attemptCancelPayMongoIntent(effectiveIntentId, authHeaders);
          if (cancelSuccess) {
            intentStatus = "cancelled";
          } else {
            return jsonResponse({
              success: false,
              code: "ERR_PAYMENT_UNCERTAIN",
              message: "Payment cancellation could not be confirmed by gateway; hold preserved.",
            });
          }
        }

        // Conservative classification: ONLY confirmed terminal failure/cancellation may proceed

        if (intentStatus !== "cancelled" && intentStatus !== "failed") {

          console.warn(`[safe_cancel_booking_hold] Intent ${effectiveIntentId} has unrecognized status '${intentStatus}'; preserving hold.`);

          return jsonResponse({

            success: false,

            code: "ERR_PAYMENT_UNCERTAIN",

            message: `Payment status '${intentStatus}' is uncertain; hold preserved.`,

          });

        }

        // Gateway confirmed terminal failure/cancellation for this intent.
        // Pass verified intent ID + terminal status into the atomic cancellation RPC
        // so the matching ledger row is updated only if appointment cancellation succeeds.
        gatewayVerified = true;
        verifiedIntentId = effectiveIntentId;
        verifiedIntentStatus = intentStatus === "cancelled" ? "cancelled" : "failed";

      }

      // Safely cancel the hold via RPC (atomically updates appointment, checkout state, and matching ledger row)
      const { data: cancelRes, error: cancelErr } = await adminSupabase.rpc("cancel_appointment_hold", {
        p_appointment_id: appointmentId,
        p_gateway_verified: gatewayVerified,
        p_verified_intent_id: verifiedIntentId,
        p_verified_intent_status: verifiedIntentStatus,
      });

      if (cancelErr || !cancelRes?.success) {

        return jsonResponse({

          success: false,

          code: cancelRes?.code || cancelErr?.code || "ERR_CANCEL_FAILED",

          message: cancelRes?.message || cancelErr?.message || "Failed to cancel hold.",

        });

      }

      return jsonResponse({

        success: true,

        message: "Hold successfully cancelled.",

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

      // deno-lint-ignore no-explicit-any
      const payments: any[] = Array.isArray(intentAttributes?.payments) ? intentAttributes.payments : [];
      const expectedPaymentId: string | null = (typeof intentAttributes?.latest_payment_id === "string" && intentAttributes.latest_payment_id.trim())
        ? intentAttributes.latest_payment_id.trim()
        : null;

      // deno-lint-ignore no-explicit-any
      let primaryPayment: any = null;

      if (expectedPaymentId) {
        // deno-lint-ignore no-explicit-any
        const matchingPayment = payments.find((p: any) => p?.id === expectedPaymentId);
        if (!matchingPayment) {
          throw new Error(`Expected PayMongo payment ${expectedPaymentId} not found in payment intent`);
        }
        if (matchingPayment.attributes?.status !== "paid") {
          throw new Error(`PayMongo payment ${expectedPaymentId} status is not paid (${matchingPayment.attributes?.status || "unknown"})`);
        }
        primaryPayment = matchingPayment;
      } else {
        // deno-lint-ignore no-explicit-any
        const paidPayments = payments.filter((p: any) => p && p.attributes?.status === "paid");
        if (paidPayments.length === 1) {
          primaryPayment = paidPayments[0];
        } else if (paidPayments.length === 0) {
          throw new Error("No verified paid payment found on payment intent");
        } else {
          throw new Error(`Multiple paid payments (${paidPayments.length}) found without authoritative latest_payment_id`);
        }
      }

      const paymongoPaymentId: string = primaryPayment?.id;
      if (!paymongoPaymentId || typeof paymongoPaymentId !== "string" || !paymongoPaymentId.startsWith("pay_")) {
        throw new Error(`Invalid or missing PayMongo payment ID: ${paymongoPaymentId}`);
      }

      const amountInCentavos: number = primaryPayment.attributes?.amount ?? intentAttributes?.amount ?? 0;
      if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
        throw new Error(`PayMongo payment amount is missing or invalid: ${amountInCentavos}`);
      }

      if (typeof intentAttributes?.amount === "number" && intentAttributes.amount > 0) {
        if (primaryPayment.attributes?.amount !== intentAttributes.amount) {
          throw new Error(
            `Payment amount mismatch: payment has ${primaryPayment.attributes?.amount} centavos, but PaymentIntent expected ${intentAttributes.amount} centavos`
          );
        }
      }

      if (intentAttributes?.currency && primaryPayment.attributes?.currency) {
        if (primaryPayment.attributes.currency.toUpperCase() !== intentAttributes.currency.toUpperCase()) {
          throw new Error(
            `Payment currency mismatch: payment has ${primaryPayment.attributes?.currency}, but PaymentIntent expected ${intentAttributes.currency}`
          );
        }
      }

      const paymentMethodType: string =
        primaryPayment.attributes?.source?.type ||
        primaryPayment.attributes?.payment_method_details?.type ||
        intentAttributes?.metadata?.payment_method ||
        intentAttributes?.payment_method_allowed?.[0] ||
        "gcash";

      const metadata = intentAttributes?.metadata || {};

      const paidAtSeconds: number | null =
        (typeof primaryPayment.attributes?.paid_at === "number" && primaryPayment.attributes.paid_at > 0)
          ? primaryPayment.attributes.paid_at
          : (typeof intentAttributes?.paid_at === "number" && intentAttributes.paid_at > 0)
          ? intentAttributes.paid_at
          : null;

      if (!isServiceRoleRequest && metadata?.user_id && metadata.user_id !== user.id) {

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

            paidAtSeconds,

            expectedAmountInCentavos: intentAttributes?.amount ?? null,

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

      if (!isServiceRoleRequest) {

        return jsonResponse(

          {

            error: "Forbidden: fulfill_payment requires service_role authorization.",

            code: "ERR_FORBIDDEN",

          },

          403

        );

      }

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

            userAuthEmail: userAuthEmail || (typeof body.userEmail === "string" ? body.userEmail : null) || user.email,

          })

        : await fulfillPaymentAndSendEmail({

            paymongoPaymentId,

            paymentIntentId: paymentIntentId || null,

            amountInCentavos: Number(amountInCentavos) || 19900,

            paymentMethodType: paymentMethodType || "gcash",

            metadata: metadata || {},

            userAuthEmail: userAuthEmail || (typeof body.userEmail === "string" ? body.userEmail : null) || user.email,

            paidAtSeconds: body?.paidAtSeconds ?? body?.paid_at ?? null,

            expectedAmountInCentavos: body?.expectedAmountInCentavos ?? null,

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
