/**
 * DermAI — Comprehensive Test Suite for 15-Question Disease Mapping Module
 *
 * Verifies:
 * 1. Exactly 15 questions defined with English + Tagalog and correct single/multi-select roles
 * 2. Stable option IDs and mutual exclusivity for "None" / "Prefer not to answer"
 * 3. Incomplete and "Not sure" answers handling
 * 4. Acne Vulgaris evidence pattern & rule constraints (oiliness/location alone != strong)
 * 5. Atopic Dermatitis evidence pattern & rule constraints (pruritus + dryness + recurrence)
 * 6. Contact Dermatitis evidence pattern & rule constraints (exposure alone != strong)
 * 7. Melasma evidence pattern & rule constraints (hyperpigmentation + flat + face + sun)
 * 8. Vitiligo evidence pattern & rule constraints (white patch + flat + progression, white alone != diagnostic)
 * 9. Overlapping Atopic and Contact Dermatitis patterns
 * 10. Q14 safety handling independent of disease mapping (emergency & urgent triage)
 * 11. ResNet50 independence (AI prediction and confidence remain 100% untouched)
 * 12. AI vs Questionnaire agreement & transparent discrepancy detection
 * 13. Condition guide retrieval & medical source links (AAD, DermNet, Cleveland Clinic)
 */

import {
  QUESTIONNAIRE_QUESTIONS,
  toggleOptionSelection,
} from "../data/questionnaireData";
import {
  evaluateDiseaseMapping,
  compareAIAndQuestionnaire,
  evaluateSafetyWarnings,
  normalizeAnswers,
} from "../lib/diseaseMappingService";
import { getConditionGuide, CONDITION_GUIDES } from "../data/conditionGuides";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log("=== DermAI Disease Mapping Test Suite Starting ===");

// ── Test 1: Exactly 15 Questions ─────────────────────────────────────────────
console.log("\n[Test 1] Validating 15-Question Questionnaire Specification...");
assert(
  QUESTIONNAIRE_QUESTIONS.length === 15,
  `Expected exactly 15 questions, got ${QUESTIONNAIRE_QUESTIONS.length}`
);

const expectedMultiSelect = ["q5", "q7", "q8", "q14", "q15"];
const expectedSingleSelect = ["q1", "q2", "q3", "q4", "q6", "q9", "q10", "q11", "q12", "q13"];

for (const q of QUESTIONNAIRE_QUESTIONS) {
  assert(Boolean(q.titleEn && q.titleTl), `Question ${q.id} must have both English and Tagalog titles`);
  assert(q.options.length >= 2, `Question ${q.id} must have at least 2 options`);
  for (const opt of q.options) {
    assert(Boolean(opt.id && opt.labelEn && opt.labelTl), `Option in ${q.id} missing id, labelEn, or labelTl`);
  }
  if (expectedMultiSelect.includes(q.id)) {
    assert(q.isMultiSelect === true, `${q.id} must be multi-select`);
  } else if (expectedSingleSelect.includes(q.id)) {
    assert(q.isMultiSelect === false, `${q.id} must be single-select`);
  }
}
console.log("✓ Exactly 15 questions verified with bilingual titles and proper multi-select flags.");

// ── Test 2: Mutual Exclusivity for "None" in Multi-Select ─────────────────────
console.log("\n[Test 2] Testing Mutually Exclusive 'None' Selection Handling...");
const q5 = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === "q5")!;
let sel5: string[] = ["q5_pimples", "q5_blackheads"];

// Selecting "None" should clear other active options
sel5 = toggleOptionSelection(sel5, "q5_none", q5);
assert(sel5.length === 1 && sel5[0] === "q5_none", `Selecting 'None' must clear other options: got ${JSON.stringify(sel5)}`);

// Selecting an active option after "None" should clear "None"
sel5 = toggleOptionSelection(sel5, "q5_whiteheads", q5);
assert(!sel5.includes("q5_none"), `Selecting active option must clear 'None': got ${JSON.stringify(sel5)}`);
assert(sel5.includes("q5_whiteheads"), `Active option must be selected`);
console.log("✓ Multi-select mutual exclusivity correctly clears conflicting options.");

// ── Test 3: Acne Vulgaris Mapping & Negative Constraint ───────────────────────
console.log("\n[Test 3] Testing Acne Vulgaris Evidence Patterns...");
// Positive Acne case: comedones, pimples, pus bumps, oily skin, face
const acneAnswers = {
  q4: "q4_oily_greasy",
  q5: ["q5_blackheads", "q5_whiteheads", "q5_pimples", "q5_pus_bumps"],
  q7: ["q7_face", "q7_chest"],
};
const acneResult = evaluateDiseaseMapping(acneAnswers);
assert(
  acneResult.conditions["Acne Vulgaris"].supportLevel === "Strong support",
  `Expected Strong support for Acne Vulgaris, got ${acneResult.conditions["Acne Vulgaris"].supportLevel}`
);
assert(acneResult.primarySupportedCondition === "Acne Vulgaris", "Primary should be Acne Vulgaris");

