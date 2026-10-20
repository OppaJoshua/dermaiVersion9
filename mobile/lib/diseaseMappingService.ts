/**
 * DermAI — Evidence-Based Rule-Based Disease Mapping Service
 * Version: 1.0.0
 *
 * Grounded in clinical evidence from:
 * - American Academy of Dermatology (AAD)
 * - DermNet NZ
 * - Cleveland Clinic
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. ResNet50 is the sole source of image prediction and confidence score.
 *    Questionnaire answers NEVER alter, scale, replace, or overwrite ResNet50 output.
 * 2. This service is a rule-based screening support layer, NOT a machine-learning model,
 *    and NOT a clinical diagnosis.
 * 3. Q14 (warning signs) is an independent safety/referral rule, never a disease-mapping feature.
 * 4. Q13 (daily-life impact) is contextual quality-of-life information.
 * 5. Q15 (family/hormone history) provides supporting context only; cannot diagnose on its own.
 */

import { QUESTIONNAIRE_QUESTIONS } from "./questionnaireData";
import type { SupportedCondition } from "./questionnaireData";

export type SupportLevel =
  | "Strong support"
  | "Moderate support"
  | "Limited / no specific support";

export interface ConditionEvaluation {
  condition: SupportedCondition;
  supportLevel: SupportLevel;
  supportingFindings: string[];
  limitations: string[];
  evidenceScore: number; // Transparent count of matched primary/supporting criteria
}

export interface SafetyAlert {
  level: "emergency" | "urgent" | "none";
  title: string;
  message: string;
  actionRequired: string;
}

export interface DiseaseMappingResult {
  version: "1.0.0";
  evaluatedAt: string;
  conditions: Record<SupportedCondition, ConditionEvaluation>;
  primarySupportedCondition: SupportedCondition | null;
  safetyAlert: SafetyAlert;
  contextualImpact: {
    level: "none" | "slight" | "moderate" | "severe";
    summary: string;
  };
  disclaimer: string;
}

export interface AIQuestionnaireComparison {
  aiPredictedCondition: string;
  aiConfidence: number;
  questionnaireSupportForAIClass: SupportLevel;
  questionnairePrimarySupported: SupportedCondition | null;
  agreementStatus: "aligned" | "differing" | "inconclusive";
  summary: string;
  recommendation: string;
}

/**
 * Normalizes user answer map into an array of string IDs for each question ID (q1 -> ["q1_..."])
 */
