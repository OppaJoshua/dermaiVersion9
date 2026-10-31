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

      let answerEn = item.answer || "";
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
