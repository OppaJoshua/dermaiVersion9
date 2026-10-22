import nodemailer from "nodemailer";

export interface ReceiptEmailParams {
  /** Recipient resolved from the account / payment records. Never defaulted. */
  patientEmail: string;
  /** Channel label derived from the live payment, e.g. "GCash" | "Maya". */
  paymentMethod: string;
  /** Gross amount actually charged, in PHP (PayMongo amount / 100). */
  amount: number;
  /** Name of the plan actually purchased (from the plan record). */
  planName: string;
  /** Billing interval actually purchased ("monthly" | "yearly"). */
  billingCycle: string;
  /** ISO timestamp of the payment. */
  paymentDate: string;
  /** Real PayMongo payment id (pay_...). */
  paymongoPaymentId: string;
}

export interface BookingReceiptEmailParams {
  patientEmail: string;
  patientName?: string;
  clinicName: string;
  doctorName?: string;
  appointmentDate: string;
  appointmentTime?: string;
  paymentMethod: string;
  amount: number;
  paymentDate: string;
  paymongoPaymentId: string;
}

export interface EmailDispatchResult {
  success: boolean;
  provider: "smtp" | "resend";
  messageId?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBillingCycle(cycle: string): string {
  const c = cycle.trim().toLowerCase();
  if (c === "monthly") return "Monthly";
  if (c === "yearly" || c === "annual") return "Yearly";
  return cycle;
}

async function dispatchEmail({
  to,
  subject,
  textContent,
  htmlContent,
  transactionId,
  formattedTotal,
}: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent: string;
  transactionId: string;
  formattedTotal: string;
}): Promise<EmailDispatchResult> {
  const cleanEmail = to.trim();
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM_EMAIL");

  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPassword = Deno.env.get("SMTP_PASSWORD");

  console.log("[emailReceipt] Starting receipt dispatch", {
    transactionId,
    amount: formattedTotal,
    smtpConfigured: Boolean(smtpHost && smtpUser && smtpPassword),
    resendConfigured: Boolean(resendApiKey && resendFrom),
  });

  // Strategy A: SMTP
  if (smtpHost && smtpUser && smtpPassword && Number.isFinite(smtpPort)) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPassword },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      });

      const info = await transporter.sendMail({
        from: `"DermAI" <${smtpUser}>`,
        to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent,
      });

      console.log("[emailReceipt] SMTP email sent", {
        transactionId,
        messageId: info.messageId,
      });

      return { success: true, provider: "smtp", messageId: info.messageId };
    } catch (smtpErr) {
      console.error("[emailReceipt] SMTP dispatch error:", smtpErr);
      if (!(resendApiKey && resendFrom)) {
        throw new Error(
          `SMTP delivery failed: ${smtpErr instanceof Error ? smtpErr.message : String(smtpErr)}`
        );
      }
      console.warn("[emailReceipt] SMTP failed, attempting Resend fallback...");
    }
  }

  // Strategy B: Resend (only when both key and verified sender are configured)
  if (resendApiKey && resendFrom) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [cleanEmail],
          subject,
          text: textContent,
          html: htmlContent,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `Resend error: ${res.statusText}`);
      }

      console.log("[emailReceipt] Resend email dispatched", {
        transactionId,
        id: json.id,
      });
      return { success: true, provider: "resend", messageId: json.id };
    } catch (resendErr) {
      console.error("[emailReceipt] Resend API error:", resendErr);
      throw new Error(
        `Email dispatch failed across all providers: ${resendErr instanceof Error ? resendErr.message : String(resendErr)}`
      );
    }
  }

  throw new Error(
    "No mailing provider configured. Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD or RESEND_API_KEY with RESEND_FROM_EMAIL."
  );
}

