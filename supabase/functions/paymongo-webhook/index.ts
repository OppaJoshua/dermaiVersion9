import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendReceiptEmail } from "./emailReceipt.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const supabaseServiceRoleKey = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY"
)!;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
);

const webhookSecret = Deno.env.get(
  "PAYMONGO_WEBHOOK_SECRET"
);

if (!webhookSecret) {
  throw new Error(
    "PAYMONGO_WEBHOOK_SECRET is not configured"
  );
}

const paymongoSecretKey = Deno.env.get(
  "PAYMONGO_SECRET_KEY"
);

if (!paymongoSecretKey) {
  throw new Error(
    "PAYMONGO_SECRET_KEY is not configured"
  );
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405
    );
  }

  console.log("[webhook] PayMongo request received", {
  method: req.method,
  hasSignature: !!req.headers.get("Paymongo-Signature"),
});

  let eventId: string | undefined;

  try {
    const signature = req.headers.get("Paymongo-Signature");

if (!signature) {
  return jsonResponse(
    { error: "Missing Paymongo-Signature header" },
    401
  );
}

const rawBody = await req.text();

const parts = signature.split(",");

console.log(
  "[webhook] Signature parts:",
  parts.map((part) => part.split("=")[0])
);

const timestampPart = parts.find((part) =>
  part.startsWith("t=")
);

const testSignaturePart = parts.find((part) =>
  part.startsWith("te=")
);

if (!timestampPart || !testSignaturePart) {
  return jsonResponse(
    { error: "Invalid PayMongo signature format" },
    401
  );
}

const timestamp = timestampPart.substring(2);
const receivedSignature = testSignaturePart.substring(3);

console.log("[webhook] Signature timestamp:", timestamp);
console.log("[webhook] Current time:", Math.floor(Date.now() / 1000));

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

const calculatedSignature = Array.from(
  new Uint8Array(signatureBuffer)
)
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

console.log("[webhook] Signature lengths:", {
calculated: calculatedSignature.length,
received: receivedSignature.length,
});

if (calculatedSignature !== receivedSignature) {
  return jsonResponse(
    { error: "Invalid PayMongo webhook signature" },
    401
  );
}

console.log("[webhook] Signature verification passed");

    console.log(
      "Received PayMongo webhook request."
    );

    console.log(
      "Signature header present:",
      !!signature
    );

  const event = JSON.parse(rawBody);

console.log(
  "Received PayMongo webhook event:",
  event?.data?.attributes?.type
);

if (event?.data?.attributes?.type !== "payment.paid") {
  return jsonResponse({
    received: true,
    message: "Event ignored.",
    eventType: event?.data?.attributes?.type || "unknown",
  });
}

eventId = event?.data?.id;

if (!eventId) {
  return jsonResponse(
    { error: "Missing PayMongo event ID" },
    400
  );
}

console.log(
  "PayMongo event ID:",
  eventId
);

const { data: existingEvent, error: existingEventError } =
  await supabase
    .from("paymongo_webhook_event")
    .select("event_id, status")
    .eq("event_id", eventId)
    .maybeSingle();

if (existingEventError) {
  console.error(
    "Webhook event lookup error:",
    existingEventError
  );

  throw new Error(
    "Failed to check webhook event"
  );
}

if (existingEvent?.status === "processed") {
  console.log(
    "Webhook event already processed:",
    eventId
  );

  return jsonResponse({
    received: true,
    message: "Webhook event already processed.",
    eventId,
  });
}

if (existingEvent) {
  console.log(
    "Retrying previously received webhook event:",
    {
      eventId,
      status: existingEvent.status,
    }
  );
}

if (!existingEvent) {
  const { error: insertEventError } =
    await supabase
      .from("paymongo_webhook_event")
      .insert({
        event_id: eventId,
        event_type: "payment.paid",
        status: "received",
        payload: event,
      });

  if (insertEventError) {
    console.error(
      "Webhook event insert error:",
      insertEventError
    );

    throw new Error(
      "Failed to record webhook event"
    );
  }

  console.log(
    "Webhook event recorded:",
    eventId
  );
}

const paymentData =
  event?.data?.attributes?.data;

if (!paymentData?.id) {
  throw new Error(
    "Missing PayMongo Payment ID in webhook event"
  );
}

const paymongoPaymentId =
  paymentData.id;

console.log(
  "[webhook] Payment resource received:",
  paymongoPaymentId
);

const paymentResource = paymentData;
const paymentAttributes = paymentData?.attributes;

if (!paymentAttributes) {
  throw new Error(
    "PayMongo webhook payment data is missing attributes"
  );
}

console.log(
  "[webhook] Payment resource structure:",
  {
    paymentId: paymentResource?.id ?? null,
    paymentType: paymentResource?.type ?? null,
    paymentStatus:
      paymentAttributes?.status ?? null,
    attributeKeys:
      Object.keys(paymentAttributes),
    relationshipKeys:
      paymentResource?.relationships
        ? Object.keys(paymentResource.relationships)
        : [],
    paymentIntentRelationship:
      paymentResource?.relationships?.payment_intent
        ? Object.keys(
            paymentResource.relationships.payment_intent
          )
        : [],
    paymentIntentRelationshipData:
      paymentResource?.relationships?.payment_intent?.data
        ? {
            id:
              paymentResource.relationships
                .payment_intent.data.id ?? null,
            type:
              paymentResource.relationships
                .payment_intent.data.type ?? null,
          }
        : null,
  }
);

const paymentStatus =
  paymentAttributes?.status;

if (paymentStatus !== "paid") {
  throw new Error(
    `PayMongo payment is not paid: ${
      paymentStatus || "unknown"
    }`
  );
}

console.log(
  "PayMongo payment confirmed as paid."
);

let paymentIntentId =
  paymentAttributes?.payment_intent_id ??
  paymentResource?.relationships?.payment_intent?.data?.id ??
  null;

let metadata =
  paymentAttributes?.metadata ?? {};

console.log(
  "[webhook] Payment resource metadata:",
  {
    hasUserId: !!metadata?.user_id,
    hasPlanId: !!metadata?.plan_id,
    hasBillingCycle: !!metadata?.billing_cycle,
    paymentIntentId,
  }
);

if (
  !metadata?.user_id ||
  !metadata?.plan_id ||
  !metadata?.billing_cycle
) {

  const eventMetadata =
    paymentData?.attributes?.metadata ??
    {};

  if (
    eventMetadata?.user_id &&
    eventMetadata?.plan_id &&
    eventMetadata?.billing_cycle
  ) {
    metadata = eventMetadata;

    console.log(
      "[webhook] Using metadata from webhook payment data."
    );
  }
}

if (
  (!metadata?.user_id ||
    !metadata?.plan_id ||
    !metadata?.billing_cycle) &&
  paymentIntentId
) {

  const paymentIntentResponse =
    await fetch(
      `${PAYMONGO_API}/payment_intents/${paymentIntentId}`,
      {
        method: "GET",
        headers: {
          Authorization:
            "Basic " +
            btoa(paymongoSecretKey + ":"),
          "Content-Type": "application/json",
        },
      }
    );

  const paymentIntentJson =
    await paymentIntentResponse.json();

  if (!paymentIntentResponse.ok) {
    console.error(
      "PayMongo Payment Intent lookup error:",
      paymentIntentJson
    );

    throw new Error(
      paymentIntentJson?.errors?.[0]?.detail ||
        "Failed to retrieve PayMongo Payment Intent"
    );
  }

  const paymentIntentResource =
    paymentIntentJson?.data;

  const paymentIntentAttributes =
    paymentIntentResource?.attributes;

  if (paymentIntentAttributes?.metadata) {
    metadata =
      paymentIntentAttributes.metadata;

    console.log(
      "[webhook] Metadata retrieved from Payment Intent."
    );
  }
}

if (!metadata?.user_id) {
  throw new Error(
    "Payment metadata is missing user_id"
  );
}

if (!metadata?.plan_id) {
  throw new Error(
    "Payment metadata is missing plan_id"
  );
}

if (
  metadata?.billing_cycle !== "monthly" &&
  metadata?.billing_cycle !== "yearly"
) {
  throw new Error(
    "Payment metadata has an invalid billing_cycle"
  );
}

console.log(
  "Payment metadata:",
  {
    user_id: metadata.user_id,
    plan_id: metadata.plan_id,
    billing_cycle:
      metadata.billing_cycle,
  }
);

const payment =
  paymentResource;

const amountInCentavos =
  payment?.attributes?.amount;
if (!paymongoPaymentId) {
  throw new Error(
    "PayMongo payment ID is missing"
  );
}

if (
  typeof amountInCentavos !== "number" ||
  amountInCentavos <= 0
) {
  throw new Error(
    "PayMongo payment amount is missing or invalid"
  );
}

const amount = amountInCentavos / 100;

console.log(
  "PayMongo payment details:",
  {
    paymentId: paymongoPaymentId,
    amount,
  }
);

const paymentMethodType =
  payment?.attributes?.source?.type ||
  payment?.attributes?.payment_method_details?.type ||
  "unknown";

console.log(
  "PayMongo payment method:",
  paymentMethodType
);

const { data: existingPayment, error: existingPaymentError } =
  await supabase
    .from("user_payment")
    .select("payment_id")
    .eq("paymongo_payment_id", paymongoPaymentId)
    .maybeSingle();

if (existingPaymentError) {
  console.error(
    "user_payment lookup error:",
    existingPaymentError
  );

  throw new Error(
    "Failed to check existing payment"
  );
}

if (!existingPayment) {
  const { error: paymentInsertError } =
    await supabase
      .from("user_payment")
      .insert({
        amount,
        payment_date: new Date().toISOString(),
        method: paymentMethodType,
        status: "success",
        user_id: metadata.user_id,
        plan_id: metadata.plan_id,
        billing_cycle: metadata.billing_cycle,
        reference_number: paymongoPaymentId,
        paymongo_payment_id: paymongoPaymentId,
        paymongo_payment_intent_id: paymentIntentId,
      });

  if (paymentInsertError) {
    console.error(
      "user_payment insert error:",
      paymentInsertError
    );

    throw new Error(
      "Failed to record successful payment"
    );
  }

  console.log(
    "Successful payment recorded in user_payment:",
    paymongoPaymentId
  );
} else {
  console.log(
    "Payment already exists in user_payment:",
    paymongoPaymentId
  );
}

const periodStart = new Date();
const periodEnd = new Date(periodStart);

if (metadata.billing_cycle === "yearly") {
  periodEnd.setFullYear(
    periodEnd.getFullYear() + 1
  );
} else {
  periodEnd.setMonth(
    periodEnd.getMonth() + 1
  );
}

console.log(
  "Subscription period:",
  {
    start: periodStart.toISOString(),
    end: periodEnd.toISOString(),
    billing_cycle: metadata.billing_cycle,
  }
);

const { error: subscriptionUpsertError } =
  await supabase
    .from("user_plan_subscription")
    .upsert(
      {
        user_id: metadata.user_id,
        plan_id: metadata.plan_id,
        status: "active",
        billing_cycle: metadata.billing_cycle,
        started_at: periodStart.toISOString(),
        renews_at: periodEnd.toISOString(),
        current_period_start:
          periodStart.toISOString(),
        current_period_end:
          periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id",
      }
    );

if (subscriptionUpsertError) {
  console.error(
    "user_plan_subscription upsert error:",
    subscriptionUpsertError
  );

  throw new Error(
    "Failed to activate subscription"
  );
}

console.log(
  "Subscription activated successfully:",
  {
    user_id: metadata.user_id,
    plan_id: metadata.plan_id,
    billing_cycle: metadata.billing_cycle,
  }
);

// Send payment receipt email
try {
  const {
    data: authUser,
    error: authUserError,
  } = await supabase.auth.admin.getUserById(
    metadata.user_id
  );

  if (authUserError) {
    throw new Error(
      `Failed to get patient email: ${authUserError.message}`
    );
  }

  const patientEmail = authUser.user?.email;

  if (!patientEmail) {
    throw new Error(
      "Patient email address was not found"
    );
  }

  const paymentMethodLabel =
    paymentMethodType === "paymaya"
      ? "Maya"
      : paymentMethodType === "gcash"
      ? "GCash"
      : paymentMethodType;

  await sendReceiptEmail({
    patientEmail,
    paymentMethod: paymentMethodLabel,
    amount,
    paymentDate: new Date().toISOString(),
    paymongoPaymentId,
  });

  console.log(
    "[Webhook] Receipt email sent successfully."
  );
} catch (emailError) {
  console.error(
   "[Webhook] Receipt email failed, but payment remains successful:",
    emailError instanceof Error
      ? emailError.message
      : JSON.stringify(emailError)
  );
}

const { error: processedEventError } =
  await supabase
    .from("paymongo_webhook_event")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);

if (processedEventError) {
  console.error(
    "Failed to mark webhook event as processed:",
    processedEventError
  );

  throw new Error(
    "Failed to mark webhook event as processed"
  );
}

console.log(
  "Webhook event marked as processed:",
  eventId
);

return jsonResponse({
  received: true,
  message: "Payment and subscription processed successfully.",
  eventId,
  paymentIntentId,
  paymongoPaymentId,
});

} catch (error) {
  console.error(
    "Webhook error:",
    error
  );

  const errorMessage =
    error instanceof Error
      ? error.message
      : "Unexpected server error";

  if (typeof eventId === "string" && eventId) {
    const { error: failedEventError } =
      await supabase
        .from("paymongo_webhook_event")
        .update({
          status: "failed",
          error_message: errorMessage,
        })
        .eq("event_id", eventId);

    if (failedEventError) {
      console.error(
        "Failed to mark webhook event as failed:",
        failedEventError
      );
    } else {
      console.log(
        "Webhook event marked as failed:",
        eventId
      );
    }
  }

  return jsonResponse(
    {
      error: errorMessage,
    },
    500
  );
}
});







