import { supabase } from "./supabaseClient";

export interface PatientNotificationPayload {
  userId: string;
  type: "appointment-scheduled" | "appointment-rejected" | "appointment-completed" | "scan-completed" | "broadcast" | "system";
  subtype?: string;
  title: string;
  body: string;
}

const LOCAL_NOTIF_PREFIX = "dermai_patient_notifications_";

/**
 * Creates an in-app patient notification.
 * Saves directly to Supabase `user_notification` table, updates localStorage cache,
 * and broadcasts a window event for immediate UI responsiveness.
 */
export async function createPatientNotification(payload: PatientNotificationPayload): Promise<boolean> {
  const { userId, type, subtype, title, body } = payload;
  if (!userId) return false;

  const now = new Date().toISOString();
  const tempId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // 1. Immediately cache locally for offline/instant UI feedback
  try {
    const key = `${LOCAL_NOTIF_PREFIX}${userId}`;
    const raw = localStorage.getItem(key);
    const existing = raw ? JSON.parse(raw) : [];
    const newEntry = {
      id: tempId,
      type,
      subtype: subtype || null,
      title,
      body,
      isRead: false,
      createdAt: now,
      userId,
    };
    const updated = [newEntry, ...(Array.isArray(existing) ? existing : [])].slice(0, 30);
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated", { detail: newEntry }));
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore storage errors */
  }

  // 2. Persist to Supabase user_notification table
  try {
    const { data, error } = await supabase
      .from("user_notification")
      .insert({
        user_id: userId,
        type,
        subtype: subtype || null,
        title,
        body,
        is_read: false,
      })
      .select("notif_id")
      .maybeSingle();

    if (error) {
      console.warn("[notificationService] Supabase insert warning:", error.message);
      return false;
    }

    if (data?.notif_id) {
      // Update cached temporary ID with permanent database ID
      try {
        const key = `${LOCAL_NOTIF_PREFIX}${userId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const patched = list.map((item: any) =>
              item.id === tempId ? { ...item, id: data.notif_id } : item
            );
            localStorage.setItem(key, JSON.stringify(patched));
          }
        }
      } catch {}
    }

    return true;
  } catch (err: any) {
    console.warn("[notificationService] Notification dispatch error:", err?.message || err);
    return false;
  }
}

/**
 * Get locally cached notifications for a patient as fallback/initial render.
 */
export function getCachedPatientNotifications(userId: string) {
  try {
    const key = `${LOCAL_NOTIF_PREFIX}${userId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
