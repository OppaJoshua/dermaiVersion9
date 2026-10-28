// ============================================================================
// DermAI — Appointment Payment & Hold Service
// Authoritative server-side slot hold & simulated payment client service
// ============================================================================

import { supabase } from "@/lib/supabaseClient";

export type AppointmentPaymentStatus =
  | "pending_hold"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "exempt";

export type SimulatedPaymentOutcome = "success" | "failed" | "cancelled";

export interface AcquireHoldParams {
  userId: string;
  clinicId: string;
  doctorId?: string | null;
  date: string; // ISO 8601 string
  time: string; // "08:00" or "08:00:00"
  batchTime?: string;
  patientName: string;
  patientEmail?: string | null;
  patientContact?: string | null;
  patientAddress?: string | null;
  patientGender?: string | null;
  patientBirthdate?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  questionnaireAnswers?: any;
  notes?: string | null;
  clinicNote?: string | null;
  primaryScanId?: string | null;
  skinPhotoUrl?: string | null;
  aiConditionName?: string | null;
  aiConfidence?: number | null;
  conditionId?: string | null;
  holdDurationMinutes?: number;
}

export interface AcquireHoldResult {
  success: boolean;
  appointmentId?: string;
  paymentReference?: string;
  paymentAmount?: number;
  holdExpiresAt?: string;
  paymentStatus?: AppointmentPaymentStatus;
  clinicName?: string;
  code?: string;
  message?: string;
}

export interface ProcessSimulatedPaymentResult {
  success: boolean;
  appointmentId?: string;
  paymentStatus?: AppointmentPaymentStatus;
  queueNumber?: number;
  paymentReference?: string;
  paidAt?: string;
  holdExpiresAt?: string;
  canRetry?: boolean;
  code?: string;
  message?: string;
}

/**
 * Checks whether the client-side simulated payment demonstration UI is enabled.
 * Since PayMongo is the authoritative payment gateway, simulated payments are disabled by default.
 */
export function isSimulatedPaymentEnabled(): boolean {
  try {
    // If real PayMongo gateway is configured, simulated payment is disabled
    if (import.meta.env?.VITE_PAYMONGO_PUBLIC_KEY) {
      return false;
    }
    const envFlag = import.meta.env?.VITE_ENABLE_SIMULATED_PAYMENT;
    if (envFlag === "true" || envFlag === "1") {
      return true;
    }
  } catch {
    // Default to false in production environments
  }
  return false;
}

/**
 * Fetches the authoritative consultation fee for a clinic from Supabase.
 * Returns the numeric fee (defaults to 500.00 if unconfigured).
 */
export async function fetchClinicConsultationFee(clinicId: string): Promise<number> {
  if (!clinicId) return 500;
  try {
    const { data, error } = await supabase
      .from("clinic")
      .select("consultation_fee")
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (error || !data) return 500;
    const fee = Number(data.consultation_fee);
    return isNaN(fee) || fee < 0 ? 500 : fee;
  } catch {
    return 500;
  }
}

/**
 * Atomically acquires a temporary slot hold for an appointment via Postgres RPC.
 * All authoritative hold creation occurs through the verified database operation.
 */
export async function acquireAppointmentSlotHold(
  params: AcquireHoldParams
): Promise<AcquireHoldResult> {
  const holdMinutes = params.holdDurationMinutes || 10;
  const timeFormatted = params.time.length === 5 ? `${params.time}:00` : params.time;

  try {
    const { data, error } = await supabase.rpc("acquire_appointment_slot_hold", {
      p_clinic_id: params.clinicId,
      p_doctor_id: params.doctorId || null,
      p_date: params.date,
      p_time: timeFormatted,
      p_batch_time: params.batchTime || params.time.slice(0, 5),
      p_patient_name: params.patientName,
      p_patient_email: params.patientEmail || null,
      p_patient_contact: params.patientContact || null,
      p_patient_address: params.patientAddress || null,
      p_patient_gender: params.patientGender || null,
      p_patient_birthdate: params.patientBirthdate || null,
      p_emergency_contact_name: params.emergencyContactName || null,
      p_emergency_contact_phone: params.emergencyContactPhone || null,
      p_emergency_contact_relationship: params.emergencyContactRelationship || null,
      p_notes: params.notes || null,
      p_clinic_note: params.clinicNote || null,
      p_questionnaire_answers: params.questionnaireAnswers || null,
      p_skin_photo_url: params.skinPhotoUrl || null,
      p_ai_condition_name: params.aiConditionName || null,
      p_ai_confidence: params.aiConfidence != null ? params.aiConfidence : null,
      p_condition_id: params.conditionId || null,
      p_primary_scan_id: params.primaryScanId || null,
      p_hold_duration_minutes: holdMinutes,
      p_user_id: params.userId,
    });

    if (!error && data) {
      if (typeof data === "object") {
        if (data.success) {
          return {
            success: true,
            appointmentId: data.appointment_id,
            paymentReference: data.payment_reference,
            paymentAmount: Number(data.payment_amount ?? data.fee ?? 500),
            holdExpiresAt: data.hold_expires_at,
            paymentStatus: data.payment_status as AppointmentPaymentStatus,
            clinicName: data.clinic_name,
          };
        } else {
          return {
            success: false,
            code: data.code || data.error || "HOLD_FAILED",
            message: data.message || "Failed to acquire appointment hold.",
          };
        }
      }
    }

    if (error) {
      return {
        success: false,
        code: error.code || "DB_ERROR",
        message: error.message || "Database error acquiring slot hold.",
      };
    }
  } catch (err: any) {
    console.error("[AppointmentPaymentService] acquire hold exception:", err);
    return {
      success: false,
      code: "EXCEPTION",
      message: err?.message || "An unexpected error occurred while reserving the consultation slot.",
    };
  }

  return {
    success: false,
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred while reserving the consultation slot.",
  };
}

