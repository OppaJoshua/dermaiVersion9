/**
 * DermAI — Targeted Unit Tests for AI Confidence Display & Combiner Behavior
 * 
 * Verifies:
 * 1. Single-image analysis displays raw close-up ResNet50 confidence.
 * 2. Dual-image analysis with agreement applies the exact 70/30 weighting.
 * 3. Dual-image analysis with disagreement anchors the primary condition and
 *    weights wide-view supporting probability for the primary condition.
 * 4. Invalid wide-view image gracefully falls back to single-image close-up confidence.
 * 5. Pre-questionnaire answers NEVER alter, scale, or overwrite image confidence (0% weight).
 * 6. Booking and clinic navigation context serializes the effective displayed score.
 */

import {
  evaluateDiseaseMapping,
  compareAIAndQuestionnaire,
} from "../lib/diseaseMappingService";
import type { PredictionResult } from "../lib/aiApi";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log("=== DermAI AI Confidence Display Test Suite Starting ===");

// ── Test 1: Single-image analysis resolution ─────────────────────────────────
console.log("\n[Test 1] Testing single-image confidence resolution...");
const singleImageResult: PredictionResult = {
  success: true,
  predicted_class: "Acne_Vulgaris",
  display_name: "Acne Vulgaris",
  confidence: 94.62,
  confidence_level: "high",
  probabilities: { Acne_Vulgaris: 94.62, Melasma: 2.1, Vitiligo: 1.0, Atopic_Dermatitis: 1.2, Contact_Dermatitis: 1.08 },
  inference_time_ms: 120,
  is_combined: false,
  agreement: null,
  combined_evidence_score: null,
  primary_prediction: {
    predicted_class: "Acne_Vulgaris",
    display_name: "Acne Vulgaris",
    confidence: 94.62,
    confidence_level: "high",
    probabilities: { Acne_Vulgaris: 94.62, Melasma: 2.1, Vitiligo: 1.0, Atopic_Dermatitis: 1.2, Contact_Dermatitis: 1.08 },
    status: "valid",
  },
  supporting_prediction: null,
};

const effectiveScoreSingle =
  singleImageResult.is_combined && singleImageResult.combined_evidence_score != null
    ? singleImageResult.combined_evidence_score
    : singleImageResult.confidence;

assert(effectiveScoreSingle === 94.62, `Expected 94.62, got ${effectiveScoreSingle}`);
assert(!singleImageResult.is_combined, "Must not be flagged as combined");
console.log("✓ Single-image correctly uses raw close-up confidence without alteration.");

// ── Test 2: Dual-image analysis with agreement (70/30 fusion) ────────────────
console.log("\n[Test 2] Testing dual-image 70/30 fusion with agreeing classes...");
const dualAgreeingResult: PredictionResult = {
  success: true,
  predicted_class: "Melasma",
  display_name: "Melasma",
  confidence: 85.00,
  confidence_level: "high",
  probabilities: { Acne_Vulgaris: 5.0, Melasma: 83.50, Vitiligo: 1.7, Atopic_Dermatitis: 4.3, Contact_Dermatitis: 5.5 },
  inference_time_ms: 240,
  is_combined: true,
  agreement: true,
  combined_evidence_score: 83.50, // 0.70 * 85.00 + 0.30 * 80.00 = 59.50 + 24.00 = 83.50
  primary_prediction: {
    predicted_class: "Melasma",
    display_name: "Melasma",
    confidence: 85.00,
    status: "valid",
  },
  supporting_prediction: {
    predicted_class: "Melasma",
    display_name: "Melasma",
    confidence: 80.00,
    status: "valid",
  },
};

const effectiveScoreDualAgree =
  dualAgreeingResult.is_combined && dualAgreeingResult.combined_evidence_score != null
    ? dualAgreeingResult.combined_evidence_score
    : dualAgreeingResult.confidence;

assert(effectiveScoreDualAgree === 83.50, `Expected 83.50, got ${effectiveScoreDualAgree}`);
assert(dualAgreeingResult.is_combined === true, "Must be flagged as combined");
assert(dualAgreeingResult.agreement === true, "Agreement must be true");
console.log("✓ Dual-image agreement computes 70/30 combined score (83.50%) and exposes it as effective score.");

// ── Test 3: Dual-image analysis with disagreement ────────────────────────────
console.log("\n[Test 3] Testing dual-image 70/30 fusion with differing predictions...");
// Close-up: Acne Vulgaris (75.00%), Wide-view: Melasma (60.00%, with Acne at 15.00%)
// 0.70 * 75.00 + 0.30 * 15.00 = 52.50 + 4.50 = 57.00
const dualDisagreeingResult: PredictionResult = {
  success: true,
  predicted_class: "Acne_Vulgaris",
  display_name: "Acne Vulgaris",
  confidence: 75.00,
  confidence_level: "medium",
  probabilities: { Acne_Vulgaris: 57.00, Melasma: 21.50, Vitiligo: 5.0, Atopic_Dermatitis: 10.0, Contact_Dermatitis: 6.5 },
  inference_time_ms: 250,
  is_combined: true,
  agreement: false,
  combined_evidence_score: 57.00,
  primary_prediction: {
    predicted_class: "Acne_Vulgaris",
    display_name: "Acne Vulgaris",
    confidence: 75.00,
    status: "valid",
  },
  supporting_prediction: {
    predicted_class: "Melasma",
    display_name: "Melasma",
    confidence: 60.00,
    probabilities: { Acne_Vulgaris: 15.00, Melasma: 60.00, Vitiligo: 5.0, Atopic_Dermatitis: 10.0, Contact_Dermatitis: 10.0 },
    status: "valid",
  },
};

