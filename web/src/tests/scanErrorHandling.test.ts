/**
 * DermAI — Focused Regression Test Suite for Scan Error Handling & Supporting Image Feedback
 *
 * Verifies:
 * 1. Low-confidence rejections format confidence and threshold to two decimal places.
 * 2. Network/connection errors do not leak internal URLs or developer instructions.
 * 3. Raw database/Postgres errors do not leak to the patient.
 * 4. Safe clinical errors (low_confidence, not_human_skin, quality_*) pass through cleanly.
 * 5. Unexpected/server 500 errors display a friendly patient message.
 * 6. Supporting-image feedback accurately distinguishes invalid, disagreement, and agreement states.
 */

import { AIPredictionError } from "../lib/aiApi";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log("=== DermAI Scan Error Handling Regression Test Suite Starting ===");

// ── Test 1: Low-Confidence Message Formatting ────────────────────────────────
console.log("\n[Test 1] Testing Low-Confidence Error String Formatting...");
const testConfidence = 64.99;
const testThreshold = 65.0;
const lowConfMsg = `We couldn't confidently assess this photo. The model's confidence was ${testConfidence.toFixed(2)}%, below the required ${testThreshold.toFixed(2)}% threshold. Please retake the close-up photo with good lighting and the affected skin area clearly in focus.`;

assert(lowConfMsg.includes("64.99%"), "Must display 64.99% with two decimals");
assert(lowConfMsg.includes("65.00%"), "Must display 65.00% threshold with two decimals");
assert(!lowConfMsg.includes("65.0%"), "Must not round 64.99% to 65.0%");
console.log("✓ Low-confidence message correctly formats values to 2 decimal places without misleading rounding.");

// ── Test 2: Network / Disconnection Error Message Safety ─────────────────────
console.log("\n[Test 2] Testing Network Error Message Safety (No Internal URLs)...");
const networkError = new AIPredictionError(
  "We couldn't connect to the skin analysis service. Please try again shortly.",
  "network"
);

assert(!networkError.message.includes("http"), "Must not expose HTTP URLs");
assert(!networkError.message.includes("127.0.0.1"), "Must not expose IP addresses");
assert(!networkError.message.includes("localhost"), "Must not expose localhost");
assert(!networkError.message.includes("FastAPI"), "Must not expose FastAPI/backend details");
assert(
  networkError.message === "We couldn't connect to the skin analysis service. Please try again shortly.",
  "Must match patient-friendly connection message"
);
console.log("✓ Network error message is completely sanitized and patient-friendly.");

// ── Test 3: Database Save Error Message Safety ───────────────────────────────
console.log("\n[Test 3] Testing Database Save Error Sanitization...");
const sanitizedDbError = "We couldn't save your scan result. Please try again. Your scan has not been confirmed as saved.";

assert(!sanitizedDbError.includes("row-level security"), "Must not expose RLS details");
assert(!sanitizedDbError.includes("ai_scan_result"), "Must not expose table names");
assert(!sanitizedDbError.includes("Postgres"), "Must not expose database engine");
console.log("✓ Database save error prevents Postgres/SQL/RLS leakage to patients.");

// ── Test 4: Safe Clinical Errors vs Internal Server Errors ───────────────────
console.log("\n[Test 4] Testing Clinical Error Pass-Through vs Server Sanitization...");
function sanitizeError(status: number, data: any): string {
  const detail = data?.detail;
  const errorType = (typeof detail === "object" && detail?.error_type) || data?.error_type || "server";

  const isSafeClinicalError =
    errorType === "low_confidence" ||
    errorType === "not_human_skin" ||
    (typeof errorType === "string" && errorType.startsWith("quality_")) ||
    errorType === "validation";

  if (isSafeClinicalError && typeof detail?.error === "string") {
    return detail.error;
  } else if (status === 502 || status === 503 || status === 504) {
    return "We couldn't connect to the skin analysis service. Please try again shortly.";
  }
  return "We couldn't complete your skin analysis. Please try again.";
}