export async function sendReceiptEmail(
  params: ReceiptEmailParams
): Promise<EmailDispatchResult> {
  const cleanEmail = (params.patientEmail || "").trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    console.error("[emailReceipt] Missing recipient email address");
    throw new Error("Missing recipient email address");
  }
  if (!params.paymongoPaymentId) {
    throw new Error("Missing PayMongo payment reference for receipt");
  }
  if (!params.planName) {
    throw new Error("Missing plan name for receipt");
  }
  if (!params.billingCycle) {
    throw new Error("Missing billing cycle for receipt");
  }
  if (!params.paymentMethod) {
    throw new Error("Missing payment method for receipt");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Missing or invalid payment amount for receipt");
  }
  const paidAt = new Date(params.paymentDate);
  if (isNaN(paidAt.getTime())) {
    throw new Error("Missing or invalid payment date for receipt");
  }

  const formattedDate = paidAt.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const formattedTotal = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(params.amount);

  const isAppointment =
    params.planName?.toLowerCase().includes("appointment") ||
    params.planName?.toLowerCase().includes("consultation") ||
    !params.billingCycle;

  const cycleFormatted = params.billingCycle ? formatBillingCycle(params.billingCycle) : "";
  const planLabel = cycleFormatted ? `${params.planName} (${cycleFormatted})` : params.planName;
  const plan = escapeHtml(planLabel);
  const method = escapeHtml(params.paymentMethod);
  const txId = escapeHtml(params.paymongoPaymentId);
  const subject = `DermAI Payment Receipt - ${formattedTotal}`;

  const textContent = [
    "DermAI Payment Receipt",
    "======================",
    "",
    isAppointment
      ? "Thank you for your payment! Your consultation booking is now confirmed."
      : "Thank you for your payment! Your subscription is now active.",
    "",
    `${isAppointment ? "Service" : "Plan"}: ${planLabel}`,
    `Total Paid: ${formattedTotal} (VAT inclusive)`,
    `Payment Method: ${params.paymentMethod}`,
    `Date: ${formattedDate}`,
    `Transaction ID: ${params.paymongoPaymentId}`,
    "",
    "If you have any questions, feel free to reply to this email.",
    "",
    "— The DermAI Team",
  ].join("\n");

  const row = (label: string, value: string, mono = false) => `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;color:#6B7280;width:40%;">${label}</td>
                  <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;color:#111827;font-weight:600;text-align:right;${
                    mono ? "font-family:monospace;font-size:12px;word-break:break-all;" : ""
                  }">${value}</td>
                </tr>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DermAI Payment Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333333;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8f9fa;padding:30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #f0e6eb;">
          <tr>
            <td style="background:linear-gradient(135deg, #A21D5C 0%, #7E1448 100%);padding:36px 30px;text-align:center;">
              <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#FCE7F3;">DermAI</p>
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Payment Confirmed</h1>
              <p style="margin:8px 0 0 0;font-size:14px;color:#FCE7F3;">${isAppointment ? "Official Appointment Receipt" : "Official Subscription Receipt"}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 30px;">
              <p style="margin:0 0 24px 0;font-size:15px;color:#4B5563;">
                We have successfully received your payment. ${isAppointment ? `Your <strong>${plan}</strong> booking is confirmed.` : `Your <strong>${plan}</strong> subscription is now active.`}
              </p>
              <div style="background-color:#FDF2F7;border:1px solid #F4C9DC;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7E1448;">Total Amount Paid</p>
                <p style="margin:0;font-size:32px;font-weight:800;color:#A21D5C;">${formattedTotal}</p>
                <p style="margin:4px 0 0 0;font-size:12px;color:#6B7280;">VAT Inclusive</p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;font-size:14px;border-collapse:collapse;">
                ${row(isAppointment ? "Booking / Service" : "Plan", plan)}
                ${row("Payment Method", method)}
                ${row("Date &amp; Time", escapeHtml(formattedDate))}
                ${row("Transaction ID", txId, true)}
              </table>
              <p style="margin:0 0 6px 0;font-size:14px;color:#4B5563;">Thank you for choosing DermAI for your skin health.</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#A21D5C;">— The DermAI Team</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F9FAFB;padding:20px 30px;text-align:center;border-top:1px solid #F3F4F6;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#9CA3AF;">This is an automated payment receipt from DermAI.</p>
              <p style="margin:0;font-size:11px;color:#9CA3AF;">&copy; ${new Date().getFullYear()} DermAI Platform. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return await dispatchEmail({
    to: cleanEmail,
    subject,
    textContent,
    htmlContent,
    transactionId: params.paymongoPaymentId,
    formattedTotal,
  });
}

export async function sendBookingReceiptEmail(
  params: BookingReceiptEmailParams
): Promise<EmailDispatchResult> {
  const cleanEmail = (params.patientEmail || "").trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    console.error("[emailReceipt] Missing recipient email address for booking");
    throw new Error("Missing recipient email address for booking");
  }
  if (!params.paymongoPaymentId) {
    throw new Error("Missing PayMongo payment reference for consultation receipt");
  }
  if (!params.clinicName) {
    throw new Error("Missing clinic name for consultation receipt");
  }
  if (!params.paymentMethod) {
    throw new Error("Missing payment method for consultation receipt");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Missing or invalid payment amount for consultation receipt");
  }
  const paidAt = new Date(params.paymentDate);
  if (isNaN(paidAt.getTime())) {
    throw new Error("Missing or invalid payment date for consultation receipt");
  }

  const formattedDate = paidAt.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const formattedTotal = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(params.amount);

  const clinic = escapeHtml(params.clinicName);
  const doctor = escapeHtml(params.doctorName || "Attending Dermatologist");
  const patient = escapeHtml(params.patientName || "Patient");
  const apptTime = escapeHtml(params.appointmentTime || "");
  const method = escapeHtml(params.paymentMethod);
  const txId = escapeHtml(params.paymongoPaymentId);
  const subject = `DermAI Consultation Receipt - ${clinic} (${formattedTotal})`;

  const scheduleText = apptTime ? `${params.appointmentDate} at ${params.appointmentTime}` : params.appointmentDate;

  const textContent = [
    "DermAI Clinic Consultation Receipt",
    "==================================",
    "",
    "Thank you for your consultation booking! Your payment has been received.",
    "",
    `Clinic: ${params.clinicName}`,
    `Attending Doctor: ${params.doctorName || "Assigned by Clinic"}`,
    `Confirmed Schedule: ${scheduleText}`,
    `Patient: ${params.patientName || "Patient"}`,
    `Total Paid: ${formattedTotal} (VAT inclusive)`,
    `Payment Method: ${params.paymentMethod}`,
    `Payment Date: ${formattedDate}`,
    `Transaction ID: ${params.paymongoPaymentId}`,
    "",
    "Please arrive 10-15 minutes prior to your scheduled consultation time.",
    "If you have any questions, feel free to reply to this email.",
    "",
    "— The DermAI Team",
  ].join("\n");

  const row = (label: string, value: string, mono = false) => `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;color:#6B7280;width:40%;">${label}</td>
                  <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;color:#111827;font-weight:600;text-align:right;${
                    mono ? "font-family:monospace;font-size:12px;word-break:break-all;" : ""
                  }">${value}</td>
                </tr>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DermAI Consultation Booking Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333333;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8f9fa;padding:30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #f0e6eb;">
          <tr>
            <td style="background:linear-gradient(135deg, #A21D5C 0%, #7E1448 100%);padding:36px 30px;text-align:center;">
              <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#FCE7F3;">DermAI Clinic Booking</p>
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Consultation Confirmed</h1>
              <p style="margin:8px 0 0 0;font-size:14px;color:#FCE7F3;">Official Payment &amp; Appointment Receipt</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 30px;">
              <p style="margin:0 0 24px 0;font-size:15px;color:#4B5563;">
                Your clinic consultation with <strong>${clinic}</strong> has been confirmed. We look forward to seeing you.
              </p>
              <div style="background-color:#FDF2F7;border:1px solid #F4C9DC;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7E1448;">Consultation Fee Paid</p>
                <p style="margin:0;font-size:32px;font-weight:800;color:#A21D5C;">${formattedTotal}</p>
                <p style="margin:4px 0 0 0;font-size:12px;color:#6B7280;">VAT Inclusive</p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;font-size:14px;border-collapse:collapse;">
                ${row("Clinic", clinic)}
                ${row("Attending Doctor", doctor)}
                ${row("Confirmed Schedule", escapeHtml(scheduleText))}
                ${row("Patient Name", patient)}
                ${row("Payment Method", method)}
                ${row("Payment Date", escapeHtml(formattedDate))}
                ${row("Transaction ID", txId, true)}
              </table>
              <div style="background-color:#F9FAFB;border-radius:10px;padding:14px 16px;margin-bottom:24px;border:1px solid #E5E7EB;">
                <p style="margin:0;font-size:13px;color:#4B5563;">
                  <strong>Reminders:</strong> Please arrive 10–15 minutes early at the clinic. Have your Transaction ID ready upon check-in.
                </p>
              </div>
              <p style="margin:0 0 6px 0;font-size:14px;color:#4B5563;">Thank you for trusting DermAI for your dermatology care.</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#A21D5C;">— The DermAI Team</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F9FAFB;padding:20px 30px;text-align:center;border-top:1px solid #F3F4F6;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#9CA3AF;">This is an automated payment receipt from DermAI.</p>
              <p style="margin:0;font-size:11px;color:#9CA3AF;">&copy; ${new Date().getFullYear()} DermAI Platform. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return await dispatchEmail({
    to: cleanEmail,
    subject,
    textContent,
    htmlContent,
    transactionId: params.paymongoPaymentId,
    formattedTotal,
  });
}