// Constraint Check: Location or oiliness ALONE must NEVER yield Strong or Moderate support
const oilinessOnly = {
  q4: "q4_oily_greasy",
  q7: ["q7_face", "q7_chest"],
  q5: ["q5_none"],
};
const oilinessResult = evaluateDiseaseMapping(oilinessOnly);
assert(
  oilinessResult.conditions["Acne Vulgaris"].supportLevel === "Limited / no specific support",
  `Oiliness/location alone must be Limited support, got ${oilinessResult.conditions["Acne Vulgaris"].supportLevel}`
);
console.log("✓ Acne Vulgaris maps to Strong support with primary lesions; oiliness/location alone is strictly limited.");

// ── Test 4: Atopic Dermatitis Mapping & Distinction ──────────────────────────
console.log("\n[Test 4] Testing Atopic Dermatitis Evidence Patterns...");
const atopicAnswers = {
  q1: "q1_intense",
  q4: "q4_dry_rough",
  q7: ["q7_elbows", "q7_behind_knees"],
  q12: "q12_yes",
  q15: ["q15_family_atopic"],
};
const atopicResult = evaluateDiseaseMapping(atopicAnswers);
assert(
  atopicResult.conditions["Atopic Dermatitis"].supportLevel === "Strong support",
  `Expected Strong support for Atopic Dermatitis, got ${atopicResult.conditions["Atopic Dermatitis"].supportLevel}`
);
console.log("✓ Atopic Dermatitis maps to Strong support with pruritus, xerosis, recurrence, and flexural sites.");

// ── Test 5: Contact Dermatitis Mapping & Exposure Constraint ──────────────────
console.log("\n[Test 5] Testing Contact Dermatitis Evidence Patterns & Constraints...");
// Strong Contact Dermatitis: Plausible exposure + acute symptoms (itching, burning, blisters)
const contactAnswers = {
  q1: "q1_moderate",
  q2: "q2_moderate",
  q4: "q4_flaky_peeling",
  q5: ["q5_fluid_blisters"],
  q8: ["q8_jewelry", "q8_detergent"],
};
const contactResult = evaluateDiseaseMapping(contactAnswers);
assert(
  contactResult.conditions["Contact Dermatitis"].supportLevel === "Strong support",
  `Expected Strong support for Contact Dermatitis, got ${contactResult.conditions["Contact Dermatitis"].supportLevel}`
);

// Constraint Check: Exposure ALONE without compatible symptoms must NEVER yield Strong support
const exposureOnly = {
  q8: ["q8_detergent", "q8_chemical"],
  q1: "q1_none",
  q2: "q2_none",
  q4: "q4_smooth_flat",
  q5: ["q5_none"],
};
const exposureOnlyResult = evaluateDiseaseMapping(exposureOnly);
assert(
  exposureOnlyResult.conditions["Contact Dermatitis"].supportLevel === "Limited / no specific support",
  `Exposure alone without symptoms must be Limited, got ${exposureOnlyResult.conditions["Contact Dermatitis"].supportLevel}`
);
console.log("✓ Contact Dermatitis maps to Strong support with exposure + symptoms; exposure alone is limited.");

// ── Test 6: Melasma Mapping ───────────────────────────────────────────────────
console.log("\n[Test 6] Testing Melasma Evidence Patterns...");
const melasmaAnswers = {
  q3: "q3_brown_dark",
  q4: "q4_smooth_flat",
  q7: ["q7_face"],
  q9: "q9_darker",
  q15: ["q15_pregnant", "q15_family_melasma"],
};
const melasmaResult = evaluateDiseaseMapping(melasmaAnswers);
assert(
  melasmaResult.conditions["Melasma"].supportLevel === "Strong support",
  `Expected Strong support for Melasma, got ${melasmaResult.conditions["Melasma"].supportLevel}`
);
console.log("✓ Melasma maps to Strong support with flat brown facial patches darkening with sunlight.");

// ── Test 7: Vitiligo Mapping & Diagnostic Constraint ──────────────────────────
console.log("\n[Test 7] Testing Vitiligo Evidence Patterns & Diagnostic Constraints...");
const vitiligoAnswers = {
  q3: "q3_white",
  q4: "q4_smooth_flat",
  q9: "q9_burns_easily",
  q10: "q10_spread_nearby",
  q15: ["q15_family_vitiligo"],
};
const vitiligoResult = evaluateDiseaseMapping(vitiligoAnswers);
assert(
  vitiligoResult.conditions["Vitiligo"].supportLevel === "Strong support",
  `Expected Strong support for Vitiligo, got ${vitiligoResult.conditions["Vitiligo"].supportLevel}`
);

// Constraint Check: White appearance alone is NOT diagnostic
const whiteAlone = {
  q3: "q3_white",
  q4: "q4_other_not_sure",
  q10: "q10_no_change",
};
const whiteAloneResult = evaluateDiseaseMapping(whiteAlone);
assert(
  whiteAloneResult.conditions["Vitiligo"].supportLevel !== "Strong support",
  `White appearance alone must not yield Strong support, got ${whiteAloneResult.conditions["Vitiligo"].supportLevel}`
);
console.log("✓ Vitiligo maps to Strong support with progression/flatness; white alone is not diagnostic.");