export function normalizeAnswers(
  rawAnswers: Record<string, string | string[] | number | number[]>
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  for (const q of QUESTIONNAIRE_QUESTIONS) {
    const rawVal = rawAnswers[q.id];
    if (rawVal === undefined || rawVal === null) {
      normalized[q.id] = [];
      continue;
    }

    if (Array.isArray(rawVal)) {
      normalized[q.id] = rawVal.map((v) => {
        if (typeof v === "number") {
          return q.options[v]?.id || "";
        }
        return String(v);
      }).filter(Boolean);
    } else if (typeof rawVal === "number") {
      const opt = q.options[rawVal];
      normalized[q.id] = opt ? [opt.id] : [];
    } else {
      normalized[q.id] = [String(rawVal)];
    }
  }

  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISEASE MAPPING RULES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Acne Vulgaris Mapping
 *
 * Evidence Rationale:
 * - AAD: Acne is characterized by non-inflammatory comedones (blackheads/whiteheads)
 *   and inflammatory lesions (papules, pustules, nodules).
 * - DermNet: Oily skin and sebaceous site involvement (face, chest, back) provide supporting context.
 * - Constraint: Location or oiliness ALONE is never diagnostic.
 */
function evaluateAcneVulgaris(ans: Record<string, string[]>): ConditionEvaluation {
  const findings: string[] = [];
  const limitations: string[] = [];
  let primaryPoints = 0;
  let supportingPoints = 0;

  const q5 = ans["q5"] || [];
  const hasBlackheads = q5.includes("q5_blackheads");
  const hasWhiteheads = q5.includes("q5_whiteheads");
  const hasPimples = q5.includes("q5_pimples");
  const hasPusBumps = q5.includes("q5_pus_bumps");
  const hasDeepLumps = q5.includes("q5_deep_lumps");

  if (hasBlackheads || hasWhiteheads) {
    primaryPoints += 2;
    findings.push("Presence of comedones (blackheads/whiteheads) characteristic of pilosebaceous occlusion");
  }
  if (hasPimples) {
    primaryPoints += 2;
    findings.push("Inflammatory papules/pimples typical of acne vulgaris");
  }
  if (hasPusBumps) {
    primaryPoints += 2;
    findings.push("Pustular inflammatory lesions filled with pus");
  }
  if (hasDeepLumps) {
    primaryPoints += 2;
    findings.push("Deep, painful inflammatory nodules or cysts");
  }

  // Supporting context (NOT proof on their own)
  const q4 = ans["q4"] || [];
  if (q4.includes("q4_oily_greasy")) {
    supportingPoints += 1;
    findings.push("Oily/greasy skin surface consistent with sebum hyperproduction");
  }

  const q7 = ans["q7"] || [];
  const sebaceousLocations = ["q7_face", "q7_chest", "q7_back", "q7_shoulders"];
  const matchedLocations = sebaceousLocations.filter((loc) => q7.includes(loc));
  if (matchedLocations.length > 0) {
    supportingPoints += 1;
    findings.push("Lesion distribution in sebaceous areas (face, chest, back, shoulders)");
  }

  const q6 = ans["q6"] || [];
  if (q6.includes("q6_pus")) {
    supportingPoints += 1;
  }

  // Support level determination
  let supportLevel: SupportLevel;
  if (primaryPoints >= 4) {
    supportLevel = "Strong support";
  } else if (primaryPoints >= 2) {
    supportLevel = "Moderate support";
  } else {
    supportLevel = "Limited / no specific support";
    if (primaryPoints === 0 && supportingPoints > 0) {
      limitations.push("Location or oiliness reported without primary acne comedones or pustules is insufficient for support");
    } else {
      limitations.push("Characteristic acne lesions (comedones, pimples, or nodules) were not reported");
    }
  }

  return {
    condition: "Acne Vulgaris",
    supportLevel,
    supportingFindings: findings,
    limitations,
    evidenceScore: primaryPoints + supportingPoints,
  };
}

/**
 * 2. Atopic Dermatitis Mapping
 *
 * Evidence Rationale:
 * - AAD & Cleveland Clinic: Hallmark is pruritus (itching), xerosis (dryness), roughness/scaling,
 *   and chronicity/recurrence.
 * - Flexural locations (elbow folds, knees, wrists) and atopic family history (Q15) provide strong support.
 * - Caution: Overlaps with Contact Dermatitis.
 */
function evaluateAtopicDermatitis(ans: Record<string, string[]>): ConditionEvaluation {
  const findings: string[] = [];
  const limitations: string[] = [];
  let primaryPoints = 0;
  let supportingPoints = 0;

  const q1 = ans["q1"] || [];
  const isItchingIntense = q1.includes("q1_intense");
  const isItchingModerate = q1.includes("q1_moderate");
  if (isItchingIntense) {
    primaryPoints += 2;
    findings.push("Intense, constant pruritus (itching) — hallmark of atopic flare");
  } else if (isItchingModerate) {
    primaryPoints += 1;
    findings.push("Moderate pruritus (itching) reported");
  }

  const q4 = ans["q4"] || [];
  const isDryOrRough = q4.includes("q4_dry_rough");
  const isCracked = q4.includes("q4_cracked");
  const isScaly = q4.includes("q4_scaly") || q4.includes("q4_flaky_peeling");
  if (isDryOrRough || isCracked || isScaly) {
    primaryPoints += 2;
    findings.push("Impaired skin barrier: dry, rough, cracked, flaky, or scaly surface");
  }

  const q12 = ans["q12"] || [];
  if (q12.includes("q12_yes")) {
    primaryPoints += 2;
    findings.push("Chronic relapsing course: history of repeated, recurring episodes");
  }

  // Supporting context
  const q7 = ans["q7"] || [];
  const flexuralSites = ["q7_elbows", "q7_behind_knees", "q7_wrists"];
  const matchedFlexural = flexuralSites.filter((s) => q7.includes(s));
  if (matchedFlexural.length > 0) {
    supportingPoints += 1;
    findings.push("Flexural distribution typical of atopic dermatitis (creases of elbows, knees, wrists)");
  }

  const q15 = ans["q15"] || [];
  if (q15.includes("q15_family_atopic")) {
    supportingPoints += 1;
    findings.push("Personal/family history of atopic triad (atopic eczema, asthma, allergic rhinitis)");
  }

  const q6 = ans["q6"] || [];
  if (q6.includes("q6_clear_fluid") || q6.includes("q6_yellow_crust")) {
    supportingPoints += 1;
    findings.push("Fluid oozing or crusting consistent with active acute/subacute eczema flare");
  }

  // Support level determination
  let supportLevel: SupportLevel;
  if (primaryPoints >= 5 && (supportingPoints >= 1 || primaryPoints >= 6)) {
    supportLevel = "Strong support";
  } else if (primaryPoints >= 3) {
    supportLevel = "Moderate support";
    limitations.push("Features overlap with Contact Dermatitis or lack full chronic/flexural pattern");
  } else {
    supportLevel = "Limited / no specific support";
    limitations.push("Missing core triad of persistent pruritus, barrier dryness/scaling, and recurring history");
  }

  return {
    condition: "Atopic Dermatitis",
    supportLevel,
    supportingFindings: findings,
    limitations,
    evidenceScore: primaryPoints + supportingPoints,
  };
}

/**
 * 3. Contact Dermatitis Mapping
 *
 * Evidence Rationale:
 * - AAD & DermNet: Compatible acute symptoms (itching, burning/stinging, blisters, peeling, oozing)
 *   MUST be paired with a plausible exposure history (Q8).
 * - Constraint: Exposure ALONE is not sufficient for strong support.
 */
function evaluateContactDermatitis(ans: Record<string, string[]>): ConditionEvaluation {
  const findings: string[] = [];
  const limitations: string[] = [];
  let exposurePoints = 0;
  let symptomPoints = 0;

  const q8 = ans["q8"] || [];
  const plausibleExposures = [
    "q8_skincare",
    "q8_cosmetics",
    "q8_soap",
    "q8_detergent",
    "q8_jewelry",
    "q8_fragrance",
    "q8_plant",
    "q8_chemical",
    "q8_topical_med",
  ];
  const matchedExposures = plausibleExposures.filter((e) => q8.includes(e));
  if (matchedExposures.length > 0) {
    exposurePoints += 2;
    findings.push("Plausible trigger contact reported (skincare, soap, detergent, metal, chemical, plant, or topical product)");
  }

  const q1 = ans["q1"] || [];
  if (q1.includes("q1_moderate") || q1.includes("q1_intense")) {
    symptomPoints += 1;
    findings.push("Significant pruritus (itching) characteristic of contact dermatitis");
  }

  const q2 = ans["q2"] || [];
  if (q2.includes("q2_mild") || q2.includes("q2_moderate") || q2.includes("q2_severe")) {
    symptomPoints += 1;
    findings.push("Burning, stinging, or tenderness typical of irritant/allergic contact reaction");
  }

  const q4 = ans["q4"] || [];
  if (q4.includes("q4_cracked") || q4.includes("q4_flaky_peeling") || q4.includes("q4_dry_rough")) {
    symptomPoints += 1;
    findings.push("Surface barrier disruption (cracking, peeling, or flaking)");
  }

  const q5 = ans["q5"] || [];
  if (q5.includes("q5_fluid_blisters") || q5.includes("q5_swollen_raised")) {
    symptomPoints += 2;
    findings.push("Vesicles (fluid-filled blisters) or raised plaques at contact site");
  }

  const q6 = ans["q6"] || [];
  if (q6.includes("q6_clear_fluid") || q6.includes("q6_yellow_crust")) {
    symptomPoints += 1;
    findings.push("Active fluid oozing or crusting compatible with acute contact dermatitis");
  }

  // Support level determination
  let supportLevel: SupportLevel;
  if (exposurePoints >= 2 && symptomPoints >= 3) {
    supportLevel = "Strong support";
  } else if (exposurePoints >= 2 && symptomPoints >= 1) {
    supportLevel = "Moderate support";
    limitations.push("Exposure reported, but symptom intensity or morphology is only partially compatible");
  } else if (exposurePoints === 0 && symptomPoints >= 3) {
    supportLevel = "Moderate support";
    limitations.push("Compatible acute inflammatory rash, but no identifiable contact exposure was recognized");
  } else if (exposurePoints >= 2 && symptomPoints === 0) {
    supportLevel = "Limited / no specific support";
    limitations.push("Reported product/chemical exposure alone without compatible inflammatory symptoms is not sufficient");
  } else {
    supportLevel = "Limited / no specific support";
    limitations.push("Neither clear contact exposure nor acute contact rash symptoms were reported");
  }

  return {
    condition: "Contact Dermatitis",
    supportLevel,
    supportingFindings: findings,
    limitations,
    evidenceScore: exposurePoints + symptomPoints,
  };
}

/**
 * 4. Melasma Mapping
 *
 * Evidence Rationale:
 * - AAD & Cleveland Clinic: Acquired hyperpigmentation; brown/gray/darker flat patches,
 *   facial location (cheeks, forehead, upper lip), darkening with sunlight exposure.
 * - Pregnancy, hormonal contraceptives (Q15), and family history provide supporting context.
 * - Constraint: No single answer is diagnostic.
 */
function evaluateMelasma(ans: Record<string, string[]>): ConditionEvaluation {
  const findings: string[] = [];
  const limitations: string[] = [];
  let primaryPoints = 0;
  let supportingPoints = 0;

  const q3 = ans["q3"] || [];
  if (q3.includes("q3_brown_dark")) {
    primaryPoints += 2;
    findings.push("Hyperpigmented macules/patches: brown, gray, or darker than surrounding skin");
  }

  const q4 = ans["q4"] || [];
  if (q4.includes("q4_smooth_flat")) {
    primaryPoints += 2;
    findings.push("Smooth, macular skin surface with no textural thickening or roughness");
  }

  const q7 = ans["q7"] || [];
  if (q7.includes("q7_face")) {
    primaryPoints += 2;
    findings.push("Facial distribution (classic malar/centrofacial presentation)");
  }

  const q9 = ans["q9"] || [];
  if (q9.includes("q9_darker")) {
    primaryPoints += 2;
    findings.push("Patches darken or become noticeably more prominent following sunlight exposure");
  }

  // Supporting background (Q15)
  const q15 = ans["q15"] || [];
  if (q15.includes("q15_pregnant")) {
    supportingPoints += 1;
    findings.push("Pregnancy / recent childbirth ('chloasma / mask of pregnancy' hormonal influence)");
  }
  if (q15.includes("q15_hormone_therapy")) {
    supportingPoints += 1;
    findings.push("Hormonal contraception or hormone replacement therapy use");
  }
  if (q15.includes("q15_family_melasma")) {
    supportingPoints += 1;
    findings.push("Family history of melasma / pigmentary sensitivity");
  }

  // Absence of inflammatory lesions confirms macular nature
  const q5 = ans["q5"] || [];
  if (q5.includes("q5_none")) {
    supportingPoints += 1;
  }

  // Support level determination
  let supportLevel: SupportLevel;
  if (primaryPoints >= 6) {
    supportLevel = "Strong support";
  } else if (primaryPoints >= 4) {
    supportLevel = "Moderate support";
    limitations.push("Pigmentation pattern is present but incomplete (e.g. missing sun darkening or facial exclusivity)");
  } else {
    supportLevel = "Limited / no specific support";
    limitations.push("Lacks the characteristic flat brown/gray facial hyperpigmentation pattern");
  }

  return {
    condition: "Melasma",
    supportLevel,
    supportingFindings: findings,
    limitations,
    evidenceScore: primaryPoints + supportingPoints,
  };
}

/**
 * 5. Vitiligo Mapping
 *
 * Evidence Rationale:
 * - AAD & DermNet: Autoimmune melanocyte destruction producing depigmented (chalky white or lighter)
 *   macules/patches. Patches are smooth/flat without epidermal change.
 * - Change/spread over time (Q10) and rapid sunburn (Q9) provide supporting clues.
 * - Family/autoimmune history (Q15) provides supportive context.
 * - Constraint: White appearance ALONE is not diagnostic (must consider tinea versicolor, pityriasis alba).
 */
function evaluateVitiligo(ans: Record<string, string[]>): ConditionEvaluation {
  const findings: string[] = [];
  const limitations: string[] = [];
  let primaryPoints = 0;
  let supportingPoints = 0;

  const q3 = ans["q3"] || [];
  const isWhite = q3.includes("q3_white");
  if (isWhite) {
    primaryPoints += 2;
    findings.push("Depigmented macules/patches: chalky white or noticeably lighter than normal skin");
  }

  const q4 = ans["q4"] || [];
  if (q4.includes("q4_smooth_flat")) {
    primaryPoints += 2;
    findings.push("Smooth, macular skin surface without epidermal scale, atrophy, or induration");
  }

  const q10 = ans["q10"] || [];
  if (q10.includes("q10_spread_nearby") || q10.includes("q10_spread_distant") || q10.includes("q10_slight_spread")) {
    primaryPoints += 2;
    findings.push("Active progression: patches have expanded or appeared in new sites over time");
  }

  // Supporting clues
  const q9 = ans["q9"] || [];
  if (q9.includes("q9_burns_easily")) {
    supportingPoints += 1;
    findings.push("Affected areas sunburn easily due to total loss of protective melanin");
  }

  const q15 = ans["q15"] || [];
  if (q15.includes("q15_family_vitiligo")) {
    supportingPoints += 1;
    findings.push("Family history of vitiligo or associated autoimmune conditions (thyroid, alopecia, T1D)");
  }

  const q5 = ans["q5"] || [];
  if (q5.includes("q5_none")) {
    supportingPoints += 1;
  }

  // Support level determination
  let supportLevel: SupportLevel;
  if (isWhite && primaryPoints >= 6) {
    supportLevel = "Strong support";
  } else if (isWhite && primaryPoints >= 4) {
    supportLevel = "Moderate support";
    limitations.push("White/lighter patches are present, but lack progression or classic features; other hypopigmentary conditions must be considered");
  } else if (isWhite && primaryPoints < 4) {
    supportLevel = "Limited / no specific support";
    limitations.push("White appearance alone is not diagnostic; post-inflammatory hypopigmentation or tinea versicolor are possible differentials");
  } else {
    supportLevel = "Limited / no specific support";
    limitations.push("Absence of characteristic depigmented (white) flat skin patches");
  }

  return {
    condition: "Vitiligo",
    supportLevel,
    supportingFindings: findings,
    limitations,
    evidenceScore: primaryPoints + supportingPoints,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY (Q14) & CONTEXTUAL (Q13) EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Q14 Safety Evaluation
 *
 * Emergency:
 * - Facial or lip swelling / difficulty breathing (`q14_emergency_breathing`)
 *
 * Urgent:
 * - Pus or signs of infection (`q14_pus_infection`)
 * - Rapidly worsening redness, swelling, warmth, pain (`q14_rapid_worsening`)
 * - Rapidly changing skin patch or lesion (`q14_rapid_change`)
 * - Eye or vision changes (`q14_eye_vision`)
 */
export function evaluateSafetyWarnings(ans: Record<string, string[]>): SafetyAlert {
  const q14 = ans["q14"] || [];

  if (q14.includes("q14_emergency_breathing")) {
    return {
      level: "emergency",
      title: "Immediate Emergency Medical Attention Required",
      message:
        "Facial or lip swelling accompanied by difficulty breathing may indicate an acute, life-threatening allergic reaction (anaphylaxis) or severe angioedema.",
      actionRequired:
        "Call local emergency services (911 / emergency hotline) or proceed immediately to the nearest hospital emergency department.",
    };
  }

  const urgentFlags: string[] = [];
  if (q14.includes("q14_rapid_worsening")) urgentFlags.push("rapidly worsening redness/swelling/warmth/pain");
  if (q14.includes("q14_pus_infection")) urgentFlags.push("pus or signs of secondary infection");
  if (q14.includes("q14_rapid_change")) urgentFlags.push("rapidly changing skin patch or lesion");
  if (q14.includes("q14_eye_vision")) urgentFlags.push("eye redness or vision changes");

  if (urgentFlags.length > 0) {
    return {
      level: "urgent",
      title: "Prompt Medical Evaluation Recommended",
      message: `You reported warning signs that warrant professional clinical evaluation: ${urgentFlags.join(", ")}.`,
      actionRequired:
        "Schedule an urgent in-person consultation with a dermatologist or general practitioner within 24–48 hours.",
    };
  }

  return {
    level: "none",
    title: "No Red Flag Warning Signs Reported",
    message: "No acute systemic or infectious red flag symptoms were reported in the pre-screening.",
    actionRequired: "Proceed with standard dermatological consultation as appropriate.",
  };
}

/**
 * Q13 Contextual Daily-Life Impact Summary
 */
function evaluateContextualImpact(ans: Record<string, string[]>): {
  level: "none" | "slight" | "moderate" | "severe";
  summary: string;
} {
  const q13 = ans["q13"] || [];
  if (q13.includes("q13_severe")) {
    return {
      level: "severe",
      summary: "Significant quality-of-life burden: symptoms make daily activities difficult or cause notable distress.",
    };
  }
  if (q13.includes("q13_moderate")) {
    return {
      level: "moderate",
      summary: "Moderate impact: symptoms sometimes interrupt daily routines or cause emotional discomfort.",
    };
  }
  if (q13.includes("q13_slight")) {
    return {
      level: "slight",
      summary: "Mild impact: slight discomfort without substantial disruption to daily activities.",
    };
  }
  return {
    level: "none",
    summary: "No significant disruption to daily activities reported.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DISEASE MAPPING SERVICE ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateDiseaseMapping(
  rawAnswers: Record<string, string | string[] | number | number[]>
): DiseaseMappingResult {
  const ans = normalizeAnswers(rawAnswers);

  const acneResult = evaluateAcneVulgaris(ans);
  const atopicResult = evaluateAtopicDermatitis(ans);
  const contactResult = evaluateContactDermatitis(ans);
  const melasmaResult = evaluateMelasma(ans);
  const vitiligoResult = evaluateVitiligo(ans);

  const conditions: Record<SupportedCondition, ConditionEvaluation> = {
    "Acne Vulgaris": acneResult,
    "Atopic Dermatitis": atopicResult,
    "Contact Dermatitis": contactResult,
    Melasma: melasmaResult,
    Vitiligo: vitiligoResult,
  };

  // Identify highest supported condition (if any)
  const ranked = (Object.values(conditions) as ConditionEvaluation[]).sort(
    (a, b) => b.evidenceScore - a.evidenceScore
  );

  let primarySupportedCondition: SupportedCondition | null = null;
  if (ranked[0] && ranked[0].supportLevel !== "Limited / no specific support") {
    primarySupportedCondition = ranked[0].condition;
  }

  const safetyAlert = evaluateSafetyWarnings(ans);
  const contextualImpact = evaluateContextualImpact(ans);

  return {
    version: "1.0.0",
    evaluatedAt: new Date().toISOString(),
    conditions,
    primarySupportedCondition,
    safetyAlert,
    contextualImpact,
    disclaimer:
      "This is a preliminary screening tool based on standard clinical guidelines. It is not a medical diagnosis and should not replace an evaluation by a doctor or dermatologist.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESNET50 & QUESTIONNAIRE INDEPENDENCE / COMPARISON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compares ResNet50 predicted condition with questionnaire support.
 *
 * CRITICAL RULE:
 * This function NEVER alters, scales, or overwrites ResNet50 output.
 * If AI and questionnaire disagree, it documents the discrepancy transparently
 * and advises appropriate professional consultation.
 */
export function compareAIAndQuestionnaire(
  aiPredictedCondition: string,
  aiConfidence: number,
  mappingResult: DiseaseMappingResult
): AIQuestionnaireComparison {
  // Normalize AI condition name to match SupportedCondition keys
  let normalizedKey: SupportedCondition | null = null;
  const clean = (aiPredictedCondition || "").toLowerCase();
  if (clean.includes("acne")) normalizedKey = "Acne Vulgaris";
  else if (clean.includes("atopic") || clean.includes("eczema")) normalizedKey = "Atopic Dermatitis";
  else if (clean.includes("contact")) normalizedKey = "Contact Dermatitis";
  else if (clean.includes("melasma")) normalizedKey = "Melasma";
  else if (clean.includes("vitiligo")) normalizedKey = "Vitiligo";

  const questionnaireSupportForAIClass: SupportLevel = normalizedKey
    ? mappingResult.conditions[normalizedKey]?.supportLevel || "Limited / no specific support"
    : "Limited / no specific support";

  const questionnairePrimary = mappingResult.primarySupportedCondition;

  let agreementStatus: "aligned" | "differing" | "inconclusive";
  let summary: string;
  let recommendation: string;

  if (normalizedKey && questionnaireSupportForAIClass === "Strong support") {
    agreementStatus = "aligned";
    summary =
      "The AI noticed signs in your photo that match the symptoms you selected in the questionnaire. This consistency increases the accuracy of the result.";
    recommendation =
      "Consult a dermatologist to confirm diagnosis and discuss tailored care.";
  } else if (normalizedKey && questionnaireSupportForAIClass === "Moderate support") {
    agreementStatus = "aligned";
    summary = `Image analysis indicated ${aiPredictedCondition}, and your reported symptoms provide moderate supporting alignment.`;
    recommendation =
      "Your reported symptoms partially align with the image assessment. A dermatologist can provide a complete evaluation.";
  } else if (
    questionnairePrimary &&
    normalizedKey &&
    questionnairePrimary !== normalizedKey &&
    mappingResult.conditions[questionnairePrimary]?.supportLevel === "Strong support"
  ) {
    agreementStatus = "differing";
    summary = `Discrepancy noted: The skin image model indicated ${aiPredictedCondition} (${Math.round(aiConfidence)}% confidence), while your questionnaire symptoms show strong support for ${questionnairePrimary}.`;
    recommendation =
      "Because the photo features and reported symptoms suggest different possibilities, an in-person dermatological evaluation is strongly advised to determine the correct condition.";
  } else if (questionnaireSupportForAIClass === "Limited / no specific support") {
    agreementStatus = "differing";
    summary = `The skin image model indicated ${aiPredictedCondition} (${Math.round(aiConfidence)}% confidence), but your reported questionnaire symptoms provide limited specific support for this pattern.`;
    recommendation =
      "Image-based predictions may capture superficial visual similarities. Please consult a dermatologist for an accurate diagnostic exam.";
  } else {
    agreementStatus = "inconclusive";
    summary = `Image analysis predicted ${aiPredictedCondition} (${Math.round(aiConfidence)}% confidence). Questionnaire findings are inconclusive or non-specific.`;
    recommendation =
      "Consult a qualified healthcare provider to review your skin symptoms in detail.";
  }

  return {
    aiPredictedCondition,
    aiConfidence,
    questionnaireSupportForAIClass,
    questionnairePrimarySupported: questionnairePrimary,
    agreementStatus,
    summary,
    recommendation,
  };
}