/**
 * Authoritatively processes a simulated payment for an appointment via Postgres RPC `process_simulated_appointment_payment`.
 * The browser never declares an appointment paid directly; all state transitions and queue allocation
 * occur through verified server-side/database operations.
 */
export async function processSimulatedAppointmentPayment(
  appointmentId: string,
  outcome: SimulatedPaymentOutcome,
  method = "simulated_card"
): Promise<ProcessSimulatedPaymentResult> {
  if (!isSimulatedPaymentEnabled()) {
    return {
      success: false,
      code: "SIMULATION_DISABLED",
      message: "Simulated appointment payment is disabled in this environment.",
    };
  }

  if (!appointmentId) {
    return {
      success: false,
      code: "MISSING_APPOINTMENT_ID",
      message: "Appointment ID is required to process payment.",
    };
  }

  try {
    const { data, error } = await supabase.rpc("process_simulated_appointment_payment", {
      p_appointment_id: appointmentId,
      p_simulated_outcome: outcome,
      p_simulated_method: method,
    });

    if (!error && data) {
      if (typeof data === "object") {
        return {
          success: Boolean(data.success),
          appointmentId: data.appointment_id || appointmentId,
          paymentStatus: data.payment_status as AppointmentPaymentStatus,
          queueNumber: data.queue_number != null ? Number(data.queue_number) : undefined,
          paymentReference: data.payment_reference || data.reference_number,
          paidAt: data.paid_at,
          holdExpiresAt: data.hold_expires_at,
          canRetry: data.can_retry,
          code: data.code || data.error,
          message: data.message,
        };
      }
    }

    if (error) {
      return {
        success: false,
        code: error.code || "DB_ERROR",
        message: error.message || "Database error executing simulated payment.",
        canRetry: true,
      };
    }
  } catch (err: any) {
    console.error("[AppointmentPaymentService] process simulated payment exception:", err);
    return {
      success: false,
      code: "EXCEPTION",
      message: err?.message || "An unexpected error occurred during simulated payment.",
      canRetry: true,
    };
  }

  return {
    success: false,
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred during simulated payment.",
  };
}

/**
 * Explicitly cancels an active slot hold and releases the reserved doctor time slot via database RPC.
 */
export async function cancelAppointmentSlotHold(
  appointmentId: string
): Promise<{ success: boolean; message?: string }> {
  if (!appointmentId) return { success: false, message: "Missing appointment ID." };

  try {
    const { data, error } = await supabase.rpc("cancel_appointment_hold", {
      p_appointment_id: appointmentId,
    });

    if (!error && data?.success) {
      return { success: true, message: data.message };
    }

    return {
      success: false,
      message: data?.message || error?.message || "Failed to cancel hold.",
    };
  } catch (err: any) {
    return { success: false, message: err?.message || "Error cancelling hold." };
  }
}

/**
 * Triggers clean-up of expired appointment holds in the database via RPC.
 */
export async function releaseExpiredAppointmentHolds(): Promise<{
  success: boolean;
  releasedCount?: number;
}> {
  try {
    const { data, error } = await supabase.rpc("release_expired_appointment_holds");
    if (!error && data) {
      if (typeof data === "object" && data.success) {
        return { success: true, releasedCount: Number(data.released_count) || 0 };
      }
      if (typeof data === "number") {
        return { success: true, releasedCount: data };
      }
    }
    return { success: false, releasedCount: 0 };
  } catch {
    return { success: false, releasedCount: 0 };
  }
}
