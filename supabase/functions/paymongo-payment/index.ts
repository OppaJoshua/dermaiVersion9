import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYMONGO_API = "https://api.paymongo.com/v1";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
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

serve(async (req: Request) => {
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

const authHeader = req.headers.get("Authorization");

if (!authHeader) {
  return jsonResponse(
    { error: "Missing Authorization header" },
    401
  );
}

const token = authHeader.replace("Bearer ", "");

const {
  data: { user },
  error: userError,
} = await supabase.auth.getUser(token);

if (userError || !user) {
  return jsonResponse(
    { error: "Invalid or expired authentication token" },
    401
  );
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
        description,
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
      // Free-plan rows do not block a new Pro purchase.
      const { data: existingSubscription, error: subscriptionError } = await supabase
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
      const { data: plan, error: planError } = await supabase
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

      const basePrice = Number(plan.price);

      const totalAmount = Math.round(basePrice * 100) / 100;

      const amountInCentavos = Math.round(totalAmount * 100);

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
                  payment_email: email,
                  billing_address: address,
                  payment_mobile_number: mobileNumber,
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
    // ACTION 3: VERIFY PAYMENT INTENT
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

      return jsonResponse({
        paymentIntentId: data.data.id,
        status: data.data.attributes.status,
        attributes: data.data.attributes,
      });
    }

    return jsonResponse(
      {
        error:
          "Invalid action. Use create_intent, attach_payment_method, or verify_payment_intent.",
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