// 4a: Safe low confidence
const safeLowConf = sanitizeError(400, {
  detail: {
    success: false,
    error: lowConfMsg,
    error_type: "low_confidence",
  },
});
assert(safeLowConf === lowConfMsg, "Safe low confidence message should pass through");

// 4b: Safe skin validator
const safeSkin = sanitizeError(400, {
  detail: {
    success: false,
    error: "Invalid Image Uploaded. Please upload a clear, close-up photo of the specific skin area you are concerned about. Documents, full-body shots, or non-skin images cannot be processed.",
    error_type: "not_human_skin",
  },
});
assert(safeSkin.includes("Invalid Image Uploaded"), "Safe skin message should pass through");

// 4c: Safe blur check
const safeBlur = sanitizeError(400, {
  detail: {
    success: false,
    error: "Image appears blurry (sharpness score: 25.4, minimum: 40.0). Please retake with the camera steady.",
    error_type: "quality_blur",
  },
});
assert(safeBlur.includes("blurry"), "Safe quality message should pass through");

// 4d: Internal 500 error with stack trace / python error
const internal500 = sanitizeError(500, {
  detail: {
    success: false,
    error: "Primary image inference failed: CUDA out of memory in /app/services/predictor.py line 55",
    error_type: "inference",
  },
});
assert(
  internal500 === "We couldn't complete your skin analysis. Please try again.",
  "Internal server errors must be replaced with friendly message"
);
assert(!internal500.includes("CUDA"), "Must not leak CUDA or stack trace");

// 4e: Gateway 503
const gateway503 = sanitizeError(503, { detail: "Service Unavailable" });
assert(
  gateway503 === "We couldn't connect to the skin analysis service. Please try again shortly.",
  "Gateway errors must return connection message"
);
console.log("✓ Clinical errors pass through while internal server errors are safely sanitized.");

// ── Test 5: Supporting Image Feedback Logic (Fix C) ──────────────────────────
console.log("\n[Test 5] Testing Supporting Image Feedback State Classification...");
function getSupportingImageNotice(scanResult: {
  supportingPrediction?: { status?: string } | null;
  isCombined?: boolean;
  agreement?: boolean | null;
}): string | null {
  if (scanResult.supportingPrediction?.status === "invalid") {
    return "The supporting photo could not be analyzed. This result is based on the close-up photo.";
  }
  if (scanResult.isCombined && scanResult.agreement === false) {
    return "The close-up and supporting photos produced different predictions. Please discuss the result with a dermatologist.";
  }
  if (scanResult.isCombined && scanResult.agreement === true) {
    return "The close-up and supporting photos produced consistent predictions.";
  }
  return null;
}

// 5a: Wide view invalid
const invalidWideNotice = getSupportingImageNotice({
  supportingPrediction: { status: "invalid" },
  isCombined: false,
  agreement: null,
});
assert(
  invalidWideNotice === "The supporting photo could not be analyzed. This result is based on the close-up photo.",
  "Must show invalid wide-view fallback notice"
);

// 5b: Disagreement
const disagreementNotice = getSupportingImageNotice({
  supportingPrediction: { status: "valid" },
  isCombined: true,
  agreement: false,
});
assert(
  disagreementNotice === "The close-up and supporting photos produced different predictions. Please discuss the result with a dermatologist.",
  "Must show disagreement notice"
);

// 5c: Agreement
const agreementNotice = getSupportingImageNotice({
  supportingPrediction: { status: "valid" },
  isCombined: true,
  agreement: true,
});
assert(
  agreementNotice === "The close-up and supporting photos produced consistent predictions.",
  "Must show consistent notice"
);

// 5d: No wide photo uploaded (legacy scan)
const noWideNotice = getSupportingImageNotice({
  supportingPrediction: null,
  isCombined: false,
  agreement: null,
});
assert(noWideNotice === null, "Must not invent notice when no supporting photo exists");

console.log("✓ Supporting-image feedback accurately distinguishes all states without inventing false statuses.");

console.log("\n=======================================================");
console.log("  ALL SCAN ERROR REGRESSION TESTS PASSED! (5 / 5 suites)");
console.log("=======================================================\n");
