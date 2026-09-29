import { supabase } from "./supabaseClient";

/**
 * Global in-memory cache for signed URLs to eliminate redundant Supabase Storage API calls.
 * Maps storage path -> { url: string, expiresAt: number }
 * Signed URLs typically have a 1-hour (3600s) lifetime.
 * Reuses the cached URL as long as it has at least 5 minutes remaining before expiry.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Returns a cached signed URL or generates a new one on-demand for a Supabase Storage path.
 * If the path is already an absolute HTTP/HTTPS URL or data URI, it is returned directly.
 * 
 * @param pathOrUrl - Supabase Storage path (e.g. 'user-id/1720000000_close_up_pic.jpg') or full URL
 * @param expiresInSeconds - Lifetime in seconds (default: 3600 = 1 hour)
 */
export async function getSignedSkinPhotoUrl(
  pathOrUrl?: string | null,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!pathOrUrl) return null;

  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  // Already a full HTTP URL or data/blob URI — return directly
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }

  const now = Date.now();
  const cached = signedUrlCache.get(trimmed);
  // Re-use cached URL if valid with at least 5 minutes to spare
  if (cached && cached.expiresAt > now + 300_000) {
    return cached.url;
  }

  try {
    const { data, error } = await supabase.storage
      .from("scan-uploads")
      .createSignedUrl(trimmed, expiresInSeconds);

    if (error || !data?.signedUrl) {
      console.warn("[storageUtils] createSignedUrl failed:", error?.message);
      return null;
    }

    signedUrlCache.set(trimmed, {
      url: data.signedUrl,
      expiresAt: now + expiresInSeconds * 1000,
    });

    return data.signedUrl;
  } catch (err) {
    console.warn("[storageUtils] createSignedUrl exception:", err);
    return null;
  }
}
