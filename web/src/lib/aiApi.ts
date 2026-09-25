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
  (import.meta.env.VITE_AI_API_URL as string | undefined) ||
  "http://localhost:8000";

// Request timeout (30s — generous for first cold inference)
const REQUEST_TIMEOUT_MS = 30_000;

// ============================================
// TYPES
// ============================================

export interface PredictionResult {
  success: boolean;
  predicted_class: string;
  display_name: string;
  confidence: number;
  confidence_level: "high" | "medium" | "low";
  probabilities: Record<string, number>;
  inference_time_ms: number;
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
 * Send a skin image to the FastAPI AI backend for classification.
 * 
 * @param imageFile - The close-up photo (File from input or camera)
 * @returns PredictionResult with predicted class + confidence + probabilities
 * @throws AIPredictionError on failure
 */
export async function predictSkinCondition(
  imageFile: File
): Promise<PredictionResult> {
  // Build multipart form data
  const formData = new FormData();
  formData.append("image", imageFile);

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
    
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AIPredictionError(
        "AI service timed out. Please try again.",
        "network"
      );
    }
    
    throw new AIPredictionError(
      `Cannot reach AI service at ${AI_API_BASE_URL}. Is FastAPI running?`,
      "network"
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Parse response
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new AIPredictionError(
      "AI service returned invalid response.",
      "server"
    );
  }

  // Handle HTTP errors
  if (!response.ok) {
    // FastAPI wraps errors as { detail: { success, error, error_type } }
    const detail = data?.detail;
    const errorMessage = detail?.error || data?.error || "Prediction failed";
    const errorType = detail?.error_type || "server";
    throw new AIPredictionError(errorMessage, errorType);
  }

  // Validate success flag
  if (!data.success) {
    throw new AIPredictionError(
      data.error || "Prediction failed",
      data.error_type || "server"
    );
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