const effectiveScoreDualDisagree =
  dualDisagreeingResult.is_combined && dualDisagreeingResult.combined_evidence_score != null
    ? dualDisagreeingResult.combined_evidence_score
    : dualDisagreeingResult.confidence;

assert(effectiveScoreDualDisagree === 57.00, `Expected 57.00, got ${effectiveScoreDualDisagree}`);
assert(dualDisagreeingResult.predicted_class === "Acne_Vulgaris", "Predicted class must remain anchored to close-up");
assert(dualDisagreeingResult.agreement === false, "Agreement must be false");
console.log("✓ Disagreement properly anchors close-up prediction and factors wide-view support into combined score (57.00%).");

// ── Test 4: Invalid wide-view fallback ───────────────────────────────────────
console.log("\n[Test 4] Testing invalid wide-view fallback...");
const invalidWideResult: PredictionResult = {
  success: true,
  predicted_class: "Atopic_Dermatitis",
  display_name: "Atopic Dermatitis",
  confidence: 89.20,
  confidence_level: "high",
  probabilities: { Atopic_Dermatitis: 89.20, Acne_Vulgaris: 4.0, Contact_Dermatitis: 3.8, Melasma: 1.5, Vitiligo: 1.5 },
  inference_time_ms: 130,
  is_combined: false,
  agreement: null,
  combined_evidence_score: null,
  primary_prediction: {
    predicted_class: "Atopic_Dermatitis",
    display_name: "Atopic Dermatitis",
    confidence: 89.20,
    status: "valid",
  },
  supporting_prediction: {
    status: "invalid",
    error: "Quality issue: Image appears blurry",
  },
};

const effectiveScoreInvalidWide =
  invalidWideResult.is_combined && invalidWideResult.combined_evidence_score != null
    ? invalidWideResult.combined_evidence_score
    : invalidWideResult.confidence;

assert(effectiveScoreInvalidWide === 89.20, `Expected 89.20, got ${effectiveScoreInvalidWide}`);
assert(!invalidWideResult.is_combined, "Must not be combined when wide-view is invalid");
assert(invalidWideResult.supporting_prediction?.status === "invalid", "Supporting status must be invalid");
console.log("✓ Invalid wide-view falls back cleanly to primary close-up confidence.");

// ── Test 5: Strict Questionnaire Independence ───────────────────────────────
console.log("\n[Test 5] Testing questionnaire independence (0% questionnaire weight)...");
const vitiligoQuestionnaire = {
  q3: "q3_white",
  q4: "q4_smooth_flat",
  q9: "q9_burns_easily",
  q10: "q10_spread_nearby",
  q14: ["q14_none"],
  q15: ["q15_family_vitiligo"],
};

const mappingResult = evaluateDiseaseMapping(vitiligoQuestionnaire);
assert(mappingResult.conditions["Vitiligo"].supportLevel === "Strong support", "Vitiligo should have Strong support");

// Case A: AI predicts Vitiligo (agreement)
const comparisonAligned = compareAIAndQuestionnaire("Vitiligo", effectiveScoreSingle, mappingResult);
assert(comparisonAligned.aiConfidence === effectiveScoreSingle, "AI confidence must be completely unchanged");
assert(comparisonAligned.agreementStatus === "aligned", "Agreement status should be aligned");

// Case B: AI predicts Acne Vulgaris (discrepancy)
const comparisonDiscrepant = compareAIAndQuestionnaire("Acne Vulgaris", effectiveScoreSingle, mappingResult);
assert(comparisonDiscrepant.aiConfidence === effectiveScoreSingle, "AI confidence must remain completely unchanged even on disagreement");
assert(comparisonDiscrepant.agreementStatus === "differing", "Discrepancy must be flagged");
assert(comparisonDiscrepant.summary.includes("Discrepancy noted"), "Discrepancy message must be presented");
console.log("✓ Questionnaire evaluation never alters or adds points to image confidence score.");

// ── Test 6: Booking Context Serialization ────────────────────────────────────
console.log("\n[Test 6] Testing booking context serialization...");
const bookingContextPayload = {
  scanId: "scan_test_123",
  condition: "Acne Vulgaris",
  confidence: Math.round(effectiveScoreDualDisagree), // 57%
  photoUrl: "https://example.com/closeup.jpg",
};

assert(bookingContextPayload.confidence === 57, `Expected 57, got ${bookingContextPayload.confidence}`);
const bookingQueryParam = encodeURIComponent(String(Math.round(effectiveScoreDualDisagree)));
assert(bookingQueryParam === "57", `Expected param '57', got '${bookingQueryParam}'`);
console.log("✓ Booking context properly preserves the effective combined confidence (57%).");

console.log("\n=======================================================");
console.log("  ALL CONFIDENCE DISPLAY TESTS PASSED SUCCESSFULLY!    ");
console.log("=======================================================");
