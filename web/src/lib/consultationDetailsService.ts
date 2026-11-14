/**
 * ============================================================================
 * DermAI — Consultation Details & Pre-Screening Questionnaire Service
 * ============================================================================
 */

import { QUESTIONNAIRE_QUESTIONS } from "../data/questionnaireData";

export interface NormalizedQuestionnaireAnswer {
  number: number;
  id: string;
  question: string;
  tagalogQuestion?: string;
  answer: string;
  tagalogAnswer?: string;
  role?: string;
  severity?: number;
  points?: number;
}

/**
 * Normalizes raw questionnaire data from patient_appointment or ai_scan_result
 * into ordered, patient-facing question-and-answer items.
 *
 * Strictly filters out operational metadata (such as reschedule status, payment flags,
 * and appointment history) so that non-question metadata is never fabricated as
 * medical questionnaire answers.
 */
export function extractConsultationQuestionnaire(raw: any): NormalizedQuestionnaireAnswer[] {
  if (!raw) return [];

  // Support JSON-string representations
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return extractConsultationQuestionnaire(parsed);
    } catch {
      return [];
    }
  }

  const list: NormalizedQuestionnaireAnswer[] = [];

  // Operational metadata keys that are NOT clinical pre-questionnaire answers
  const ignoredKeys = new Set([
    "appointment_history",
    "reschedule_requested",
    "reschedule_date",
    "reschedule_time",
    "reschedule_reason",
    "needs_patient_reschedule",
    "primary_scan_id",
    "is_paid",
    "payment_status",
    "previous_doctor_id",
    "reassigned_at",
    "reassigned_by",
    "latest_doctor_rejection_at",
    "latest_declined_doctor_id",
    "latest_declined_doctor_name",
    "latest_decline_reason",
    "reselection_status",
    "reselection_required",
    "doctor_declined",
    "workflow_status",
    "bodylocation",
    "body_location",
    "payment_reference",
    "payment_amount",
    "payment_method",
    "paymentmethod",
    "questionnairedata",
    "is_walk_in",
  ]);

  // Case 1: Array of question-answer objects (Standard ScanSkin format)
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const qId = String(item.id || item.question_key || item.key || "").toLowerCase();
      if (ignoredKeys.has(qId)) continue;

      const qDef = QUESTIONNAIRE_QUESTIONS.find(
        (q) => q.id.toLowerCase() === qId || q.number === item.number
      );

      let answerEn = item.answer || item.answer_value || "";
      let answerTl = item.tagalogAnswer || "";
      const optionIds = Array.isArray(item.selectedOptionIds)
        ? item.selectedOptionIds.map(String)
        : Array.isArray(item.optionIds)
        ? item.optionIds.map(String)
        : [];

      if (qDef && optionIds.length > 0 && (!answerEn || answerEn === "Not answered")) {
        const matching = qDef.options.filter((o) => optionIds.includes(o.id));
        if (matching.length > 0) {
          answerEn = matching.map((o) => o.labelEn).join("; ");
          answerTl = matching.map((o) => o.labelTl).join("; ");
        }
      }

      if (answerEn && answerEn !== "Not answered" && answerEn !== "Hindi sinagot") {
        list.push({
          number: qDef?.number || item.number || list.length + 1,
          id: qDef?.id || qId || `q${list.length + 1}`,
          question: qDef?.titleEn || item.question || `Question ${list.length + 1}`,
          tagalogQuestion: qDef?.titleTl || item.tagalogQuestion,
          answer: answerEn,
          tagalogAnswer: answerTl,
          role: qDef?.role || item.role,
          severity: typeof item.severity === "number" ? item.severity : undefined,
          points: typeof item.points === "number" ? item.points : undefined,
        });
      }
    }
    list.sort((a, b) => a.number - b.number);
    return list;
  }

  // Case 2: Object with 'answers' or 'questions' property
  if (typeof raw === "object") {
    if (Array.isArray(raw.answers)) {
      return extractConsultationQuestionnaire(raw.answers);
    }
    if (Array.isArray(raw.questions)) {
      return extractConsultationQuestionnaire(raw.questions);
    }
    if (raw.answers && typeof raw.answers === "string") {
      try {
        const parsed = JSON.parse(raw.answers);
        if (Array.isArray(parsed)) return extractConsultationQuestionnaire(parsed);
      } catch {}
    }
    if (raw.questionnaireData) {
      let qData = raw.questionnaireData;
      if (typeof qData === "string") {
        try { qData = JSON.parse(qData); } catch {}
      }
      if (Array.isArray(qData)) {
        return extractConsultationQuestionnaire(qData);
      }
    }

    // Case 3: Key-value map { q1: [...], q2: [...] }
    for (const q of QUESTIONNAIRE_QUESTIONS) {
      const val = raw[q.id] || raw[q.id.toUpperCase()];
      if (val !== undefined && val !== null) {
        let optionIds: string[] = [];
        if (Array.isArray(val)) {
          optionIds = val.map(String);
        } else if (typeof val === "string") {
          optionIds = [val];
        }

        const chosenOptions = q.options.filter((o) => optionIds.includes(o.id));
        let answerText = "";
        let answerTl = "";
        if (chosenOptions.length > 0) {
          answerText = chosenOptions.map((o) => o.labelEn).join("; ");
          answerTl = chosenOptions.map((o) => o.labelTl).join("; ");
        } else if (typeof val === "string" && val.trim() && !q.options.some((o) => o.id === val)) {
          answerText = val.trim();
        }

        if (answerText) {
          list.push({
            number: q.number,
            id: q.id,
            question: q.titleEn,
            tagalogQuestion: q.titleTl,
            answer: answerText,
            tagalogAnswer: answerTl,
            role: q.role,
          });
        }
      }
    }
  }

  list.sort((a, b) => a.number - b.number);
  return list;
}
