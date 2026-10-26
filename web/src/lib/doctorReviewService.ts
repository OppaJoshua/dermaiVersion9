/**
 * doctorReviewService.ts
 *
 * Handles reading/writing to the `doctor_ai_review` table.
 * This table tracks every completed consultation where the doctor
 * provided a final diagnosis so admin can compare it against the
 * original AI prediction and compute model accuracy.
 */

import { supabase } from "@/lib/supabaseClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorAiReviewItem {
  /** Short display ID (first 8 chars of the UUID row id) */
  id: string;
  /** Full UUID of the doctor_ai_review row */
  reviewId: string;
  appointmentId: string;
  patientId?: string;
  doctorId?: string;
  /** Display name of the patient */
  patient: string;
  /** Display name of the doctor, formatted as "Dr. Name" */
  doctor: string;
  /** The condition predicted by the AI (null for direct consultations) */
  aiPrediction?: string;
  /** AI confidence 0-100, undefined for direct consultations */
  confidence?: number;
  /** The doctor's final clinical diagnosis */
  finalDiagnosis: string;
  /** Computed validation result stored in DB: 'Correct' | 'Wrong' | null */
  validationResult?: "Correct" | "Wrong" | null;
  /** Free-text notes by the doctor */
  doctorNotes?: string;
  /** ISO timestamp when the doctor reviewed/completed the appointment */
  reviewedAt: string;
  /** True for appointments that did not go through an AI scan */
  isDirectConsultation: boolean;
}

