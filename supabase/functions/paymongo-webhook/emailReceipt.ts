import nodemailer from "nodemailer";

export async function sendReceiptEmail({
  patientEmail,
  paymentMethod,
  amount,
  baseAmount,
  vatAmount,
  paymentDate,
  paymongoPaymentId,
}: {
  patientEmail: string;
  paymentMethod: string;
  amount: number;
  baseAmount?: number;
  vatAmount?: number;
  paymentDate: string;
  paymongoPaymentId: string;
}) {
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPassword = Deno.env.get("SMTP_PASSWORD");

  if (!smtpHost || !smtpUser || !smtpPassword) {
    throw new Error("SMTP configuration is incomplete");
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

  const formattedDate = new Date(paymentDate).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const resolvedBase = baseAmount != null && baseAmount > 0
    ? baseAmount
    : Math.round((amount / 1.12) * 100) / 100;
  const resolvedVat = vatAmount != null && vatAmount > 0
    ? vatAmount
    : Math.round((amount - resolvedBase) * 100) / 100;

  const formattedTotal = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);

  const formattedBase = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(resolvedBase);

  const formattedVat = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(resolvedVat);

  await transporter.sendMail({
    from: `"DermAI" <${smtpUser}>`,
    to: patientEmail,
    subject: "DermAI Payment Receipt",
    text: [
      "Payment Received!",
      "",
      "Your DermAI subscription payment was successfully received.",
      "",
      `Payment Method: ${paymentMethod}`,
      `Date: ${formattedDate}`,
      `Transaction ID: ${paymongoPaymentId}`,
      `Amount (excl. VAT): ${formattedBase}`,
      `VAT (12%): ${formattedVat}`,
      `Total Paid: ${formattedTotal}`,
      "",
      "Thank you for using DermAI.",
    ].join("\n"),
    html: `
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
          <div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:12px;padding:32px;">
            
            <h1 style="margin:0 0 10px;color:#333333;">
              Payment Received!
            </h1>

            <p style="color:#666666;">
              Your DermAI subscription payment was successfully received.
            </p>

            <div style="margin-top:24px;border:1px solid #eeeeee;border-radius:10px;padding:20px;">
              <p><strong>Payment Method:</strong> ${paymentMethod}</p>
              <p><strong>Date:</strong> ${formattedDate}</p>
              <p><strong>Transaction ID:</strong> ${paymongoPaymentId}</p>
              <p><strong>Amount (excl. VAT):</strong> ${formattedBase}</p>
              <p><strong>VAT (12%):</strong> ${formattedVat}</p>
              <p style="margin-top:12px;font-size:16px;color:#A21D5C;">
                <strong>Total Paid:</strong>
                ${formattedTotal}
              </p>
            </div>

            <p style="margin-top:24px;color:#666666;">
              Thank you for using DermAI.
            </p>

            <p style="font-size:12px;color:#999999;margin-top:30px;">
              This is an automated payment receipt from DermAI.
            </p>

          </div>
        </body>
      </html>
    `,
  });

  console.log(
    `[Email] Receipt sent successfully to ${patientEmail}`
  );
}