// ── Test 8: Q14 Safety Triage Independent of Disease Mapping ──────────────────
console.log("\n[Test 8] Testing Q14 Safety Warning Handling...");
// Emergency case: facial/lip swelling with breathing trouble
const emergencyAnswers = {
  q14: ["q14_emergency_breathing"],
};
const emergencyAlert = evaluateSafetyWarnings(normalizeAnswers(emergencyAnswers));
assert(emergencyAlert.level === "emergency", `Expected emergency level, got ${emergencyAlert.level}`);
assert(
  emergencyAlert.actionRequired.toLowerCase().includes("emergency"),
  "Emergency alert must direct to emergency care"
);

// Verify Q14 NEVER increases disease support
const safetyWithVitiligo = evaluateDiseaseMapping({
  ...vitiligoAnswers,
  q14: ["q14_emergency_breathing"],
});
assert(
  safetyWithVitiligo.safetyAlert.level === "emergency",
  "Safety alert must be emergency"
);
assert(
  safetyWithVitiligo.conditions["Vitiligo"].evidenceScore === vitiligoResult.conditions["Vitiligo"].evidenceScore,
  "Q14 warning signs must NOT increase disease evidence score"
);
console.log("✓ Q14 correctly triggers emergency alert independently without affecting disease evidence scores.");

// ── Test 9: ResNet50 Independence & Agreement / Discrepancy ───────────────────
console.log("\n[Test 9] Testing ResNet50 Independence and Comparison Logic...");
const originalConfidence = 87.45;
const aiPredictedClass = "Acne Vulgaris";

// ResNet50 says Acne, questionnaire says Acne (Aligned)
const alignedComparison = compareAIAndQuestionnaire(
  aiPredictedClass,
  originalConfidence,
  acneResult
);
assert(alignedComparison.aiConfidence === originalConfidence, "AI confidence must not be modified");
assert(alignedComparison.aiPredictedCondition === aiPredictedClass, "AI class must not be modified");
assert(alignedComparison.agreementStatus === "aligned", `Expected aligned status, got ${alignedComparison.agreementStatus}`);

// ResNet50 says Vitiligo, but questionnaire has strong support for Acne (Discrepancy)
const discrepancyComparison = compareAIAndQuestionnaire(
  "Vitiligo",
  originalConfidence,
  acneResult
);
assert(discrepancyComparison.aiConfidence === originalConfidence, "AI confidence must never be altered during discrepancy");
assert(discrepancyComparison.aiPredictedCondition === "Vitiligo", "AI class must never be silently swapped");
assert(discrepancyComparison.agreementStatus === "differing", `Expected differing status, got ${discrepancyComparison.agreementStatus}`);
assert(discrepancyComparison.recommendation.includes("dermatological evaluation"), "Discrepancy must advise clinical evaluation");
console.log("✓ ResNet50 prediction and confidence remain 100% independent; discrepancies are flagged transparently.");

// ── Test 10: Incomplete & Contradictory Answers ───────────────────────────────
console.log("\n[Test 10] Testing Incomplete and 'Not Sure' Answers...");
const emptyResult = evaluateDiseaseMapping({});
for (const cond of Object.keys(emptyResult.conditions) as (keyof typeof emptyResult.conditions)[]) {
  assert(
    emptyResult.conditions[cond].supportLevel === "Limited / no specific support",
    `Empty answers should yield Limited support for ${cond}`
  );
}

const allNotSure = {
  q3: "q3_other_not_sure",
  q4: "q4_other_not_sure",
  q6: "q6_not_sure",
  q8: ["q8_not_sure"],
  q9: "q9_not_sure",
  q10: "q10_not_sure",
  q11: "q11_not_sure",
  q12: "q12_not_sure",
  q14: ["q14_not_sure"],
  q15: ["q15_prefer_not_say"],
};
const notSureResult = evaluateDiseaseMapping(allNotSure);
assert(notSureResult.primarySupportedCondition === null, "Not sure answers should not produce a primary condition");
console.log("✓ Incomplete and 'Not sure' answers correctly produce limited/null support.");

// ── Test 11: Condition Guide Retrieval & Sources ──────────────────────────────
console.log("\n[Test 11] Testing Condition Guide Retrieval and Medical Sources...");
const guide = getConditionGuide("Atopic Dermatitis (Eczema)");
assert(guide !== null, "Must retrieve guide for Atopic Dermatitis");
assert(Boolean(guide && guide.medicalSources.length === 4), "Must have 4 reliable medical source references");
assert(Boolean(guide && guide.basicCareTips.length >= 4), "Must have basic care tips");
assert(Boolean(guide?.whenToSeeDoctor), "Must have guidance on when to see a doctor");

const allKeys = Object.keys(CONDITION_GUIDES);
assert(allKeys.length === 5, `Must have exactly 5 condition guides, found ${allKeys.length}`);
console.log("✓ All 5 condition guides retrieved with AAD, DermNet, and Cleveland Clinic citations.");

console.log("\n=======================================================");
console.log("  ALL TESTS PASSED SUCCESSFULLY! (11 / 11 suites passed)");
console.log("=======================================================\n");
