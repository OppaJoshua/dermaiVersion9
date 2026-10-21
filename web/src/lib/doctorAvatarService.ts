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
    if (parsed.id) avatarCache.set(parsed.id, { photoUrl: photo, timestamp: Date.now() });
    if (parsed.doctor_id) avatarCache.set(parsed.doctor_id, { photoUrl: photo, timestamp: Date.now() });
    if (parsed.userId) avatarCache.set(parsed.userId, { photoUrl: photo, timestamp: Date.now() });
  }
} catch {}

import { resolveAvatarUrl } from "./avatarUrlResolver";

/**
 * Synchronously retrieves doctor avatar URL from in-memory cache or doctor object with cache-busting.
 */
export function getDoctorAvatarUrl(
  doctorIdOrUserId?: string,
  doctor?: { photo?: string | null; photo_url?: string | null; avatar_url?: string | null } | null
): string {
  if (doctorIdOrUserId) {
    const cached = avatarCache.get(doctorIdOrUserId);
    if (cached && cached.photoUrl) {
      return cached.photoUrl;
    }
  }
  const raw = doctor?.photo_url || doctor?.photo || doctor?.avatar_url;
  const resolved = resolveAvatarUrl(raw);
  return resolved ? withCacheBuster(resolved) : "";
}

/**
 * Fetches the central avatar URL for a doctor from clinic_doctor (and user table fallback).
 */
export async function fetchDoctorAvatar(
  doctorIdOrUserId: string,
  forceFresh = false
): Promise<string | null> {
  if (!doctorIdOrUserId) return null;

  if (!forceFresh) {
    const cached = avatarCache.get(doctorIdOrUserId);
    if (cached) {
      return cached.photoUrl;
    }
  }

  try {
    // 1. Check clinic_doctor record
    const { data: doc } = await supabase
      .from("clinic_doctor")
      .select("doctor_id, user_id, photo_url")
      .or(`doctor_id.eq.${doctorIdOrUserId},user_id.eq.${doctorIdOrUserId}`)
      .limit(1)
      .maybeSingle();

    if (doc) {
      let resolved = resolveAvatarUrl(doc.photo_url);
      // Fallback to linked user profile avatar if clinic_doctor photo is not set
      if (!resolved && doc.user_id) {
        try {
          const { data: userRow } = await supabase
            .from("user")
            .select("avatar_url")
            .eq("user_id", doc.user_id)
            .maybeSingle();
          if (userRow?.avatar_url) {
            resolved = resolveAvatarUrl(userRow.avatar_url);
          }
        } catch {}
      }

      const url = resolved ? withCacheBuster(resolved) : null;
      if (doc.doctor_id) avatarCache.set(doc.doctor_id, { photoUrl: url, timestamp: Date.now() });
      if (doc.user_id) avatarCache.set(doc.user_id, { photoUrl: url, timestamp: Date.now() });
      return url;
    }

    // 2. Fallback: check user table avatar_url if doctorIdOrUserId is an auth user_id
    const { data: userRow } = await supabase
      .from("user")
      .select("user_id, avatar_url")
      .eq("user_id", doctorIdOrUserId)
      .maybeSingle();

    if (userRow) {
      const resolved = resolveAvatarUrl(userRow.avatar_url);
      const url = resolved ? withCacheBuster(resolved) : null;
      avatarCache.set(userRow.user_id, { photoUrl: url, timestamp: Date.now() });
      return url;
    }
  } catch (err) {
    console.warn("[doctorAvatarService] fetchDoctorAvatar error:", err);
  }

  return null;
}

/**
 * Updates a doctor's avatar across clinic_doctor and user tables,
 * busts browser CDN/storage caches with timestamp, and broadcasts
 * an event so all mounted components update immediately.
 */
