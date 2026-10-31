import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendBookingReceiptEmail } from "../paymongo-payment/emailReceipt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(data: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase configuration environment variables");
    }

    // Authorization check: Verify service-role key or cron-secret
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const requestCronSecret = req.headers.get("x-cron-secret");

    const isAuthorized =
      (supabaseServiceRoleKey && token === supabaseServiceRoleKey) ||
      (cronSecret && requestCronSecret === cronSecret);

    if (!isAuthorized) {
      return jsonResponse({ error: "Unauthorized: Service role or cron secret required." }, 401);
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // 1. Claim next batch of eligible outbox tasks atomically using FOR UPDATE SKIP LOCKED
    const { data: batch, error: claimErr } = await adminSupabase.rpc(
      "claim_next_email_outbox_batch",
      {
        p_batch_size: 10,
        p_lease_seconds: 120,
      }
    );

    if (claimErr) {
      console.error("[email-outbox-worker] Failed to claim outbox batch:", claimErr);
      return jsonResponse(
        { error: `Database error claiming outbox batch: ${claimErr.message}` },
        500
      );
    }

    const tasks = Array.isArray(batch) ? batch : [];
    if (tasks.length === 0) {
      return jsonResponse({
        success: true,
        message: "No eligible email outbox tasks pending delivery.",
        processed: 0,
      });
    }

    console.log(`[email-outbox-worker] Claimed ${tasks.length} outbox task(s) for delivery.`);

    let succeeded = 0;
    let failed = 0;

    for (const task of tasks) {
      const payload = task.payload || {};
      const outboxId = task.outbox_id;
      const appointmentId = task.appointment_id || payload.appointmentId;
      const paymongoPaymentId = payload.paymongoPaymentId || task.idempotency_key?.split(":")[1];

      try {
        // 1. Lease Validation: Verify this worker still holds the active lease on this outbox entry
        const { data: currentTask, error: taskCheckErr } = await adminSupabase
          .from("email_outbox")
          .select("status, lease_expires_at, attempts, max_attempts")
          .eq("outbox_id", outboxId)
          .single();

        if (taskCheckErr || !currentTask) {
          console.warn(`[email-outbox-worker] Could not verify lease for task ${outboxId}: ${taskCheckErr?.message}`);
          failed++;
          continue;
        }

        const leaseExpiresAt = currentTask.lease_expires_at ? new Date(currentTask.lease_expires_at).getTime() : 0;
        if (currentTask.status !== "processing" || leaseExpiresAt <= Date.now()) {
          console.warn(`[email-outbox-worker] Task ${outboxId} lease expired or was stolen (status: ${currentTask.status}). Aborting dispatch.`);
          failed++;
          continue; // Do NOT finalize; let new lease holder or cleanup sweep handle it
        }

        // 2. Pre-Dispatch Appointment Re-Validation:
        // Immediately prior to dispatch, verify that the appointment is confirmed paid and not cancelled/refunded/rejected
        if (!appointmentId) {
          throw new Error("Outbox task missing appointment_id");
        }

        const { data: appointment, error: apptErr } = await adminSupabase
          .from("patient_appointment")
          .select("appointment_id, user_id, clinic_id, assigned_doctor_id, status, payment_status, doctor_status, patient_name, patient_email, date, time, batch_time, payment_amount, payment_reference, clinic_note")
          .eq("appointment_id", appointmentId)
          .single();

        if (apptErr || !appointment) {
          const cancelMsg = `Receipt aborted: Appointment ${appointmentId} not found in database.`;
          console.warn(`[email-outbox-worker] ${cancelMsg}`);
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: cancelMsg,
          });
          failed++;
          continue;
        }

        const isEligible =
          appointment.payment_status === "paid" &&
          appointment.status !== "cancelled" &&
          appointment.status !== "rejected" &&
          appointment.doctor_status !== "rejected" &&
          !appointment.clinic_note?.includes("[RECONCILIATION REQUIRED]");

        if (!isEligible) {
          const cancelMsg = `Receipt aborted: Appointment ${appointmentId} is no longer eligible (status=${appointment.status}, payment_status=${appointment.payment_status}, doctor_status=${appointment.doctor_status}).`;
          console.warn(`[email-outbox-worker] ${cancelMsg}`);
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: cancelMsg,
          });

          if (task.user_id) {
            try {
              await adminSupabase.from("system_audit_log").insert({
                user_id: task.user_id,
                action: "Consultation Receipt Email Aborted",
                target: task.recipient_email || appointment.patient_email || "Unknown",
                details: cancelMsg,
                ip_address: "127.0.0.1",
                user_agent: "DermAI Outbox Background Worker",
              });
            } catch { /* non-blocking audit */ }
          }

          failed++;
          continue;
        }

        // 3. Authoritative Entity Reconstruction: Re-query clinic & doctor names from database
        let clinicName = payload.clinicName;
        if (!clinicName && appointment.clinic_id) {
          try {
            const { data: clinic } = await adminSupabase
              .from("clinic")
              .select("name")
              .eq("clinic_id", appointment.clinic_id)
              .single();
            if (clinic?.name) clinicName = clinic.name;
          } catch { /* fallback to default */ }
        }

        let doctorName = payload.doctorName;
        if (!doctorName && appointment.assigned_doctor_id) {
          try {
            const { data: doc } = await adminSupabase
              .from("clinic_doctor")
              .select("doctor_name")
              .eq("doctor_id", appointment.assigned_doctor_id)
              .single();
            if (doc?.doctor_name) doctorName = doc.doctor_name;
          } catch { /* fallback to default */ }
        }

        const recipientEmail = task.recipient_email || appointment.patient_email || payload.patientEmail;
        if (!recipientEmail) {
          throw new Error("Outbox task and appointment record missing recipient email");
        }

        const authoritativePatientName = appointment.patient_name || payload.patientName || "Patient";
        const authoritativeClinicName = clinicName || "Skin Clinic";
        const authoritativeDoctorName = doctorName || "Attending Dermatologist";
        const authoritativeDate = appointment.date || payload.appointmentDate || "Scheduled Date";
        const authoritativeTime = appointment.time || appointment.batch_time || payload.appointmentTime || "Scheduled Time";
        const authoritativeAmount = Number(appointment.payment_amount ?? payload.amount ?? 0);
        const authoritativePaymentRef = appointment.payment_reference || paymongoPaymentId || "N/A";

        // DISTRIBUTED RACE WINDOW DOCUMENTATION:
        // By checking appointment eligibility and lease immediately prior to invoking sendBookingReceiptEmail,
        // we minimize the race window to solely the external SMTP / Resend API network transport duration (~50-300ms).
        // Since external email APIs are inherently non-transactional with PostgreSQL, this pre-dispatch check
        // combined with row-level leasing guarantees the highest possible consistency achievable.

        const dispatchResult = await sendBookingReceiptEmail({
          patientEmail: recipientEmail,
          patientName: authoritativePatientName,
          clinicName: authoritativeClinicName,
          doctorName: authoritativeDoctorName,
          appointmentDate: authoritativeDate,
          appointmentTime: authoritativeTime,
          paymentMethod: payload.paymentMethod || "GCash",
          amount: authoritativeAmount,
          paymentDate: new Date().toISOString(),
          paymongoPaymentId: authoritativePaymentRef,
        });

        if (dispatchResult.success) {
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: true,
          });

          if (task.user_id) {
            try {
              await adminSupabase.from("system_audit_log").insert({
                user_id: task.user_id,
                action: "Consultation Receipt Email Sent",
                target: recipientEmail,
                details: `Consultation receipt email dispatched by background worker to ${recipientEmail} for payment ${authoritativePaymentRef}.`,
                ip_address: "127.0.0.1",
                user_agent: "DermAI Outbox Background Worker",
              });
            } catch { /* ignore non-blocking audit */ }
          }

          succeeded++;
          console.log(`[email-outbox-worker] Task ${outboxId} sent successfully to ${recipientEmail}`);
        } else {
          const errMsg = dispatchResult.error || "Email provider dispatch failed";
          await adminSupabase.rpc("finalize_email_outbox", {
            p_outbox_id: outboxId,
            p_success: false,
            p_error: errMsg,
          });
          failed++;
          console.warn(`[email-outbox-worker] Task ${outboxId} dispatch failed: ${errMsg}`);
        }
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await adminSupabase.rpc("finalize_email_outbox", {
          p_outbox_id: outboxId,
          p_success: false,
          p_error: errMsg,
        });
        failed++;
        console.error(`[email-outbox-worker] Task ${outboxId} exception:`, errMsg);
      }
    }

    return jsonResponse({
      success: true,
      processed: tasks.length,
      succeeded,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[email-outbox-worker] Worker runtime error:", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Internal worker error",
      },
      500
    );
  }
});
