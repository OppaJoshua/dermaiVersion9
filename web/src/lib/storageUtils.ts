import { supabase } from "./supabaseClient";

/**
 * Global in-memory cache for signed URLs to eliminate redundant Supabase Storage API calls.
 * Maps storage path -> { url: string, expiresAt: number }
 * Signed URLs typically have a 1-hour (3600s) lifetime.
 * Reuses the cached URL as long as it has at least 5 minutes remaining before expiry.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Clears the in-memory signed URL cache. Useful for test isolation.
 */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}

/**
 * Inspects a JWT token string and extracts its expiration timestamp in milliseconds,
 * or null if invalid or unparseable. Zero external dependencies.
 */
function getJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }
    const decoded = typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Safely extracts the 'token' query parameter from a URL string,
 * handling query parameters in any order.
 */
function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    const match = url.match(/[?&]token=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

/**
 * Checks whether a signed Supabase storage URL has an active, unexpired token.
 * Requires at least 60 seconds remaining before expiration.
 */
function isSignedUrlActive(url: string): boolean {
  const token = extractTokenFromUrl(url);
  if (!token) return false;
  const expMs = getJwtExpiryMs(token);
  if (expMs === null) {
    // If token exists but does not carry an exp claim, treat as active if present
    return true;
  }
  return expMs > Date.now() + 60_000;
}

/**
 * Extracts the underlying storage object key (e.g. "user-id/photo.jpg")
 * from a Supabase Storage path or full URL.
 * Strips leading slashes, "scan-uploads/" bucket prefixes, query parameters,
 * and hash fragments.
 *
 * Returns null if the input is an external URL, data/blob URI, or empty.
 */
export function extractStorageObjectKey(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl) return null;
  let clean = pathOrUrl.trim();
  if (!clean) return null;

  // Ignore data and blob URIs
  if (clean.startsWith("data:") || clean.startsWith("blob:")) {
    return null;
  }

  // If HTTP/HTTPS URL
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    const marker = "/scan-uploads/";
    const idx = clean.indexOf(marker);
    if (idx === -1) {
      // External URL — not a local storage key
      return null;
    }
    clean = clean.slice(idx + marker.length);
  }

  // Strip query parameters and hash fragments from the object key
  clean = clean.split("?")[0].split("#")[0];

  // Remove leading slashes
  clean = clean.replace(/^\/+/, "");

  // Strip redundant bucket prefix e.g. "scan-uploads/"
  if (clean.startsWith("scan-uploads/")) {
    clean = clean.replace(/^scan-uploads\//, "");
    clean = clean.replace(/^\/+/, "");
  }

  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep clean as-is if malformed URI component
  }

  clean = clean.trim();
  return clean || null;
}

/**
 * Normalizes a storage path or URL:
 * - Direct data:/blob: URIs and external non-Supabase URLs are returned as-is.
 * - Active, unexpired Supabase signed URLs are returned as-is.
 * - Expired signed URLs, unsigned Supabase URLs, and prefixed paths have their
 *   underlying storage object key recovered (e.g. "user-id/photo.jpg").
 * - Plain object keys are cleaned of leading slashes and bucket prefixes.
 */
export function normalizeSkinPhotoPath(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl) return null;
  const clean = pathOrUrl.trim();
  if (!clean) return null;

  // Data and blob URIs are returned directly
  if (clean.startsWith("data:") || clean.startsWith("blob:")) {
    return clean;
  }

  // HTTP / HTTPS URLs
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    const isScanUploadsUrl = clean.includes("/scan-uploads/");
    if (!isScanUploadsUrl) {
      // External URL — preserve as-is; do not convert arbitrary external URLs into local keys
      return clean;
    }

    // It's a Supabase scan-uploads URL:
    // Check if it already has an active, unexpired signed token
    if (isSignedUrlActive(clean)) {
      return clean;
    }

    // If it's an unsigned public URL or an expired signed URL,
    // recover the underlying storage object key so it can be refreshed.
    return extractStorageObjectKey(clean);
  }

  // Plain relative storage path (e.g. "user-id/file.jpg", "/user-id/file.jpg", "scan-uploads/user-id/file.jpg")
  return extractStorageObjectKey(clean);
}

/**
 * Returns a cached signed URL or generates a new one on-demand for a Supabase Storage path.
 * If the path is already an active signed URL, external HTTP/HTTPS URL, or data URI,
 * it is returned directly.
 *
 * If an expired signed URL is passed, recovers the underlying storage key and generates
 * a fresh signed URL.
 * 
 * @param pathOrUrl - Supabase Storage path (e.g. 'user-id/1720000000_close_up_pic.jpg') or full URL
 * @param expiresInSeconds - Lifetime in seconds (default: 3600 = 1 hour)
 */
export async function getSignedSkinPhotoUrl(
  pathOrUrl?: string | null,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!pathOrUrl) return null;

  const normalized = normalizeSkinPhotoPath(pathOrUrl);
  if (!normalized) return null;

  // Already an active HTTP URL or data/blob URI — return directly
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:")
  ) {
    return normalized;
  }

  const now = Date.now();
  const cached = signedUrlCache.get(normalized);
  // Re-use cached URL if valid with at least 5 minutes to spare
  if (cached) {
    if (cached.expiresAt > now + 300_000) {
      return cached.url;
    }
    // Expired or close to expiry — evict from cache
    signedUrlCache.delete(normalized);
  }

  try {
    const { data, error } = await supabase.storage
      .from("scan-uploads")
      .createSignedUrl(normalized, expiresInSeconds);

    if (error || !data?.signedUrl) {
      // Sanitized warning — do not expose patient user IDs, photo filenames, or tokens in logs
      console.warn("[storageUtils] Failed to create signed photo URL:", error?.message || "Storage error");
      return null;
    }

    signedUrlCache.set(normalized, {
      url: data.signedUrl,
      expiresAt: now + expiresInSeconds * 1000,
    });

    return data.signedUrl;
  } catch (err) {
    console.warn(
      "[storageUtils] Exception creating signed photo URL:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return null;
  }
}
