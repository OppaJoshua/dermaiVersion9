/**
 * DERMAI - AI API Client
 * 
 * Handles all communication with the FastAPI AI backend.
 * Modular design — can later be swapped for Supabase Edge Function without
 * rewriting the ScanSkin flow.
 * 
 * Current architecture (Option A — direct):
 *   React → FastAPI (localhost:8000) → ResNet50 → JSON
 * 
 * Future architecture (Option B — via Edge Function):
 *   React → Supabase Edge Function → FastAPI → JSON
 *   (Change API_BASE_URL + auth headers here, keep same function signatures)
 */

// ============================================
// CONFIGURATION
// ============================================

// FastAPI base URL — reads from Vite env var, falls back to localhost
const AI_API_BASE_URL =
  (import.meta.env?.VITE_AI_API_URL as string | undefined) ||
  "http://localhost:8000";

// Request timeout (30s — generous for first cold inference)
const REQUEST_TIMEOUT_MS = 30_000;

// ============================================
// TYPES
// ============================================

export interface EvidencePrediction {
  predicted_class?: string;
  display_name?: string;
  confidence?: number;
  confidence_level?: string;
  probabilities?: Record<string, number>;
  status: "valid" | "invalid";
  error?: string;
}

export interface PredictionResult {
  success: boolean;
  predicted_class: string;
  display_name: string;
  confidence: number;
  confidence_level: "high" | "medium" | "low";
  probabilities: Record<string, number>;
  inference_time_ms: number;
  is_combined?: boolean;
  agreement?: boolean | null;
  combined_evidence_score?: number | null;
  primary_prediction?: EvidencePrediction | null;
  supporting_prediction?: EvidencePrediction | null;
}

export interface PredictionError {
  success: false;
  error: string;
  error_type: "validation" | "inference" | "network" | "server";
}

// ============================================
// ERRORS
// ============================================

export class AIPredictionError extends Error {
  public readonly errorType: PredictionError["error_type"];
  
  constructor(message: string, errorType: PredictionError["error_type"]) {
    super(message);
    this.name = "AIPredictionError";
    this.errorType = errorType;
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

/**
 * Send skin images to the FastAPI AI backend for classification.
 * Runs ResNet50 separately on both the primary close-up and supporting wide-view image.
 * 
 * @param imageFile - The primary close-up photo (File from input or camera)
 * @param wideFile - The optional supporting wide-view photo (File from input or camera)
 * @returns PredictionResult with derived condition, confidence, and individual image evidence
 * @throws AIPredictionError on failure
 */
export async function predictSkinCondition(
  imageFile: File,
  wideFile?: File | null
): Promise<PredictionResult> {
  // Build multipart form data
  const formData = new FormData();
  formData.append("image", imageFile);
  if (wideFile) {
    formData.append("wide_image", wideFile);
  }

  // Abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${AI_API_BASE_URL}/predict`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      // NOTE: Do NOT set Content-Type header manually.
      // The browser sets `multipart/form-data; boundary=...` automatically.
    });
  } catch (err) {
    clearTimeout(timeoutId);
    
    // Diagnostic logging without leaking sensitive patient data
    console.error("[aiApi] Connection error while contacting AI service:", err);

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AIPredictionError(
        "We couldn't connect to the skin analysis service. Please try again shortly.",
        "network"
      );
    }
    
    throw new AIPredictionError(
      "We couldn't connect to the skin analysis service. Please try again shortly.",
      "network"
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Parse response
  let data: any;
  try {
    data = await response.json();
  } catch (parseErr) {
    console.error("[aiApi] Failed to parse AI service response:", parseErr);
    throw new AIPredictionError(
      "We couldn't complete your skin analysis. Please try again.",
      "server"
    );
  }

  // Handle HTTP errors
  if (!response.ok) {
    console.error("[aiApi] AI service returned error status:", response.status, data);

    // FastAPI wraps errors as { detail: { success, error, error_type } }
    const detail = data?.detail;
    const errorType = (typeof detail === "object" && detail?.error_type) || data?.error_type || "server";

    // Allow safe, user-actionable pre-screening messages from the backend validation pipeline
    const isSafeClinicalError =
      errorType === "low_confidence" ||
      errorType === "not_human_skin" ||
      (typeof errorType === "string" && errorType.startsWith("quality_")) ||
      errorType === "validation";

    let patientMessage = "We couldn't complete your skin analysis. Please try again.";

    if (isSafeClinicalError && typeof detail?.error === "string") {
      patientMessage = detail.error;
    } else if (response.status === 502 || response.status === 503 || response.status === 504) {
      patientMessage = "We couldn't connect to the skin analysis service. Please try again shortly.";
    }

    throw new AIPredictionError(patientMessage, errorType);
  }

  // Validate success flag
  if (!data.success) {
    console.error("[aiApi] AI service returned unsuccessful payload:", data);
    const errorType = data?.error_type || "server";
    const patientMessage =
      typeof data?.error === "string" &&
      (errorType === "low_confidence" || errorType === "not_human_skin" || errorType.startsWith("quality_"))
        ? data.error
        : "We couldn't complete your skin analysis. Please try again.";
    throw new AIPredictionError(patientMessage, errorType);
  }

  return data as PredictionResult;
}

// ============================================
// HEALTH CHECK (optional utility)
// ============================================

export async function checkAIHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.model_loaded === true;
  } catch {
    return false;
  }
}

// ============================================
// CLASS → UUID MAP (mirrors ai-backend/app/config.py)
// ============================================

export const CONDITION_UUIDS: Record<string, string> = {
  Acne_Vulgaris:      "00000000-0000-0000-0000-000000000012",
  Atopic_Dermatitis:  "00000000-0000-0000-0000-000000000013",
  Contact_Dermatitis: "00000000-0000-0000-0000-000000000014",
  Melasma:            "00000000-0000-0000-0000-000000000015",
  Vitiligo:           "00000000-0000-0000-0000-000000000011",
};

export function getConditionUUID(predictedClass: string): string | null {
  return CONDITION_UUIDS[predictedClass] ?? null;
}
