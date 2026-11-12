import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

export interface DoctorAvatarUpdateEvent {
  doctorId?: string;
  userId?: string;
  photoUrl: string | null;
  timestamp: number;
}

export const DOCTOR_AVATAR_UPDATED_EVENT = "dermai_doctor_avatar_updated";

/**
 * Appends or replaces a cache-busting timestamp parameter on an image URL.
 * Preserves data: and blob: URIs without modification.
 */
export function withCacheBuster(url?: string | null, timestamp?: number): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }
  if (trimmed.includes("googleusercontent.com") || trimmed.includes("google.com")) {
    return trimmed;
  }

  // Only append cache-buster if explicit timestamp is provided (e.g. on upload/edit)
  if (!timestamp) {
    return trimmed;
  }

  try {
    const isFullUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    const parsed = new URL(trimmed, isFullUrl ? undefined : window.location.origin);
    parsed.searchParams.set("t", String(timestamp));
    return isFullUrl ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch {
    const separator = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${separator}t=${timestamp}`;
  }
}

/**
 * Global reactive in-memory cache for doctor avatar URLs.
 * Maps doctorId and userId -> { photoUrl: string | null; timestamp: number }
 */
const avatarCache = new Map<string, { photoUrl: string | null; timestamp: number }>();

// Pre-hydrate avatarCache synchronously from localStorage so page refreshes don't glitch
try {
  const stored = localStorage.getItem("dermai_doctor_profile");
  if (stored) {
    const parsed = JSON.parse(stored);
    const photo = parsed.photo || parsed.photo_url || null;
    if (parsed.id) avatarCache.set(String(parsed.id), { photoUrl: photo, timestamp: Date.now() });
    if (parsed.doctor_id) avatarCache.set(String(parsed.doctor_id), { photoUrl: photo, timestamp: Date.now() });
  }
} catch {}

import { resolveAvatarUrl } from "./avatarUrlResolver";

/**
 * Synchronously updates the in-memory cache for a specific clinic doctor record.
 */
export function setDoctorAvatarInCache(doctorId: string, photoUrl: string | null): void {
  if (!doctorId) return;
  const timestamp = Date.now();
  const resolved = photoUrl ? withCacheBuster(resolveAvatarUrl(photoUrl) || photoUrl, timestamp) : null;
  avatarCache.set(String(doctorId), { photoUrl: resolved, timestamp });
}

/**
 * Synchronously retrieves doctor avatar URL from in-memory cache or doctor object with cache-busting.
 * Strictly scoped to clinic-specific doctorId and photo_url/photo (never global user.avatar_url).
 */
export function getDoctorAvatarUrl(
  doctorIdOrUserId?: string,
  doctor?: { photo?: string | null; photo_url?: string | null; avatar_url?: string | null } | null
): string {
  if (doctorIdOrUserId) {
    const cached = avatarCache.get(String(doctorIdOrUserId));
    if (cached && cached.photoUrl) {
      return cached.photoUrl;
    }
  }
  const raw = doctor?.photo_url || doctor?.photo;
  const resolved = resolveAvatarUrl(raw);
  return resolved ? withCacheBuster(resolved) : "";
}

/**
 * Fetches the clinic-specific avatar URL for a doctor strictly from public.clinic_doctor by doctor_id.
 * Never falls back to another clinic's record or to public.user.avatar_url.
 */
export async function fetchDoctorAvatar(
  doctorId: string,
  forceFresh = false
): Promise<string | null> {
  if (!doctorId) return null;

  if (!forceFresh && avatarCache.has(String(doctorId))) {
    return avatarCache.get(String(doctorId))?.photoUrl ?? null;
  }

  try {
    const { data: doc } = await supabase
      .from("clinic_doctor")
      .select("doctor_id, photo_url")
      .eq("doctor_id", doctorId)
      .maybeSingle();

    if (doc) {
      const resolved = resolveAvatarUrl(doc.photo_url);
      const url = resolved ? withCacheBuster(resolved) : null;
      if (doc.doctor_id) {
        avatarCache.set(String(doc.doctor_id), { photoUrl: url, timestamp: Date.now() });
      }
      return url;
    }
  } catch (err) {
    console.warn("[doctorAvatarService] fetchDoctorAvatar error:", err);
  }

  avatarCache.set(String(doctorId), { photoUrl: null, timestamp: Date.now() });
  return null;
}

/**
 * Updates a doctor's avatar strictly for the specified clinic_doctor membership row,
 * busts browser CDN/storage caches with timestamp, and broadcasts
 * an event so all mounted components for that clinic-doctor membership update immediately.
 */
export async function updateDoctorAvatar(
  doctorId: string,
  rawPhotoUrl: string,
  userId?: string,
  clinicId?: string
): Promise<string> {
  const timestamp = Date.now();
  const photoUrlWithBuster = withCacheBuster(rawPhotoUrl, timestamp);

  // 1. Update clinic_doctor table strictly for this clinic-doctor membership
  let query = supabase
    .from("clinic_doctor")
    .update({
      photo_url: photoUrlWithBuster,
      updated_at: new Date().toISOString(),
    })
    .eq("doctor_id", doctorId);

  if (clinicId && clinicId !== "all") {
    query = query.eq("clinic_id", clinicId);
  }

  const { error: cdError } = await query;

  if (cdError) {
    console.warn("[doctorAvatarService] Failed to update clinic_doctor photo_url:", cdError);
    throw cdError;
  }

  // 2. Update in-memory cache strictly by clinic-specific doctorId
  avatarCache.set(String(doctorId), { photoUrl: photoUrlWithBuster, timestamp });

  // 3. Update local storage caches safely (scoped by doctorId / clinicId only)
  try {
    if (clinicId && clinicId !== "all") {
      const scopedKey = `dermai_doctor_profile_${clinicId}`;
      const storedScoped = localStorage.getItem(scopedKey);
      if (storedScoped) {
        const parsedScoped = JSON.parse(storedScoped);
        if (!parsedScoped.id || String(parsedScoped.id) === String(doctorId)) {
          parsedScoped.photo = photoUrlWithBuster;
          localStorage.setItem(scopedKey, JSON.stringify(parsedScoped));
        }
      }
    }

    const stored = localStorage.getItem("dermai_doctor_profile");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.id && String(parsed.id) === String(doctorId)) {
        parsed.photo = photoUrlWithBuster;
        localStorage.setItem("dermai_doctor_profile", JSON.stringify(parsed));
      }
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("dermai_clinic_doctors")) continue;
      const clinicDocs = localStorage.getItem(key);
      if (!clinicDocs) continue;
      const parsedDocs = JSON.parse(clinicDocs);
      if (Array.isArray(parsedDocs)) {
        let changed = false;
        const updated = parsedDocs.map((d: any) => {
          const isDocMatch =
            String(d.id || "") === String(doctorId) ||
            String(d.doctor_id || "") === String(doctorId);
          if (isDocMatch) {
            changed = true;
            return { ...d, photo: photoUrlWithBuster, photo_url: photoUrlWithBuster };
          }
          return d;
        });
        if (changed) {
          localStorage.setItem(key, JSON.stringify(updated));
        }
      }
    }
  } catch {}

  // 4. Broadcast event scoped to doctorId
  const eventPayload: DoctorAvatarUpdateEvent = {
    doctorId: String(doctorId),
    userId,
    photoUrl: photoUrlWithBuster,
    timestamp,
  };

  window.dispatchEvent(
    new CustomEvent(DOCTOR_AVATAR_UPDATED_EVENT, { detail: eventPayload })
  );
  window.dispatchEvent(new CustomEvent("dermai_doctor_profile_updated"));

  return photoUrlWithBuster;
}

/**
 * Removes a doctor's avatar strictly from the specified clinic_doctor membership row,
 * updates caches, and broadcasts the removal event.
 */
export async function removeDoctorAvatar(
  doctorId: string,
  userId?: string,
  clinicId?: string
): Promise<void> {
  const timestamp = Date.now();

  // 1. Update clinic_doctor table strictly for this clinic-doctor membership
  let query = supabase
    .from("clinic_doctor")
    .update({
      photo_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("doctor_id", doctorId);

  if (clinicId && clinicId !== "all") {
    query = query.eq("clinic_id", clinicId);
  }

  const { error: cdError } = await query;
  if (cdError) {
    console.warn("[doctorAvatarService] Failed to remove clinic_doctor photo_url:", cdError);
    throw cdError;
  }

  // 2. Update in-memory cache strictly by clinic-specific doctorId
  avatarCache.set(String(doctorId), { photoUrl: null, timestamp });

  // 3. Update local storage caches safely (scoped by doctorId / clinicId only)
  try {
    if (clinicId && clinicId !== "all") {
      const scopedKey = `dermai_doctor_profile_${clinicId}`;
      const storedScoped = localStorage.getItem(scopedKey);
      if (storedScoped) {
        const parsedScoped = JSON.parse(storedScoped);
        if (!parsedScoped.id || String(parsedScoped.id) === String(doctorId)) {
          parsedScoped.photo = "";
          localStorage.setItem(scopedKey, JSON.stringify(parsedScoped));
        }
      }
    }

    const stored = localStorage.getItem("dermai_doctor_profile");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.id && String(parsed.id) === String(doctorId)) {
        parsed.photo = "";
        localStorage.setItem("dermai_doctor_profile", JSON.stringify(parsed));
      }
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("dermai_clinic_doctors")) continue;
      const clinicDocs = localStorage.getItem(key);
      if (!clinicDocs) continue;
      const parsedDocs = JSON.parse(clinicDocs);
      if (Array.isArray(parsedDocs)) {
        let changed = false;
        const updated = parsedDocs.map((d: any) => {
          const isDocMatch =
            String(d.id || "") === String(doctorId) ||
            String(d.doctor_id || "") === String(doctorId);
          if (isDocMatch) {
            changed = true;
            return { ...d, photo: "", photo_url: null };
          }
          return d;
        });
        if (changed) {
          localStorage.setItem(key, JSON.stringify(updated));
        }
      }
    }
  } catch {}

  // 4. Broadcast event scoped to doctorId
  const eventPayload: DoctorAvatarUpdateEvent = {
    doctorId: String(doctorId),
    userId,
    photoUrl: null,
    timestamp,
  };

  window.dispatchEvent(
    new CustomEvent(DOCTOR_AVATAR_UPDATED_EVENT, { detail: eventPayload })
  );
  window.dispatchEvent(new CustomEvent("dermai_doctor_profile_updated"));
}

export interface UseDoctorAvatarOptions {
  doctorId?: string | null;
  userId?: string | null;
  doctor?: {
    id?: string | null;
    doctor_id?: string | null;
    user_id?: string | null;
    photo?: string | null;
    photo_url?: string | null;
    avatar_url?: string | null;
    name?: string | null;
    doctor_name?: string | null;
    fullName?: string | null;
    [key: string]: any;
  } | null;
  initialUrl?: string | null;
}

/**
 * Shared global Realtime channel for external database updates to clinic_doctor table.
 * Uses a single channel across all hook instances to prevent duplicate subscriptions,
 * topic collisions, and RealtimeChannel state errors.
 */
let globalDoctorRealtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let globalRealtimeSubscribed = false;

function ensureGlobalDoctorRealtime(): void {
  if (globalDoctorRealtimeChannel || globalRealtimeSubscribed) return;

  try {
    const channelName = `doc-avatar-global-rt-${Math.random().toString(36).slice(2, 9)}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "clinic_doctor",
      },
      (payload) => {
        const newRow = payload.new as any;
        if (newRow && "photo_url" in newRow && newRow.doctor_id) {
          const timestamp = Date.now();
          const resolved = resolveAvatarUrl(newRow.photo_url);
          const updated = resolved ? withCacheBuster(resolved, timestamp) : null;

          avatarCache.set(String(newRow.doctor_id), { photoUrl: updated, timestamp });

          const eventPayload: DoctorAvatarUpdateEvent = {
            doctorId: String(newRow.doctor_id),
            userId: newRow.user_id ? String(newRow.user_id) : undefined,
            photoUrl: updated,
            timestamp,
          };

          window.dispatchEvent(
            new CustomEvent(DOCTOR_AVATAR_UPDATED_EVENT, { detail: eventPayload })
          );
        }
      }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        globalRealtimeSubscribed = true;
      }
    });

    globalDoctorRealtimeChannel = channel;
  } catch (err) {
    console.warn("[doctorAvatarService] Failed to establish global realtime listener:", err);
  }
}

