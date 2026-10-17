import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
// Send the reminder when current_period_end is between 13 and 14 days away.
const REMINDER_DAYS = 14;
const WINDOW_SPAN_DAYS = 1; // 14 - 1 = 13 days
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_TABLE = "subscription_expiry_reminder";
const PAGE_SIZE = 500;

type PlanInfo = { name: string | null; price: number | string | null };

type SubscriptionQueryRow = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  current_period_end: string;
  status?: string;
  cancel_at_period_end?: boolean;
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

function describeTimeLeft(daysLeft: number): string {
  if (daysLeft >= 13) return "in 2 weeks";
  if (daysLeft <= 1) return "tomorrow";
  return `in ${daysLeft} days`;
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

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    pageCount++;

    if (error) {
      return { data: allRows, error, pageCount };
    }

    const pageRows = data ?? [];
    allRows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) {
      return { data: allRows, error: null, pageCount };
    }
  }
}

// ---------------------------------------------------------------------------
// Email templates for 2-Week Advance Reminder
// ---------------------------------------------------------------------------
function renderReminderEmailHtml(opts: {
  periodEndLabel: string;
  timePhrase: string;
}): string {
  const pink = "#A21D5C";
  const pinkDark = "#7E1448";
  const pinkSoft = "#FDF2F7";
  const pinkBorder = "#F4C9DC";

  const periodEndLabel = escapeHtml(opts.periodEndLabel);
  const timePhrase = escapeHtml(opts.timePhrase);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your DermAI Pro Subscription Ends Soon</title>
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
                Subscription Reminder
              </div>
              <h1 style="margin:18px 0 0;font-size:24px;line-height:1.3;color:${pinkDark};">
                Your Pro subscription ends ${timePhrase}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 8px;font-size:15px;line-height:1.7;color:#4a3640;">
              <p style="margin:0 0 14px;">Hello,</p>
              <p style="margin:0 0 14px;">
                This is a friendly heads-up that your <strong style="color:${pink};">DermAI Pro subscription is set to end ${timePhrase}</strong>
                on <strong>${periodEndLabel}</strong>.
              </p>
              <p style="margin:0 0 14px;">
                Once it expires, your account will switch to the Free Plan unless you manually renew.
                Because your plan does not renew automatically, you can renew ahead of time to keep your unlimited scans, priority clinic booking, and full condition tracking uninterrupted.
              </p>
            </td>
          </tr>
          <!-- Sign-off -->
          <tr>
            <td style="padding:0 40px 32px;font-size:15px;line-height:1.7;color:#4a3640;">
              <p style="margin:0 0 14px;">Thank you for trusting DermAI with your skin health.</p>
              <p style="margin:0;">Best regards,<br /><strong style="color:${pinkDark};">The DermAI Team</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background:${pinkSoft};border-top:1px solid ${pinkBorder};padding:20px 24px;font-size:12px;color:#8a6b79;line-height:1.6;">
              This is an automated reminder from DermAI. Please do not reply to this email.<br />
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

function renderReminderEmailText(opts: {
  periodEndLabel: string;
  timePhrase: string;
}): string {
  return [
    "Hello,",
    "",
    `This is a friendly heads-up that your DermAI Pro subscription is set to end ${opts.timePhrase} on ${opts.periodEndLabel}.`,
    "",
    "Once it expires, your account will switch to the Free Plan unless you manually renew. Your plan does not renew automatically.",
    "",
    "Thank you for trusting DermAI with your skin health.",
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

  console.info("[subscription-reminder-2weeks] Request received", {
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
    console.warn("[subscription-reminder-2weeks] Authentication rejected", {
      expectedSecretConfigured: Boolean(expectedSecret),
      suppliedSecretPresent: Boolean(suppliedSecret),
    });
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[subscription-reminder-2weeks] Supabase configuration missing");
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
  const processMode = body.mode === "process" && processingEnabled;

  console.info("[subscription-reminder-2weeks] Mode evaluated", {
    requestedMode: body.mode ?? "preview",
    processingEnabled,
    processMode,
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const nowIso = now.toISOString();

  // Target window: between 13 and 14 days ahead from NOW()
  const windowStartIso = new Date(
    now.getTime() + (REMINDER_DAYS - WINDOW_SPAN_DAYS) * DAY_MS,
  ).toISOString();
  const windowEndIso = new Date(
    now.getTime() + REMINDER_DAYS * DAY_MS,
  ).toISOString();

  // ---------------------------------------------------------------------------
  // 1. Find ACTIVE paid subscriptions ending in the 13 to 14-day window
  // ---------------------------------------------------------------------------
  const { data: upcomingData, error: upcomingError, pageCount } = await fetchAllPages(
    (from, to) =>
      supabase
        .from("user_plan_subscription")
        .select(
          "subscription_id, user_id, plan_id, current_period_end, status, plan:plan_id(name, price)",
        )
        .eq("status", "active")
        .not("current_period_end", "is", null)
        .gte("current_period_end", windowStartIso)
        .lte("current_period_end", windowEndIso)
        .order("current_period_end", { ascending: true })
        .order("subscription_id", { ascending: true })
        .range(from, to),
  );

  if (upcomingError) {
    console.error(
      "[subscription-reminder-2weeks] Upcoming query failed:",
      upcomingError.message,
    );
    return json({ error: "Could not inspect upcoming subscription expirations" }, 500);
  }

  const upcomingRows = (upcomingData ?? []) as unknown as SubscriptionQueryRow[];
  const upcomingPaid = upcomingRows.filter(isPaidPlan);

  console.info("[subscription-reminder-2weeks] Upcoming query succeeded", {
    checkedAt: nowIso,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    totalUpcoming: upcomingRows.length,
    paidUpcomingCount: upcomingPaid.length,
    pageCount,
  });

  // Preview Mode
  if (!processMode) {
    console.info("[subscription-reminder-2weeks] Preview mode; no emails will be sent", {
      upcomingCount: upcomingPaid.length,
      processingEnabled,
    });
    return json({
      mode: "preview_only",
      processingEnabled,
      checkedAt: nowIso,
      reminderWindowStart: windowStartIso,
      reminderWindowEnd: windowEndIso,
      upcomingCount: upcomingPaid.length,
      subscriptions: upcomingPaid.map((row) => ({
        subscriptionId: row.subscription_id,
        periodEnd: row.current_period_end,
      })),
      actionsTaken: {
        remindersSent: 0,
        notificationsCreated: 0,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. SMTP Setup
  // ---------------------------------------------------------------------------
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPassword = Deno.env.get("SMTP_PASSWORD");

  if (!smtpHost || !smtpUser || !smtpPassword || !Number.isFinite(smtpPort)) {
    console.error("[subscription-reminder-2weeks] SMTP configuration incomplete");
    return json({ error: "SMTP configuration is incomplete" }, 500);
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPassword },
  });

  // Deduplication claim helper:
  // Inserts a row in subscription_expiry_reminder keyed by (subscription_id, period_end).
  // If the record exists, it was already handled for this billing cycle.
  async function claimReminder(
    subscriptionId: string,
    periodEnd: string,
    userId: string,
  ): Promise<boolean> {
    const { data: inserted, error: insertError } = await supabase
      .from(REMINDER_TABLE)
      .upsert(
        {
          subscription_id: subscriptionId,
          period_end: periodEnd,
          user_id: userId,
          email_status: "sending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "subscription_id,period_end", ignoreDuplicates: true },
      )
      .select("subscription_id");

    if (insertError) {
      console.warn(
        "[subscription-reminder-2weeks] Deduplication claim insert error:",
        insertError.message,
      );
      return false;
    }
    if (inserted && inserted.length > 0) return true;

    // Retry only if previous run was marked failed
    const { data: reclaimed, error: reclaimError } = await supabase
      .from(REMINDER_TABLE)
      .update({
        email_status: "sending",
        updated_at: new Date().toISOString(),
      })
      .eq("subscription_id", subscriptionId)
      .eq("period_end", periodEnd)
      .eq("email_status", "failed")
      .select("subscription_id");

    if (reclaimError) return false;
    return (reclaimed && reclaimed.length > 0) || false;
  }

  let remindersSent = 0;
  let notificationsCreated = 0;
  let skipped = 0;
  const failures: string[] = [];

  // ---------------------------------------------------------------------------
  // 3. Process each eligible subscription
  // ---------------------------------------------------------------------------
  for (const row of upcomingPaid) {
    const periodEnd = new Date(row.current_period_end).toISOString();
    let claimed = false;
    let sendAttempted = false;
    let stage = "claim";

    console.info("[subscription-reminder-2weeks] Processing reminder", {
      subscriptionId: row.subscription_id,
      periodEnd,
    });

    try {
      claimed = await claimReminder(row.subscription_id, periodEnd, row.user_id);
      if (!claimed) {
        console.info(
          "[subscription-reminder-2weeks] Skipping; reminder already claimed/sent for this cycle",
          { subscriptionId: row.subscription_id },
        );
        skipped++;
        continue;
      }

      // Patient Email Lookup
      stage = "patient_lookup";
      const { data: patient, error: patientError } = await supabase
        .from("user")
        .select("email")
        .eq("user_id", row.user_id)
        .single();

      if (patientError || !patient?.email) {
        throw patientError ?? new Error("Patient email not found");
      }

      const periodEndMs = new Date(periodEnd).getTime();
      const daysLeft = Math.max(1, Math.ceil((periodEndMs - now.getTime()) / DAY_MS));
      const timePhrase = describeTimeLeft(daysLeft);
      const periodEndLabel = new Date(periodEnd).toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "long",
      });

      const emailOpts = { periodEndLabel, timePhrase };

      // In-app Notification
      stage = "notification";
      const notificationBody =
        `Your DermAI Pro subscription is set to end ${timePhrase} on ${periodEndLabel}. ` +
        "You can renew ahead of time to keep your Pro features active.";

      const { data: existingNotif } = await supabase
        .from("user_notification")
        .select("notif_id")
        .eq("user_id", row.user_id)
        .eq("subtype", "subscription_reminder_2weeks")
        .limit(1)
        .maybeSingle();

      if (!existingNotif) {
        const { error: notifError } = await supabase
          .from("user_notification")
          .insert({
            user_id: row.user_id,
            type: "system",
            subtype: "subscription_reminder_2weeks",
            title: `Your Pro Subscription Ends ${timePhrase}`,
            body: notificationBody,
          });

        if (!notifError) {
          notificationsCreated++;
        }
      }

      // Pre-SMTP Marker
      stage = "email_send";
      await supabase
        .from(REMINDER_TABLE)
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq("subscription_id", row.subscription_id)
        .eq("period_end", periodEnd)
        .eq("email_status", "sending");

      sendAttempted = true;
      await transporter.sendMail({
        from: `"DermAI" <${smtpUser}>`,
        to: patient.email,
        subject: `Upcoming expiration: your DermAI Pro subscription ends on ${periodEndLabel}`,
        text: renderReminderEmailText(emailOpts),
        html: renderReminderEmailHtml(emailOpts),
      });

      console.info("[subscription-reminder-2weeks] SMTP sent 2-week advance reminder", {
        subscriptionId: row.subscription_id,
        to: patient.email,
      });

      // Mark Sent
      stage = "delivery_status_update";
      await supabase
        .from(REMINDER_TABLE)
        .update({
          email_status: "sent",
          reminder_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("subscription_id", row.subscription_id)
        .eq("period_end", periodEnd);

      remindersSent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[subscription-reminder-2weeks] Processing failed", {
        subscriptionId: row.subscription_id,
        stage,
        error: message,
      });

      if (claimed) {
        await supabase
          .from(REMINDER_TABLE)
          .update({
            email_status: sendAttempted ? "sending" : "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", row.subscription_id)
          .eq("period_end", periodEnd)
          .eq("email_status", "sending");
      }

      failures.push(row.subscription_id);
    }
  }

  console.info("[subscription-reminder-2weeks] Completed", {
    checkedAt: nowIso,
    upcomingCount: upcomingPaid.length,
    remindersSent,
    notificationsCreated,
    skipped,
    failedCount: failures.length,
  });

  return json({
    mode: "process",
    checkedAt: nowIso,
    reminderWindowStart: windowStartIso,
    reminderWindowEnd: windowEndIso,
    upcomingCount: upcomingPaid.length,
    remindersSent,
    notificationsCreated,
    skipped,
    failedCount: failures.length,
    failedSubscriptionIds: failures,
  });
});
