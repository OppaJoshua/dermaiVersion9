import { supabase } from "./supabaseClient";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends or drafts an approval email for a verified clinic.
 * 1. Creates an in-app notification in `user_notification` table.
 * 2. Attempts dispatch via Supabase Edge Function `/send-email` (if deployed).
 * 3. Returns mailto link as fallback so admin can open pre-filled Gmail draft with 1 click.
 */
export async function sendClinicApprovalEmail(params: {
  clinicId?: string | number;
  clinicName: string;
  recipientEmail: string;
  doctorName?: string;
}): Promise<{ success: boolean; mailtoUrl: string; message: string }> {
  const { clinicName, recipientEmail, doctorName } = params;

  const subject = `Clinic Verification Approved - ${clinicName}`;
  const plainTextBody = `Dear ${doctorName || clinicName} Team,

Your clinic verification application for "${clinicName}" has been approved by the DermAI Medical & Compliance Team.

Your Clinic Portal is now fully unlocked. You can start:
• Managing face-to-face appointments and patient consultations
• Onboarding and managing clinic dermatologists
• Managing patient skin records and AI assessment history
• Customizing clinic operating schedules and consultation fees

Access your Clinic Portal here:
http://localhost:5173/clinic

Best regards,
The DermAI Support & Medical Review Team
dermaisupport@gmail.com`;

  // 1. Create In-App Notification in Supabase user_notification table
  try {
    const { data: matchedUser } = await supabase
      .from("user")
      .select("user_id")
      .ilike("email", recipientEmail.trim().toLowerCase())
      .maybeSingle();

    if (matchedUser?.user_id) {
      await supabase.from("user_notification").insert({
        user_id: matchedUser.user_id,
        type: "system",
        subtype: "clinic_approval",
        title: "Clinic Verification Approved",
        body: `Your clinic "${clinicName}" has been verified and approved. All clinic operations and appointment tools are now active.`,
        is_read: false,
      });
    }
  } catch (err) {
    console.warn("Could not insert user_notification:", err);
  }

  // 2. Try Supabase Edge Function / API if deployed
  let functionDispatched = false;
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        to: recipientEmail,
        subject,
        text: plainTextBody,
      },
    });
    if (!error && data) {
      functionDispatched = true;
    }
  } catch {
    // Edge function not configured yet, fallback to mailto URL
  }

  // 3. Build mailto URL for instant 1-click email client dispatch
  const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(plainTextBody)}`;

  return {
    success: true,
    mailtoUrl,
    message: functionDispatched
      ? `Approval email dispatched to ${recipientEmail}`
      : `Notification recorded. You can also send a direct email to ${recipientEmail}`,
  };
}

/**
 * Sends or drafts a rejection email for a clinic application with specific reason.
 */
export async function sendClinicRejectionEmail(params: {
  clinicName: string;
  recipientEmail: string;
  reason: string;
}): Promise<{ success: boolean; mailtoUrl: string; message: string }> {
  const { clinicName, recipientEmail, reason } = params;

  const subject = `Update on your DermAI Clinic Registration - ${clinicName}`;
  const plainTextBody = `Dear ${clinicName} Team,

Thank you for your interest in registering "${clinicName}" on the DermAI Platform.

After reviewing your submitted credentials, our compliance team was unable to approve your application at this time due to the following reason:

${reason || "Incomplete or unverified documentation."}

You may sign in to update your documents or reply directly to this email with updated credentials.

Best regards,
The DermAI Compliance Team
dermaisupport@gmail.com`;

  // Insert in-app notification
  try {
    const { data: matchedUser } = await supabase
      .from("user")
      .select("user_id")
      .ilike("email", recipientEmail.trim().toLowerCase())
      .maybeSingle();

    if (matchedUser?.user_id) {
      await supabase.from("user_notification").insert({
        user_id: matchedUser.user_id,
        type: "system",
        subtype: "clinic_rejection",
        title: "Clinic Registration Status Update",
        body: `Your application for "${clinicName}" requires revision: ${reason || "Incomplete documents"}`,
        is_read: false,
      });
    }
  } catch {
    /* ignore */
  }

  const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(plainTextBody)}`;

  return {
    success: true,
    mailtoUrl,
    message: `Rejection notice recorded.`,
  };
}