/**
 * React hook that binds to the clinic-specific doctor avatar state with real-time updates and cache invalidation.
 * Never resolves or shares photos across clinics by userId.
 */
export function useDoctorAvatar(options: UseDoctorAvatarOptions = {}) {
  const { doctorId: explicitDocId, doctor, initialUrl } = options;
  const docId = explicitDocId || doctor?.doctor_id || doctor?.id || null;
  const hasExplicitPhotoProp =
    doctor !== undefined && doctor !== null && ("photo_url" in doctor || "photo" in doctor);

  const getInitial = useCallback((): string | null => {
    if (docId && avatarCache.has(String(docId))) {
      const cached = avatarCache.get(String(docId))!;
      if (cached.photoUrl) return cached.photoUrl;
      if (hasExplicitPhotoProp) {
        const propUrl = resolveAvatarUrl(doctor?.photo_url || doctor?.photo || initialUrl);
        return propUrl || null;
      }
      return null;
    }
    const provided = resolveAvatarUrl(doctor?.photo_url || doctor?.photo || initialUrl);
    if (provided) return provided;
    if (docId) {
      try {
        const stored = localStorage.getItem("dermai_doctor_profile");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.photo && String(parsed.id) === String(docId)) {
            return resolveAvatarUrl(parsed.photo) || null;
          }
        }
      } catch {}
    }
    return null;
  }, [docId, doctor, hasExplicitPhotoProp, initialUrl]);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(getInitial);
  const [loading, setLoading] = useState<boolean>(!avatarUrl && Boolean(docId) && !hasExplicitPhotoProp);

  const refresh = useCallback(async (force = false) => {
    if (!docId) {
      setAvatarUrl(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const fetched = await fetchDoctorAvatar(String(docId), force);
    setAvatarUrl(fetched);
    setLoading(false);
  }, [docId]);

  useEffect(() => {
    const current = getInitial();
    setAvatarUrl(current);

    if (docId && current) {
      avatarCache.set(String(docId), { photoUrl: current, timestamp: Date.now() });
    } else if (docId && !current && !hasExplicitPhotoProp && !avatarCache.has(String(docId))) {
      void refresh();
    } else if (!docId) {
      setAvatarUrl(providedUrlOrNull(doctor?.photo_url || doctor?.photo || initialUrl));
    }
  }, [docId, doctor?.photo, doctor?.photo_url, initialUrl, hasExplicitPhotoProp, getInitial, refresh]);

  // Subscribe to global avatar updates strictly matching this clinic's doctorId
  useEffect(() => {
    const handleAvatarUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<DoctorAvatarUpdateEvent>;
      const detail = customEvent.detail;
      if (!detail) return;

      if (docId && detail.doctorId && String(docId) === String(detail.doctorId)) {
        setAvatarUrl(detail.photoUrl);
      }
    };

    window.addEventListener(DOCTOR_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    return () => {
      window.removeEventListener(DOCTOR_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    };
  }, [docId]);

  // Ensure the shared global realtime listener is active once per session
  useEffect(() => {
    ensureGlobalDoctorRealtime();
  }, []);

  return { avatarUrl, loading, refresh };
}

function providedUrlOrNull(raw?: string | null): string | null {
  return resolveAvatarUrl(raw) || null;
}