export interface RecordDoctorAiReviewPayload {
  appointmentId: string;
  patientId?: string;
  doctorId?: string;
  patientName?: string;
  doctorName?: string;
  aiPrediction?: string;
  confidence?: number;
  finalDiagnosis: string;
  doctorNotes?: string;
  reviewedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDiagnosis(value = "") {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function computeValidationResult(
  aiPrediction?: string,
  finalDiagnosis?: string
): "Correct" | "Wrong" | null {
  if (!aiPrediction || !finalDiagnosis) return null;
  if (
    aiPrediction.toLowerCase().includes("direct consultation") ||
    aiPrediction.toLowerCase().includes("no ai")
  ) {
    return null;
  }
  const ai = normalizeDiagnosis(aiPrediction);
  const doc = normalizeDiagnosis(finalDiagnosis);
  if (!ai || !doc) return null;
  return ai === doc || doc.includes(ai) || ai.includes(doc) ? "Correct" : "Wrong";
}

/** Normalise a raw name string to "Dr. Name" format, or "—" if empty. */
function formatDoctorName(raw: string | null | undefined): string {
  if (!raw) return "—";
  const trimmed = raw.trim();
  if (!trimmed) return "—";
  return /^dr\.\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

// ---------------------------------------------------------------------------
// Write: upsert a review record when the doctor marks an appointment done
// ---------------------------------------------------------------------------

export async function recordDoctorAiReview(
  payload: RecordDoctorAiReviewPayload
): Promise<void> {
  const {
    appointmentId,
    patientId,
    doctorId,
    patientName,
    doctorName,
    aiPrediction,
    confidence,
    finalDiagnosis,
    doctorNotes,
    reviewedAt,
  } = payload;

  const isDirectConsultation =
    !aiPrediction ||
    aiPrediction.toLowerCase().includes("direct consultation") ||
    aiPrediction.toLowerCase().includes("no ai");

  const validationResult = isDirectConsultation
    ? null
    : computeValidationResult(aiPrediction, finalDiagnosis);

  const row = {
    appointment_id: appointmentId,
    patient_id: patientId ?? null,
    doctor_id: doctorId ?? null,
    patient_name: patientName ?? null,
    // Store formatted name so the admin table can display it immediately
    doctor_name: doctorName ? formatDoctorName(doctorName) : null,
    ai_prediction: isDirectConsultation ? null : (aiPrediction ?? null),
    confidence: isDirectConsultation ? null : (confidence != null ? Math.round(confidence) : null),
    final_diagnosis: finalDiagnosis,
    validation_result: validationResult,
    doctor_notes: doctorNotes ?? null,
    reviewed_at: reviewedAt ?? new Date().toISOString(),
    is_direct_consultation: isDirectConsultation,
  };

  const { error } = await supabase
    .from("doctor_ai_review")
    .upsert(row, { onConflict: "appointment_id" });

  if (error) {
    console.warn("[doctorReviewService] upsert error:", error.message);
    throw error;
  }

  // Notify admin page to refresh
  window.dispatchEvent(new CustomEvent("dermai_doctor_reviews_updated"));

  // Mirror in localStorage for cross-tab sync
  try {
    const stored = localStorage.getItem("dermai_doctor_ai_reviews");
    const parsed: any[] = stored ? JSON.parse(stored) : [];
    const idx = parsed.findIndex((r) => r.appointment_id === appointmentId);
    if (idx >= 0) {
      parsed[idx] = { ...parsed[idx], ...row };
    } else {
      parsed.push(row);
    }
    localStorage.setItem("dermai_doctor_ai_reviews", JSON.stringify(parsed));
  } catch {
    // localStorage failure is non-critical
  }
}

// ---------------------------------------------------------------------------
// Read: fetch all review records for the admin table
// Primary source: doctor_ai_review table.
// Fallback:       completed patient_appointment rows with a parseable
//                 doctor_note (handles records created before the table
//                 existed).
// ---------------------------------------------------------------------------

export async function fetchAllDoctorAiReviews(): Promise<DoctorAiReviewItem[]> {
  // ── Primary: doctor_ai_review table ──────────────────────────────────────
  const { data: reviewRows, error: reviewError } = await supabase
    .from("doctor_ai_review")
    .select("*")
    .order("reviewed_at", { ascending: false });

  const reviewMap = new Map<string, DoctorAiReviewItem>();

  if (!reviewError && reviewRows && reviewRows.length > 0) {
    // Identify rows missing a doctor_name so we can enrich via clinic_doctor
    const missingDoctorIds = Array.from(
      new Set(
        (reviewRows as any[])
          .filter((r) => !r.doctor_name && r.doctor_id)
          .map((r) => String(r.doctor_id))
      )
    );

    const enrichedNameMap = new Map<string, string>();
    if (missingDoctorIds.length > 0) {
      const { data: cdRows } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name")
        .in("doctor_id", missingDoctorIds);
      if (cdRows) {
        for (const d of cdRows as any[]) {
          if (d.doctor_id && d.doctor_name) {
            enrichedNameMap.set(String(d.doctor_id), formatDoctorName(d.doctor_name));
          }
        }
      }
    }

    for (const row of reviewRows as any[]) {
      // Use stored name first, fall back to enriched lookup, then "—"
      const resolvedDoctor =
        row.doctor_name
          ? formatDoctorName(row.doctor_name)
          : row.doctor_id
            ? (enrichedNameMap.get(String(row.doctor_id)) ?? "—")
            : "—";

      const item: DoctorAiReviewItem = {
        id: String(row.id ?? row.appointment_id ?? "").slice(0, 8),
        reviewId: String(row.id ?? ""),
        appointmentId: String(row.appointment_id ?? ""),
        patientId: row.patient_id ?? undefined,
        doctorId: row.doctor_id ?? undefined,
        patient: row.patient_name || "Unknown Patient",
        doctor: resolvedDoctor,
        aiPrediction: row.ai_prediction ?? undefined,
        confidence: row.confidence != null ? Number(row.confidence) : undefined,
        finalDiagnosis: row.final_diagnosis || "",
        validationResult: row.validation_result ?? null,
        doctorNotes: row.doctor_notes ?? undefined,
        reviewedAt: row.reviewed_at ?? "",
        isDirectConsultation: Boolean(row.is_direct_consultation),
      };
      reviewMap.set(item.appointmentId, item);
    }
  } else if (reviewError) {
    console.warn("[doctorReviewService] fetch doctor_ai_review error:", reviewError.message);
  }

  // ── Fallback: completed patient_appointment rows ──────────────────────────
  try {
    const { data: apptRows, error: apptError } = await supabase
      .from("patient_appointment")
      .select(
        "appointment_id, patient_name, patient_email, assigned_doctor_id, doctor_note, ai_condition_name, ai_confidence, doctor_reviewed_at, status, user_id"
      )
      .eq("status", "completed")
      .not("doctor_note", "is", null)
      .order("doctor_reviewed_at", { ascending: false })
      .limit(500);

    if (!apptError && apptRows && apptRows.length > 0) {
      // Batch-fetch doctor names from clinic_doctor
      const assignedIds = Array.from(
        new Set(
          (apptRows as any[])
            .map((r) => r.assigned_doctor_id)
            .filter(Boolean)
            .map(String)
        )
      );

      const doctorNameMap = new Map<string, string>();
      if (assignedIds.length > 0) {
        const { data: docRows } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, doctor_name")
          .in("doctor_id", assignedIds);
        if (docRows) {
          for (const d of docRows as any[]) {
            if (d.doctor_id && d.doctor_name) {
              doctorNameMap.set(String(d.doctor_id), formatDoctorName(d.doctor_name));
            }
          }
        }
      }

      for (const row of apptRows as any[]) {
        const apptId = String(row.appointment_id ?? "");
        if (reviewMap.has(apptId)) continue;

        // Parse "Diagnosis: X | Note: Y" from doctor_note
        let docDiagnosis = "";
        let docNote = "";
        if (row.doctor_note) {
          const match = row.doctor_note.match(
            /^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is
          );
          if (match) {
            docDiagnosis = match[1]?.trim() || "";
            docNote = match[2]?.trim() || "";
          } else {
            docDiagnosis = row.doctor_note.trim();
          }
        }

        if (!docDiagnosis) continue;

        const isDirectConsultation =
          !row.ai_condition_name ||
          row.ai_condition_name.toLowerCase().includes("direct consultation") ||
          row.ai_condition_name.toLowerCase().includes("no ai");

        const validationResult = isDirectConsultation
          ? null
          : computeValidationResult(row.ai_condition_name, docDiagnosis);

        const doctorDisplay = row.assigned_doctor_id
          ? (doctorNameMap.get(String(row.assigned_doctor_id)) ?? "—")
          : "—";

        const item: DoctorAiReviewItem = {
          id: apptId.slice(0, 8),
          reviewId: apptId,
          appointmentId: apptId,
          patientId: row.user_id ?? undefined,
          doctorId: row.assigned_doctor_id ?? undefined,
          patient: row.patient_name || row.patient_email || "Unknown Patient",
          doctor: doctorDisplay,
          aiPrediction: isDirectConsultation ? undefined : (row.ai_condition_name ?? undefined),
          confidence: row.ai_confidence != null ? Number(row.ai_confidence) : undefined,
          finalDiagnosis: docDiagnosis,
          validationResult,
          doctorNotes: docNote || undefined,
          reviewedAt: row.doctor_reviewed_at || "",
          isDirectConsultation,
        };
        reviewMap.set(apptId, item);
      }
    }
  } catch (fallbackErr) {
    console.warn("[doctorReviewService] fallback fetch warning:", fallbackErr);
  }

  // Sort: newest first
  return Array.from(reviewMap.values()).sort((a, b) =>
    b.reviewedAt.localeCompare(a.reviewedAt)
  );
}
