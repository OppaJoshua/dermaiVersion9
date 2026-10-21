import { Platform } from 'react-native';
import Constants from 'expo-constants';

export interface EvidencePrediction {
  predicted_class?: string;
  display_name?: string;
  confidence?: number;
  confidence_level?: string;
  probabilities?: Record<string, number>;
  status: 'valid' | 'invalid';
  error?: string;
}

export interface PredictionResult {
  success: boolean;
  predicted_class: string;
  display_name: string;
  confidence: number;
  confidence_level: 'high' | 'medium' | 'low';
  probabilities: Record<string, number>;
  inference_time_ms: number;
  is_combined?: boolean;
  agreement?: boolean | null;
  combined_evidence_score?: number | null;
  primary_prediction?: EvidencePrediction | null;
  supporting_prediction?: EvidencePrediction | null;
}

export class AIPredictionError extends Error {
  public readonly errorType: string;
  constructor(message: string, errorType: string = 'validation') {
    super(message);
    this.name = 'AIPredictionError';
    this.errorType = errorType;
  }
}

// Dynamically extract host IP from Expo dev server if running via Expo Go / dev client
const expoHost =
  Constants.expoConfig?.hostUri?.split(':')[0] ||
  (Constants as any).manifest?.debuggerHost?.split(':')[0] ||
  (Constants as any).manifest2?.extra?.expoGo?.debuggerHost?.split(':')[0] ||
  null;

// Candidate base URLs dynamically resolved
const CANDIDATE_URLS = [
  Platform.OS === 'web' ? 'http://localhost:8000' : null,
  Platform.OS === 'web' ? 'http://127.0.0.1:8000' : null,
  process.env.EXPO_PUBLIC_AI_API_URL,
  expoHost ? `http://${expoHost}:8000` : null,
  'http://192.168.100.42:8000',
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : null,
  'http://127.0.0.1:8000',
  'http://localhost:8000',
].filter(Boolean) as string[];

// Remove duplicates while preserving priority order
const UNIQUE_CANDIDATE_URLS = Array.from(new Set(CANDIDATE_URLS));

/**
 * Appends an image URI to FormData safely across Web, iOS, and Android
 * Uses standard WHATWG/WinterCG Blob compatible with modern Expo Fetch
 */
async function appendImageField(
  formData: FormData,
  fieldName: string,
  uri: string,
  defaultName: string
): Promise<void> {
  const cleanUri = uri.split('?')[0];
  let rawName = cleanUri.split('/').pop() || defaultName;
  const hasValidExt = /\.(jpe?g|png|webp|heic|bmp|tif|tiff)$/i.test(rawName);

  try {
    const res = await fetch(uri);
    const blob = await res.blob();

    let ext = '.jpg';
    if (blob.type === 'image/png' || rawName.toLowerCase().endsWith('.png')) ext = '.png';
    else if (blob.type === 'image/webp' || rawName.toLowerCase().endsWith('.webp')) ext = '.webp';
    else if (blob.type === 'image/heic' || rawName.toLowerCase().endsWith('.heic')) ext = '.heic';

    const finalName = hasValidExt ? rawName : `${rawName || defaultName.split('.')[0]}${ext}`;
    formData.append(fieldName, blob, finalName);
  } catch (err) {
    console.warn(`[aiApi] Blob conversion fallback for ${fieldName}:`, err);
    const isPng = rawName.toLowerCase().endsWith('.png');
    const finalName = hasValidExt ? rawName : `${rawName || defaultName.split('.')[0]}.jpg`;
    formData.append(fieldName, {
      uri,
      name: finalName,
      type: isPng ? 'image/png' : 'image/jpeg',
    } as any);
  }
}

/**
 * Predict skin condition using FastAPI AI backend
 */
export async function predictSkinCondition(
  primaryImageUri: string,
  wideImageUri?: string | null
): Promise<PredictionResult> {
  const formData = new FormData();
  await appendImageField(formData, 'image', primaryImageUri, 'closeup.jpg');

  if (wideImageUri) {
    await appendImageField(formData, 'wide_image', wideImageUri, 'wide.jpg');
  }

  let lastError: any = null;

  for (const baseUrl of UNIQUE_CANDIDATE_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          return data as PredictionResult;
        }
      } else {
        const errJson = await res.json().catch(() => null);
        const detail = errJson?.detail;
        let errorMsg: string | undefined;
        let errorType = 'validation';

        if (Array.isArray(detail)) {
          errorMsg = detail.map((d: any) => d.msg || d.error || JSON.stringify(d)).join('; ');
          errorType = 'validation';
        } else if (typeof detail === 'object' && detail !== null) {
          errorMsg = detail.error || detail.message;
          errorType = detail.error_type || 'validation';
        } else if (typeof detail === 'string') {
          errorMsg = detail;
        } else if (errJson?.error) {
          errorMsg = errJson.error;
          errorType = errJson.error_type || 'validation';
        }

        // If the server rejected the photo (e.g. blur, lighting, not human skin, low confidence, or validation error):
        if (errorMsg) {
          throw new AIPredictionError(errorMsg, errorType);
        }

        console.warn(`[aiApi] Response from ${baseUrl}:`, res.status, errJson);
      }
    } catch (err: any) {
      if (err instanceof AIPredictionError) {
        // Immediate failure: the image failed clinical/quality validation, so do NOT retry other URLs
        throw err;
      }
      lastError = err;
      // Network or connection error, try next candidate URL
    }
  }

  throw new Error(lastError?.message || 'AI service unavailable. Please check your network connection.');
}

// ============================================
// CLASS TO UUID MAP (mirrors ai-backend/app/config.py)
// ============================================

export const CONDITION_UUIDS: Record<string, string> = {
  Acne_Vulgaris:      "00000000-0000-0000-0000-000000000012",
  Atopic_Dermatitis:  "00000000-0000-0000-0000-000000000013",
  Contact_Dermatitis: "00000000-0000-0000-0000-000000000014",
  Melasma:            "00000000-0000-0000-0000-000000000015",
  Vitiligo:           "00000000-0000-0000-0000-000000000011",
};

export function getConditionUUID(predictedClass: string): string | null {
  const norm = (predictedClass || '').replace(/ /g, '_').toLowerCase();
  for (const [key, uuid] of Object.entries(CONDITION_UUIDS)) {
    if (key.toLowerCase() === norm) return uuid;
  }
  return null;
}
