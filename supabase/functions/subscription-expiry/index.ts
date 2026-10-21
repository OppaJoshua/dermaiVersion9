import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type SubscriptionRow = {
  subscription_id: string;
  user_id: string;
  current_period_end: string;
  plan_id: string;
};

type DeliveryCandidateRow = {
  subscription_id: string;
  user_id: string;
  period_end: string;
};

const SUBSCRIPTION_EXPIRY_PAGE_SIZE = 500;

type PlanInfo = { name: string | null; price: number | string | null };

type SubscriptionQueryRow = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  current_period_end: string;
  status?: string;
  plan: PlanInfo | PlanInfo[] | null;
};

function isPaidPlan(row: SubscriptionQueryRow): boolean {
  const plan = Array.isArray(row.plan) ? row.plan[0] : row.plan;
  const price = Number(plan?.price ?? 0);
  const name = typeof plan?.name === "string" ? plan.name.toLowerCase() : "";
  return price > 0 || name === "pro";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<{
  data: T[];
  error: { message: string } | null;
  pageCount: number;
}> {
  const allRows: T[] = [];
  let pageCount = 0;

  for (let from = 0; ; from += SUBSCRIPTION_EXPIRY_PAGE_SIZE) {
    const { data, error } = await fetchPage(
      from,
      from + SUBSCRIPTION_EXPIRY_PAGE_SIZE - 1,
    );
    pageCount++;

    if (error) {
      return { data: allRows, error, pageCount };
    }

    const pageRows = data ?? [];
    allRows.push(...pageRows);

    if (pageRows.length < SUBSCRIPTION_EXPIRY_PAGE_SIZE) {
      return { data: allRows, error: null, pageCount };
    }
  }
}

// ---------------------------------------------------------------------------
// Email templates for Post-Expiration Notification
// ---------------------------------------------------------------------------
function renderExpiryEmailHtml(opts: {
  periodLabel: string;
  upgradeUrl?: string;
}): string {
  const pink = "#A21D5C";
  const pinkDark = "#7E1448";
  const pinkSoft = "#FDF2F7";
  const pinkBorder = "#F4C9DC";

  const periodLabel = escapeHtml(opts.periodLabel);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your DermAI Pro Subscription Has Expired</title>
</head>
<body style="margin:0;padding:0;background:${pinkSoft};font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#3b2a33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pinkSoft};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${pinkBorder};">

          <!-- Header -->
          <tr>
            <td align="center" style="background:${pink};background-image:linear-gradient(135deg,${pink},${pinkDark});padding:36px 24px 32px;">
              <div style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">DermAI</div>
              <div style="font-size:12px;color:#F8D4E4;letter-spacing:2px;text-transform:uppercase;margin-top:6px;">AI-Powered Skin Care</div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding:36px 32px 8px;">
              <div style="display:inline-block;background:${pinkSoft};color:${pink};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:999px;border:1px solid ${pinkBorder};">
                Subscription Update
              </div>
              <h1 style="margin:18px 0 0;font-size:24px;line-height:1.3;color:${pinkDark};">
                Your Pro subscription has expired
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 8px;font-size:15px;line-height:1.7;color:#4a3640;">
              <p style="margin:0 0 14px;">Hello,</p>
              <p style="margin:0 0 14px;">
                Your DermAI Pro subscription expired on <strong>${periodLabel}</strong>, and your account has returned to the <strong style="color:${pink};">Free Plan</strong>.
              </p>
              <p style="margin:0 0 14px;">
                You can continue using DermAI with standard free scans and basic features. Your previous scan history and account data remain completely safe and accessible.
              </p>
            </td>
          </tr>

          <!-- Highlight box -->
          <tr>
            <td style="padding:8px 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pinkSoft};border-left:4px solid ${pink};border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;font-size:14px;line-height:1.6;color:#4a3640;">
                    To restore unlimited scans, priority clinic booking, and full condition tracking, you can upgrade to Pro at any time.
                  </td>
                </tr>
              </table>
            </td>
          </tr>


          <!-- Sign-off -->
          <tr>
            <td style="padding:0 40px 32px;font-size:15px;line-height:1.7;color:#4a3640;">
              <p style="margin:0 0 14px;">Thank you for using DermAI.</p>
              <p style="margin:0;">Best regards,<br /><strong style="color:${pinkDark};">The DermAI Team</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background:${pinkSoft};border-top:1px solid ${pinkBorder};padding:20px 24px;font-size:12px;color:#8a6b79;line-height:1.6;">
              This is an automated message from DermAI. Please do not reply to this email.<br />
              &copy; ${new Date().getFullYear()} DermAI. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderExpiryEmailText(opts: {
  periodLabel: string;
  upgradeUrl?: string;
}): string {
  return [
    "Hello,",
    "",
    `Your DermAI Pro subscription expired on ${opts.periodLabel}, and your account is now using the Free Plan.`,
    "",
    "You can continue using DermAI with standard free scans and basic features. Your scan records remain saved in your account.",
    "",
    "Thank you for using DermAI.",
    "",
    "Best regards,",
    "The DermAI Team",
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": "*",
      },
    });

  console.info("[subscription-expiry] Request received", {
    method: req.method,
    at: new Date().toISOString(),
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("SUBSCRIPTION_EXPIRY_CRON_SECRET");
  const suppliedSecret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization") || "";

  if (expectedSecret && suppliedSecret !== expectedSecret && !authHeader.includes("Bearer ")) {
    console.warn("[subscription-expiry] Authentication rejected", {
      expectedSecretConfigured: Boolean(expectedSecret),
      suppliedSecretPresent: Boolean(suppliedSecret),
    });
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[subscription-expiry] Supabase configuration missing", {
      urlConfigured: Boolean(supabaseUrl),
      serviceRoleKeyConfigured: Boolean(serviceRoleKey),
    });
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  let body: { mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Default to preview mode if empty
  }

  const processingEnabled =
    Deno.env.get("SUBSCRIPTION_EXPIRY_PROCESSING_ENABLED") === "true";
  const cutoffValue = Deno.env.get("SUBSCRIPTION_EXPIRY_START_AT");
  const cutoff = cutoffValue ? Date.parse(cutoffValue) : NaN;

  // process mode requires explicit mode=process and processingEnabled
  const processMode =
    body.mode === "process" &&
    processingEnabled &&
    (isNaN(cutoff) || Number.isFinite(cutoff));

  console.info("[subscription-expiry] Mode evaluated", {
    requestedMode: body.mode ?? "preview",
    processingEnabled,
    cutoffConfigured: Number.isFinite(cutoff),
    processMode,
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const nowIso = now.toISOString();

  // ---------------------------------------------------------------------------
  // 1. Find subscriptions where current_period_end <= NOW() and status is active
  //    or pending downgrade (not yet marked expired).
  // ---------------------------------------------------------------------------
  const { data, error, pageCount } = await fetchAllPages((from, to) =>
    supabase
      .from("user_plan_subscription")
      .select(
        "subscription_id, user_id, plan_id, current_period_end, status, plan:plan_id(name, price)",
      )
      .in("status", ["active", "pending_downgrade", "cancelling"])
      .not("current_period_end", "is", null)
      .lte("current_period_end", nowIso)
      .order("current_period_end", { ascending: true })
      .order("subscription_id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    console.error("[subscription-expiry] Query failed:", error.message);
    return json({ error: "Could not inspect expired subscriptions" }, 500);
  }

  const expiredCandidates = ((data ?? []) as unknown as SubscriptionQueryRow[])
    .filter(isPaidPlan)
    .map((row) => ({
      subscription_id: row.subscription_id,
      user_id: row.user_id,
      current_period_end: row.current_period_end,
      plan_id: row.plan_id,
    })) as SubscriptionRow[];

  console.info("[subscription-expiry] Expired candidates found", {
    totalQueried: (data ?? []).length,
    paidExpiredCount: expiredCandidates.length,
    pageCount,
  });

  const eligible: SubscriptionRow[] = processMode
    ? expiredCandidates.filter(
        (row) => isNaN(cutoff) || Date.parse(row.current_period_end) > cutoff,
      )
    : [];

  // Preview Mode
  if (!processMode) {
    console.info("[subscription-expiry] Preview mode; no processing actions will run", {
      expiredCount: expiredCandidates.length,
      processingEnabled,
      cutoffConfigured: Number.isFinite(cutoff),
    });
    return json({
      mode: "preview_only",
      processingEnabled,
      cutoffConfigured: Number.isFinite(cutoff),
      checkedAt: nowIso,
      expiredCount: expiredCandidates.length,
      excludedBeforeCutoff: Number.isFinite(cutoff)
        ? expiredCandidates.filter(
            (row) => Date.parse(row.current_period_end) <= cutoff,
          ).length
        : 0,
      subscriptions: expiredCandidates.map((row) => ({
        subscriptionId: row.subscription_id,
        periodEnd: row.current_period_end,
      })),
      actionsTaken: {
        subscriptionUpdates: 0,
        notificationsCreated: 0,
        emailsSent: 0,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Recover retryable deliveries and missing deliveries
  // ---------------------------------------------------------------------------
  const cutoffIso = Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : new Date(0).toISOString();
  const { data: retryableDeliveries, error: retryableDeliveryError } =
    await fetchAllPages<DeliveryCandidateRow>((from, to) =>
      supabase
        .from("subscription_expiry_delivery")
        .select("subscription_id, period_end, user_id")
        .in("email_status", ["pending", "failed"])
        .gt("period_end", cutoffIso)
        .lte("period_end", nowIso)
        .order("period_end", { ascending: true })
        .order("subscription_id", { ascending: true })
        .range(from, to),
    );

  if (retryableDeliveryError) {
    console.warn(
      "[subscription-expiry] Retryable delivery lookup warning:",
      retryableDeliveryError.message,
    );
  }

  const eligibleKeys = new Set(
    eligible.map(
      (row) => `${row.subscription_id}:${new Date(row.current_period_end).toISOString()}`,
    ),
  );

  for (const delivery of retryableDeliveries ?? []) {
    const periodEndIso = new Date(delivery.period_end).toISOString();
    const key = `${delivery.subscription_id}:${periodEndIso}`;
    if (eligibleKeys.has(key)) continue;

    eligible.push({
      subscription_id: delivery.subscription_id,
      user_id: delivery.user_id,
      current_period_end: delivery.period_end,
      plan_id: "",
    });
    eligibleKeys.add(key);
  }

  // ---------------------------------------------------------------------------
  // 3. Setup SMTP and Web App URLs
  // ---------------------------------------------------------------------------
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPassword = Deno.env.get("SMTP_PASSWORD");

  if (!smtpHost || !smtpUser || !smtpPassword || !Number.isFinite(smtpPort)) {
    console.error("[subscription-expiry] SMTP configuration is incomplete", {
      hostConfigured: Boolean(smtpHost),
      portValid: Number.isFinite(smtpPort),
      userConfigured: Boolean(smtpUser),
      passwordConfigured: Boolean(smtpPassword),
    });
    return json({ error: "SMTP configuration is incomplete" }, 500);
  }

  const appBaseUrl = (Deno.env.get("APP_BASE_URL") || "http://localhost:5173").replace(/\/+$/, "");
  const upgradeUrl = `${appBaseUrl}/dashboard/upgrade`;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPassword },
  });

  let subscriptionUpdates = 0;
  let notificationsCreated = 0;
  let emailsSent = 0;
  let skipped = 0;
  const failures: string[] = [];

  // Helper to claim a delivery record safely
  async function claimDelivery(
    subscriptionId: string,
    periodEnd: string,
    userId: string,
  ): Promise<boolean> {
    // 1. Try RPC if available
    try {
      const { data: rpcClaimed, error: rpcError } = await supabase.rpc(
        "claim_subscription_expiry_delivery",
        {
          p_subscription_id: subscriptionId,
          p_period_end: periodEnd,
          p_user_id: userId,
        },
      );
      if (!rpcError && typeof rpcClaimed === "boolean") {
        return rpcClaimed;
      }
    } catch {
      // Fallback to table upsert if RPC is absent
    }

    // 2. Direct upsert fallback
    const { data: inserted, error: insertError } = await supabase
      .from("subscription_expiry_delivery")
      .upsert(
        {
          subscription_id: subscriptionId,
          period_end: periodEnd,
          user_id: userId,
          email_status: "sending",
          notification_created: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "subscription_id,period_end", ignoreDuplicates: true },
      )
      .select("subscription_id");

    if (insertError) {
      console.warn("[subscription-expiry] Fallback claim upsert error:", insertError.message);
      return false;
    }
    if (inserted && inserted.length > 0) return true;

    // Retry reclaim if previous status was pending or failed
    const { data: reclaimed, error: reclaimError } = await supabase
      .from("subscription_expiry_delivery")
      .update({
        email_status: "sending",
        updated_at: new Date().toISOString(),
      })
      .eq("subscription_id", subscriptionId)
      .eq("period_end", periodEnd)
      .in("email_status", ["pending", "failed"])
      .select("subscription_id");

    if (reclaimError) return false;
    return (reclaimed?.length ?? 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // 4. Process eligible expired subscriptions
  // ---------------------------------------------------------------------------
  for (const row of eligible) {
    const periodEnd = new Date(row.current_period_end).toISOString();
    let claimed = false;
    let sendAttempted = false;
    let stage = "claim";

    console.info("[subscription-expiry] Processing expired subscription", {
      subscriptionId: row.subscription_id,
      periodEnd,
    });

    try {
      claimed = await claimDelivery(row.subscription_id, periodEnd, row.user_id);
      if (!claimed) {
        console.info("[subscription-expiry] Skipping subscription; claim not acquired", {
          subscriptionId: row.subscription_id,
        });
        skipped++;
        continue;
      }

      // Check delivery record state
      stage = "delivery_lookup";
      const { data: delivery } = await supabase
        .from("subscription_expiry_delivery")
        .select("notification_created")
        .eq("subscription_id", row.subscription_id)
        .eq("period_end", periodEnd)
        .maybeSingle();

      // Look up patient email
      stage = "patient_lookup";
      const { data: patient, error: patientError } = await supabase
        .from("user")
        .select("email")
        .eq("user_id", row.user_id)
        .single();

      if (patientError || !patient?.email) {
        throw patientError ?? new Error("Patient email not found");
      }

      const periodLabel = new Date(periodEnd).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      });

      const notificationBody =
        `Your DermAI Pro subscription expired on ${periodLabel}. ` +
        "Your account is now using the Free Plan. You can re-subscribe to Pro " +
        "again at any time to regain access to Pro features.";

      // 4A. In-app notification
      stage = "notification";
      if (!delivery?.notification_created) {
        const { data: existingNotification } = await supabase
          .from("user_notification")
          .select("notif_id")
          .eq("user_id", row.user_id)
          .eq("subtype", "subscription_expired")
          .eq("body", notificationBody)
          .limit(1)
          .maybeSingle();

        if (!existingNotification) {
          const { error: notificationError } = await supabase
            .from("user_notification")
            .insert({
              user_id: row.user_id,
              type: "system",
              subtype: "subscription_expired",
              title: "Your Pro Subscription Has Expired",
              body: notificationBody,
            });

          if (notificationError) throw notificationError;
          notificationsCreated++;
        }

        await supabase
          .from("subscription_expiry_delivery")
          .update({
            notification_created: true,
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", row.subscription_id)
          .eq("period_end", periodEnd);
      }

      // 4B. Update subscription status to 'expired'
      stage = "subscription_update";
      const { data: updatedSub, error: updateSubError } = await supabase
        .from("user_plan_subscription")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("subscription_id", row.subscription_id)
        .neq("status", "expired")
        .select("subscription_id");

      if (updateSubError) throw updateSubError;
      if (updatedSub && updatedSub.length > 0) {
        subscriptionUpdates++;
      }

      // 4C. Send Post-Expiration Email
      stage = "email_send";
      await supabase
        .from("subscription_expiry_delivery")
        .update({
          last_error: "SMTP_ATTEMPT_STARTED",
          updated_at: new Date().toISOString(),
        })
        .eq("subscription_id", row.subscription_id)
        .eq("period_end", periodEnd);

      sendAttempted = true;
      const emailOpts = { periodLabel, upgradeUrl };

      await transporter.sendMail({
        from: `"DermAI" <${smtpUser}>`,
        to: patient.email,
        subject: "Your DermAI Pro Subscription Has Expired",
        text: renderExpiryEmailText(emailOpts),
        html: renderExpiryEmailHtml(emailOpts),
      });

      console.info("[subscription-expiry] SMTP sent post-expiration email", {
        subscriptionId: row.subscription_id,
        to: patient.email,
      });

      // 4D. Update delivery status to sent
      stage = "delivery_status_update";
      await supabase
        .from("subscription_expiry_delivery")
        .update({
          email_status: "sent",
          email_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("subscription_id", row.subscription_id)
        .eq("period_end", periodEnd);

      emailsSent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[subscription-expiry] Processing failed", {
        subscriptionId: row.subscription_id,
        stage,
        error: message,
      });

      if (claimed) {
        await supabase
          .from("subscription_expiry_delivery")
          .update({
            email_status: sendAttempted ? "sending" : "failed",
            last_error: message.slice(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", row.subscription_id)
          .eq("period_end", periodEnd)
          .eq("email_status", "sending");
      }

      failures.push(row.subscription_id);
    }
  }

  console.info("[subscription-expiry] Completed", {
    checkedAt: nowIso,
    eligibleCount: eligible.length,
    subscriptionUpdates,
    notificationsCreated,
    emailsSent,
    skipped,
    failedCount: failures.length,
  });

  return json({
    mode: "process",
    checkedAt: nowIso,
    eligibleCount: eligible.length,
    subscriptionUpdates,
    notificationsCreated,
    emailsSent,
    skipped,
    failedCount: failures.length,
    failedSubscriptionIds: failures,
  });
});