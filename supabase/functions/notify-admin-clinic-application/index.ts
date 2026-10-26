import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

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

function escapeHtml(val?: string | null): string {
  if (!val) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json();
    const {
      clinicId = "",
      clinicName = "New Clinic",
      clinicEmail = "N/A",
      clinicPhone = "N/A",
      specialization = "General Dermatology",
      address = "N/A",
      submittedAt = new Date().toISOString(),
    } = payload || {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      "";

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // =========================================================================
    // 1. BACKEND GUARD: Check if Admin has enabled this email preference
    // =========================================================================
    let isAlertEnabled = true;

    try {
      const { data: prefRow, error: prefError } = await adminSupabase
        .from("system_setting")
        .select("value")
        .eq("key", "email_alerts_new_clinic_applications")
        .maybeSingle();

      if (!prefError && prefRow !== null && prefRow !== undefined) {
        isAlertEnabled = prefRow.value === true || prefRow.value === "true";
      } else {
        // Fallback: Check admin user metadata from live auth
        const { data: adminUsers } = await adminSupabase
          .from("user")
          .select("user_id")
          .eq("role", "admin")
          .limit(1);

        if (adminUsers?.[0]?.user_id && adminSupabase.auth?.admin) {
          const { data: authUser } = await adminSupabase.auth.admin.getUserById(adminUsers[0].user_id);
          const metaVal = authUser?.user?.user_metadata?.email_alerts_new_clinic_applications;
          if (typeof metaVal === "boolean") {
            isAlertEnabled = metaVal;
          }
        }
      }
    } catch (_prefErr) {
      // Proceed with default true if preference check encounters an error
      isAlertEnabled = true;
    }

    if (!isAlertEnabled) {
      console.info(
        `[notify-admin-clinic-application] Guard active: Admin has DISABLED email alerts. Skipping email for clinic '${clinicName}' (${clinicId}).`
      );
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "Preference 'email_alerts_new_clinic_applications' is false",
      });
    }

    // =========================================================================
    // 2. Resolve Admin Recipient Email
    // =========================================================================
    let recipientEmail =
      Deno.env.get("ADMIN_ALERT_EMAIL") ||
      Deno.env.get("SMTP_USER") ||
      "dermaisupport@gmail.com";

    // Attempt to read custom contact email from system_setting or admin user
    try {
      const { data: contactEmailRow } = await adminSupabase
        .from("system_setting")
        .select("value")
        .eq("key", "platform_contact_email")
        .maybeSingle();

      if (contactEmailRow?.value) {
        const valStr = String(contactEmailRow.value).replace(/"/g, "").trim();
        if (valStr.includes("@")) recipientEmail = valStr;
      } else {
        const { data: adminUser } = await adminSupabase
          .from("user")
          .select("email")
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();

        if (adminUser?.email && adminUser.email.includes("@")) {
          recipientEmail = adminUser.email;
        }
      }
    } catch (_emailErr) {
      // Use fallback recipientEmail
    }

    // =========================================================================
    // 3. Configure SMTP Transporter
    // =========================================================================
    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
    const smtpUser = Deno.env.get("SMTP_USER") || "dermaisupport@gmail.com";
    const smtpPassword = Deno.env.get("SMTP_PASSWORD") || "";

    if (!smtpPassword) {
      console.warn(
        "[notify-admin-clinic-application] SMTP_PASSWORD not set in environment. Email cannot be delivered."
      );
      return jsonResponse(
        {
          success: false,
          error: "SMTP credentials not configured on backend",
        },
        500
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    // =========================================================================
    // 4. Render Responsive HTML Email
    // =========================================================================
    const formattedDate = new Date(submittedAt).toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const safeName = escapeHtml(clinicName);
    const safeEmail = escapeHtml(clinicEmail);
    const safePhone = escapeHtml(clinicPhone);
    const safeSpec = escapeHtml(specialization);
    const safeAddress = escapeHtml(address);
    const adminClinicUrl = clinicId
      ? `https://dermai.ph/admin/clinics?selected=${encodeURIComponent(clinicId)}`
      : "https://dermai.ph/admin/clinics";

    const emailSubject = `[DermAI Alert] New Clinic Verification Application: ${safeName}`;

    const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Clinic Application</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #A21D5C 0%, #70113E 100%); padding: 32px 28px; text-align: left;">
              <span style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 4px 10px; border-radius: 999px; margin-bottom: 12px;">
                Admin Alert Notification
              </span>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; line-height: 1.3;">
                New Clinic Applied for Verification
              </h1>
              <p style="margin: 6px 0 0; color: #fce7f3; font-size: 13px;">
                A new clinical partner has submitted their credentials for administrative review.
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 28px;">
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                Hello Administrator,<br />
                A new clinic has submitted their application credentials and legal documents. Please review and verify their eligibility in the Admin Portal.
              </p>

              <!-- Application Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #1e293b;">
                      <tr>
                        <td width="35%" style="font-weight: 600; color: #831843;">Clinic Name:</td>
                        <td style="font-weight: 700; color: #0f172a;">${safeName}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: 600; color: #831843;">Specialization:</td>
                        <td>${safeSpec}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: 600; color: #831843;">Email Address:</td>
                        <td><a href="mailto:${safeEmail}" style="color: #A21D5C; text-decoration: none;">${safeEmail}</a></td>
                      </tr>
                      <tr>
                        <td style="font-weight: 600; color: #831843;">Contact Number:</td>
                        <td>${safePhone}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: 600; color: #831843;">Clinic Address:</td>
                        <td>${safeAddress}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: 600; color: #831843;">Date Submitted:</td>
                        <td>${formattedDate} PHT</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Action Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <a href="${adminClinicUrl}" target="_blank" style="display: inline-block; background-color: #A21D5C; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 28px; border-radius: 8px; box-shadow: 0 2px 6px rgba(162,29,92,0.3);">
                      Review Clinic Application &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5; text-align: center;">
                You received this email because <strong>Email Alerts for New Clinic Applications</strong> is enabled in your Admin System Settings.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
              &copy; ${new Date().getFullYear()} DermAI Platform. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // =========================================================================
    // 5. Send via SMTP
    // =========================================================================
    const sendResult = await transporter.sendMail({
      from: `"DermAI Platform Alerts" <${smtpUser}>`,
      to: recipientEmail,
      subject: emailSubject,
      html: emailHtml,
    });

    console.info(
      `[notify-admin-clinic-application] Email dispatched to ${recipientEmail} for clinic ${clinicName} (MessageID: ${sendResult.messageId})`
    );

    return jsonResponse({
      success: true,
      deliveredTo: recipientEmail,
      messageId: sendResult.messageId,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[notify-admin-clinic-application] Dispatch failure:", errorMsg);
    return jsonResponse(
      { success: false, error: errorMsg },
      500
    );
  }
});
