import { supabase } from "@/lib/supabaseClient";

/**
 * Universal Storage URL Normalizer
 * Resolves a storage path or full URL into a viewable public URL from Supabase Storage.
 *
 * @param path - The stored file path (e.g. "avatars/user-123.jpg", "clinic-photos/logo.png") or complete URL
 * @param defaultBucket - Fallback bucket if path doesn't specify one (defaults to "avatars")
 */
export function getPublicStorageUrl(path?: string | null, defaultBucket = "avatars"): string | null {
  if (!path || typeof path !== "string") return null;
  const trimmed = path.trim();

  // Guard against empty strings and accidental clinical scans
  if (!trimmed || trimmed.includes("scan-uploads")) return null;

  // Already an absolute URL (e.g. Google OAuth photo or full Supabase URL) or inline data
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }

  try {
    let bucket = defaultBucket;
    let cleanPath = trimmed;

    if (trimmed.startsWith("clinic-photos/")) {
      bucket = "clinic-photos";
      cleanPath = trimmed.replace(/^clinic-photos\//, "");
    } else if (trimmed.startsWith("doctors/")) {
      bucket = "clinic-photos";
    } else if (trimmed.startsWith("avatars/")) {
      bucket = "avatars";
      cleanPath = trimmed.replace(/^avatars\//, "");
    } else if (trimmed.startsWith("skin-scans/")) {
      bucket = "skin-scans";
      cleanPath = trimmed.replace(/^skin-scans\//, "");
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn("[storageUtils] Failed to resolve public storage URL:", trimmed, err);
    return null;
  }
}

/**
 * Safely resolves a patient avatar path/URL to an active public URL.
 * Handles full URLs (Google/OAuth, Supabase public) and relative storage paths.
 */
export function getPatientAvatarUrl(avatarPath?: string | null): string | null {
  return getPublicStorageUrl(avatarPath, "avatars");
}

/**
 * Resolves any raw avatar/photo string into a valid, active public URL from Supabase Storage.
 * Returns string | undefined for flexible component typing.
 */
export function resolveAvatarUrl(raw?: string | null): string | undefined {
  const resolved = getPublicStorageUrl(raw, "avatars");
  return resolved || undefined;
}

/**
 * Extracts 1-2 uppercase initials from a person's name for clean avatar fallback.
 */
export function getInitials(name?: string, fallback = "U"): string {
  if (!name || !name.trim()) return fallback;
  const clean = name.replace(/^(?:dr\.?|doctor)\s+/i, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