export async function updateDoctorAvatar(
  doctorId: string,
  rawPhotoUrl: string,
  userId?: string
): Promise<string> {
  const timestamp = Date.now();
  const photoUrlWithBuster = withCacheBuster(rawPhotoUrl, timestamp);

  // 1. Update clinic_doctor table (Single Source of Truth)
  const { error: cdError } = await supabase
    .from("clinic_doctor")
    .update({
      photo_url: photoUrlWithBuster,
      updated_at: new Date().toISOString(),
    })
    .eq("doctor_id", doctorId);

  if (cdError) {
    console.warn("[doctorAvatarService] Failed to update clinic_doctor photo_url:", cdError);
  }

  // 2. Resolve userId if not provided
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      const { data: docRow } = await supabase
        .from("clinic_doctor")
        .select("user_id")
        .eq("doctor_id", doctorId)
        .maybeSingle();
      if (docRow?.user_id) {
        resolvedUserId = docRow.user_id;
      }
    } catch {}
  }

  // 3. Update public.user table avatar_url if user_id is linked
  if (resolvedUserId) {
    try {
      const { error: userError } = await supabase
        .from("user")
        .update({ avatar_url: photoUrlWithBuster })
        .eq("user_id", resolvedUserId);

      if (userError) {
        console.warn("[doctorAvatarService] Failed to update user avatar_url:", userError);
      }
    } catch {}
  }

  // 4. Update in-memory cache
  avatarCache.set(doctorId, { photoUrl: photoUrlWithBuster, timestamp });
  if (resolvedUserId) {
    avatarCache.set(resolvedUserId, { photoUrl: photoUrlWithBuster, timestamp });
  }

  // 5. Update local storage caches safely
  try {
    const stored = localStorage.getItem("dermai_doctor_profile");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.photo = photoUrlWithBuster;
      localStorage.setItem("dermai_doctor_profile", JSON.stringify(parsed));
    }

    const clinicDocs = localStorage.getItem("dermai_clinic_doctors");
    if (clinicDocs) {
      const parsedDocs = JSON.parse(clinicDocs);
      if (Array.isArray(parsedDocs)) {
        const updated = parsedDocs.map((d: any) => {
          const isDocMatch =
            d.id === doctorId ||
            d.doctor_id === doctorId ||
            (resolvedUserId && d.user_id === resolvedUserId);
          if (isDocMatch) {
            return { ...d, photo: photoUrlWithBuster, photo_url: photoUrlWithBuster };
          }
          return d;
        });
        localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updated));
      }
    }
  } catch {}

  // 6. Broadcast event
  const eventPayload: DoctorAvatarUpdateEvent = {
    doctorId,
    userId: resolvedUserId,
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
 * Removes a doctor's avatar from clinic_doctor and user tables,
 * updates caches, and broadcasts the removal event.
 */
export async function removeDoctorAvatar(
  doctorId: string,
  userId?: string
): Promise<void> {
  const timestamp = Date.now();

  // 1. Update clinic_doctor table
  await supabase
    .from("clinic_doctor")
    .update({
      photo_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("doctor_id", doctorId);

  // 2. Resolve userId
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      const { data: docRow } = await supabase
        .from("clinic_doctor")
        .select("user_id")
        .eq("doctor_id", doctorId)
        .maybeSingle();
      if (docRow?.user_id) {
        resolvedUserId = docRow.user_id;
      }
    } catch {}
  }

  // 3. Update public.user table
  if (resolvedUserId) {
    try {
      await supabase
        .from("user")
        .update({ avatar_url: null })
        .eq("user_id", resolvedUserId);
    } catch {}
  }

  // 4. Update in-memory cache
  avatarCache.set(doctorId, { photoUrl: null, timestamp });
  if (resolvedUserId) {
    avatarCache.set(resolvedUserId, { photoUrl: null, timestamp });
  }

  // 5. Update local storage caches
  try {
    const stored = localStorage.getItem("dermai_doctor_profile");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.photo = "";
      localStorage.setItem("dermai_doctor_profile", JSON.stringify(parsed));
    }

    const clinicDocs = localStorage.getItem("dermai_clinic_doctors");
    if (clinicDocs) {
      const parsedDocs = JSON.parse(clinicDocs);
      if (Array.isArray(parsedDocs)) {
        const updated = parsedDocs.map((d: any) => {
          const isDocMatch =
            d.id === doctorId ||
            d.doctor_id === doctorId ||
            (resolvedUserId && d.user_id === resolvedUserId);
          if (isDocMatch) {
            return { ...d, photo: "", photo_url: null };
          }
          return d;
        });
        localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updated));
      }
    }
  } catch {}

  // 6. Broadcast event
  const eventPayload: DoctorAvatarUpdateEvent = {
    doctorId,
    userId: resolvedUserId,
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
 * Shared global Realtime channel for external database updates to clinic_doctor and user tables.
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

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clinic_doctor",
        },
        (payload) => {
          const newRow = payload.new as any;
          if (newRow && "photo_url" in newRow) {
            const updated = newRow.photo_url ? withCacheBuster(newRow.photo_url) : null;
            const timestamp = Date.now();

            if (newRow.doctor_id) {
              avatarCache.set(String(newRow.doctor_id), { photoUrl: updated, timestamp });
            }
            if (newRow.user_id) {
              avatarCache.set(String(newRow.user_id), { photoUrl: updated, timestamp });
            }

            const eventPayload: DoctorAvatarUpdateEvent = {
              doctorId: newRow.doctor_id ? String(newRow.doctor_id) : undefined,
              userId: newRow.user_id ? String(newRow.user_id) : undefined,
              photoUrl: updated,
              timestamp,
            };

            window.dispatchEvent(
              new CustomEvent(DOCTOR_AVATAR_UPDATED_EVENT, { detail: eventPayload })
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user",
        },
        (payload) => {
          const newRow = payload.new as any;
          if (newRow && "avatar_url" in newRow) {
            const updated = newRow.avatar_url ? withCacheBuster(newRow.avatar_url) : null;
            const timestamp = Date.now();

            if (newRow.user_id) {
              avatarCache.set(String(newRow.user_id), { photoUrl: updated, timestamp });
            }

            const eventPayload: DoctorAvatarUpdateEvent = {
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
 * React hook that binds to the central doctor avatar state with real-time updates and cache invalidation.
 */
export function useDoctorAvatar(options: UseDoctorAvatarOptions = {}) {
  const { doctorId: explicitDocId, userId: explicitUserId, doctor, initialUrl } = options;
  const docId = explicitDocId || doctor?.doctor_id || doctor?.id;
  const uId = explicitUserId || doctor?.user_id;

  const getInitial = (): string | null => {
    if (docId && avatarCache.has(docId)) return avatarCache.get(docId)!.photoUrl;
    if (uId && avatarCache.has(uId)) return avatarCache.get(uId)!.photoUrl;
    const provided = resolveAvatarUrl(doctor?.photo_url || doctor?.photo || doctor?.avatar_url || initialUrl);
    if (provided) return provided;
    try {
      const stored = localStorage.getItem("dermai_doctor_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.photo && (!docId || parsed.id === docId)) {
          return parsed.photo;
        }
      }
    } catch {}
    return null;
  };

  const [avatarUrl, setAvatarUrl] = useState<string | null>(getInitial);
  const [loading, setLoading] = useState<boolean>(!avatarUrl && Boolean(docId || uId));

  const refresh = useCallback(async (force = false) => {
    const key = docId || uId;
    if (!key) return;
    setLoading(true);
    const fetched = await fetchDoctorAvatar(key, force);
    setAvatarUrl(fetched);
    setLoading(false);
  }, [docId, uId]);

  useEffect(() => {
    const current = getInitial();
    setAvatarUrl(current);

    if (!current && (docId || uId)) {
      refresh();
    }
  }, [docId, uId, doctor?.photo, doctor?.photo_url, doctor?.avatar_url, initialUrl, refresh]);

  // Subscribe to global avatar updates
  useEffect(() => {
    const handleAvatarUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<DoctorAvatarUpdateEvent>;
      const detail = customEvent.detail;
      if (!detail) return;

      const isMatch =
        (docId && detail.doctorId && String(docId) === String(detail.doctorId)) ||
        (uId && detail.userId && String(uId) === String(detail.userId));

      if (isMatch) {
        setAvatarUrl(detail.photoUrl);
      }
    };

    window.addEventListener(DOCTOR_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    return () => {
      window.removeEventListener(DOCTOR_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    };
  }, [docId, uId]);

  // Ensure the shared global realtime listener is active once per session
  useEffect(() => {
    ensureGlobalDoctorRealtime();
  }, []);

  return { avatarUrl, loading, refresh };
}
