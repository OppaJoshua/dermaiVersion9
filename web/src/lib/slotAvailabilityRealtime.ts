/**
 * DermAI — Authoritative Real-Time Slot Availability & Multi-Patient Synchronization Service
 *
 * Implements:
 * 1. Supabase Realtime Broadcast on channel `clinic-availability:${clinicId}` to immediately
 *    notify other patients viewing the clinic when a slot is held, paid, cancelled, or released.
 * 2. Privacy-preserving retrieval using the authoritative `get_occupied_appointment_slots` RPC.
 *    (Zero exposure of patient personal details, names, emails, or payment references).
 * 3. Cross-tab and local window event propagation for instant multi-account & multi-browser testing.
 * 4. Automatic refresh on tab focus / visibilitychange, hold expiration timers, and active polling.
 */

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { getManilaCalendarDate } from "./schedulingService";
import { createRealtimeStatusHandler, doctorScopesOverlap } from "./slotAvailabilityState";

export interface OccupiedSlotRecord {
  appointment_id?: string;
  id?: string;
  date: string;
  time: string;
  batch_time?: string;
  assigned_doctor_id?: string | null;
  clinic_id?: string;
  status: string;
  doctor_status?: string | null;
  payment_status: string;
  occupancy_type: "reserved" | "booked";
  /** Real database value, passed through untouched (never invented by the frontend). */
  payment_hold_expires_at?: string | null;
  /** Database clock returned by the RPC; used only to judge expiry on database time. */
  db_now?: string | null;
  /** Real DB expiry preserved after the tracker neutralises browser-clock re-judging. */
  db_hold_expires_at?: string | null;
  /** True for a Realtime hint that no authoritative fetch has confirmed yet. */
  provisional?: boolean;
}

export interface BroadcastSlotChangePayload {
  clinicId: string;
  date?: string;
  doctorId?: string | null;
  slotTime?: string;
  changeType?: "hold_acquired" | "hold_released" | "payment_completed" | "cancelled" | "update";
  timestamp: number;
}

function isValidUuid(val?: string | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim());
}

interface ClinicChannelEntry {
  channel: any;
  refCount: number;
}

const activeClinicChannels = new Map<string, ClinicChannelEntry>();
const clinicCallbacks = new Map<string, Set<(payload?: BroadcastSlotChangePayload) => void>>();

/**
 * Broadcasts an anonymous, privacy-safe slot state change to all clients listening to this clinic.
 * Contains ZERO patient info or payment credentials.
 */
export function broadcastSlotChange(
  clinicId?: string | null,
  details?: {
    date?: string;
    doctorId?: string | null;
    slotTime?: string;
    type?: "hold_acquired" | "hold_released" | "payment_completed" | "cancelled" | "update";
  }
): void {
  if (!clinicId) return;

  const cleanDate = details?.date ? getManilaCalendarDate(details.date) : undefined;
  const payload: BroadcastSlotChangePayload = {
    clinicId,
    date: cleanDate,
    doctorId: details?.doctorId,
    slotTime: details?.slotTime ? details.slotTime.slice(0, 5) : undefined,
    changeType: details?.type || "update",
    timestamp: Date.now(),
  };

  // 1. Local window event (instant zero-latency notify on same page/window)
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dermai:slot_change", { detail: payload }));
    }
  } catch {}

  // 2. Cross-tab storage signal (instant zero-latency notify for other tabs in same browser)
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("dermai_slot_change_signal", JSON.stringify(payload));
    }
  } catch {}

  // 3. Supabase Realtime Broadcast (WebSocket across different browsers/devices)
  try {
    const entry = activeClinicChannels.get(clinicId);
    if (entry && entry.channel) {
      entry.channel.send({
        type: "broadcast",
        event: "slot_change",
        payload,
      }).catch((err: any) => {
        console.debug("[slotAvailabilityRealtime] Active channel broadcast error:", err);
      });
    } else {
      const channel = supabase.channel(`clinic-availability:${clinicId}`, {
        config: {
          broadcast: { ack: true },
        },
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.send({
            type: "broadcast",
            event: "slot_change",
            payload,
          }).then(() => {
            const timer = setTimeout(() => {
              try {
                Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
              } catch {}
            }, 3000);
            (timer as any)?.unref?.();
          }).catch(() => {});
        }
      });
    }
  } catch (err) {
    console.debug("[slotAvailabilityRealtime] Broadcast exception:", err);
  }
}

/**
 * Subscribes to Realtime slot change signals for a specific clinic.
 * Listens to Realtime Broadcasts, Postgres changes, Window events, and Storage signals.
 */
export function subscribeToClinicSlotChanges(
  clinicId: string,
  onSlotChange: (payload?: BroadcastSlotChangePayload) => void
): () => void {
  if (!clinicId) return () => {};

  let entry = activeClinicChannels.get(clinicId);
  if (!entry) {
    const channelName = `clinic-availability:${clinicId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: true, self: true },
      },
    });

    entry = { channel, refCount: 0 };
    activeClinicChannels.set(clinicId, entry);

    // 1. Anonymous Realtime Broadcasts between browser sessions
    channel.on(
      "broadcast" as any,
      { event: "slot_change" },
      (event: { payload?: BroadcastSlotChangePayload }) => {
        try {
          const cbs = clinicCallbacks.get(clinicId);
          if (cbs) {
            cbs.forEach((cb) => {
              try { cb(event.payload); } catch {}
            });
          }
        } catch (err) {
          console.warn("[slotAvailabilityRealtime] Broadcast handler error:", err);
        }
      }
    );

    // 2. Postgres table changes (filtered strictly by clinic_id)
    channel.on(
      "postgres_changes" as any,
      {
        event: "*",
        schema: "public",
        table: "patient_appointment",
        filter: `clinic_id=eq.${clinicId}`,
      },
      () => {
        try {
          const cbs = clinicCallbacks.get(clinicId);
          if (cbs) {
            cbs.forEach((cb) => {
              try { cb(); } catch {}
            });
          }
        } catch (err) {
          console.warn("[slotAvailabilityRealtime] Postgres change handler error:", err);
        }
      }
    );

    // Status handling: the first successful join AND every re-join after a disconnect
    // trigger an authoritative resync (callbacks without a payload => full DB refetch),
    // so broadcasts missed while offline are recovered from the database instead of
    // being assumed delivered. `ack:true` only confirms the SERVER received a send; it is
    // never treated as proof that another browser received the event.
    channel.subscribe(
      createRealtimeStatusHandler((reason) => {
        console.debug(`[slotAvailabilityRealtime] Channel ${reason} for clinic ${clinicId}: resyncing from database`);
        const cbs = clinicCallbacks.get(clinicId);
        if (cbs) {
          cbs.forEach((cb) => {
            try { cb(); } catch {}
          });
        }
      })
    );
  }

  entry.refCount++;

  let cbs = clinicCallbacks.get(clinicId);
  if (!cbs) {
    cbs = new Set();
    clinicCallbacks.set(clinicId, cbs);
  }
  cbs.add(onSlotChange);

  // 3. Local custom event handler for instantaneous same-window components
  const handleLocalEvent = (e: Event) => {
    const customEvt = e as CustomEvent<BroadcastSlotChangePayload>;
    if (customEvt.detail?.clinicId === clinicId) {
      onSlotChange(customEvt.detail);
    }
  };

  // 4. Cross-tab storage listener for multi-tab sessions in same browser
  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === "dermai_slot_change_signal" && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed.clinicId === clinicId) {
          onSlotChange(parsed);
        }
      } catch {}
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("dermai:slot_change", handleLocalEvent);
    window.addEventListener("storage", handleStorageEvent);
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("dermai:slot_change", handleLocalEvent);
      window.removeEventListener("storage", handleStorageEvent);
    }

    const currentCbs = clinicCallbacks.get(clinicId);
    if (currentCbs) {
      currentCbs.delete(onSlotChange);
      if (currentCbs.size === 0) {
        clinicCallbacks.delete(clinicId);
      }
    }

    if (entry) {
      entry.refCount--;
      if (entry.refCount <= 0) {
        activeClinicChannels.delete(clinicId);
        try {
          supabase.removeChannel(entry.channel);
        } catch (err) {
          console.debug("[slotAvailabilityRealtime] Unsubscribe notice:", err);
        }
      }
    }
  };
}

/**
 * Raised when the authoritative availability RPC could not be read. Callers MUST keep
 * their previous snapshot (unknown is NOT the same as free) and never fabricate
 * occupancy or availability from local caches or RLS-filtered table reads.
 */
export class AuthoritativeSlotsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoritativeSlotsUnavailableError";
  }
}

/**
 * Pure mapping of `get_occupied_appointment_slots` rows to client records.
 * - `payment_hold_expires_at` / `db_now` are passed through EXACTLY as the database
 *   returned them. Nothing is invented: when absent (older RPC version) they stay
 *   null and the row is trusted because the RPC already excludes expired holds.
 * - A row is `reserved` only when the database says so; anything else is `booked`.
 */
export function mapOccupiedSlotRows(rows: any[], clinicId: string, cleanDate: string): OccupiedSlotRecord[] {
  const bySlotAndDoc = new Map<string, OccupiedSlotRecord>();
  for (const s of rows || []) {
    const slotTimeClean = String(s.slot_time || "").slice(0, 5);
    if (!slotTimeClean) continue;
    const occType: "reserved" | "booked" = s.occupancy_type === "reserved" ? "reserved" : "booked";
    const docId = s.assigned_doctor_id ?? null;
    const key = `${slotTimeClean}|${docId ?? ""}`;
    const existing = bySlotAndDoc.get(key);
    // Enforce BOOKED > RESERVED priority if duplicate rows exist for the same slot & doctor scope
    if (existing && existing.occupancy_type === "booked" && occType === "reserved") {
      continue;
    }
    bySlotAndDoc.set(key, {
      date: s.slot_date ? String(s.slot_date).slice(0, 10) : cleanDate,
      time: slotTimeClean,
      batch_time: slotTimeClean,
      assigned_doctor_id: docId,
      clinic_id: s.clinic_id || clinicId,
      status: occType === "reserved" ? "pending" : "scheduled",
      doctor_status: "approved",
      payment_status: occType === "reserved" ? "pending_hold" : "paid",
      occupancy_type: occType,
      payment_hold_expires_at: s.payment_hold_expires_at ?? null,
      db_now: s.db_now ?? null,
    });
  }
  return Array.from(bySlotAndDoc.values());
}

/**
 * Authoritatively retrieves occupied appointment slots for a clinic and Manila date from
 * the database RPC `get_occupied_appointment_slots` (privacy-preserving: no patient data).
 *
 * - Queries `p_doctor_id: null` so clinic-wide unassigned holds (`assigned_doctor_id IS NULL`)
 *   are always included alongside doctor-specific holds, then filters by `doctorScopesOverlap`
 *   when `doctorId` is provided.
 * - THROWS `AuthoritativeSlotsUnavailableError` when the RPC cannot be read. There is
 *   deliberately NO table / localStorage fallback: patients can only read their own
 *   appointment rows (RLS), so any fallback would silently show other patients' slots
 *   as available.
 */
export async function fetchAuthoritativeOccupiedSlots({
  clinicId,
  date,
  doctorId,
}: {
  clinicId: string;
  date: string;
  doctorId?: string | null;
}): Promise<OccupiedSlotRecord[]> {
  if (!clinicId || !date) return [];

  const cleanDate = getManilaCalendarDate(date);
  const cleanDocId = isValidUuid(doctorId) ? doctorId : null;
  if (!isValidUuid(clinicId)) {
    throw new AuthoritativeSlotsUnavailableError("Clinic id is not a valid UUID; availability cannot be verified.");
  }

  const { data, error } = await (supabase.rpc as any)("get_occupied_appointment_slots", {
    p_clinic_id: clinicId,
    p_date: cleanDate,
    p_doctor_id: null,
  });

  if (error || !Array.isArray(data)) {
    throw new AuthoritativeSlotsUnavailableError(error?.message || "get_occupied_appointment_slots returned no data.");
  }
  const allSlots = mapOccupiedSlotRows(data, clinicId, cleanDate);
  if (!cleanDocId) return allSlots;
  return allSlots.filter((r) => doctorScopesOverlap(r.assigned_doctor_id, cleanDocId));
}

/**
 * React Hook for automatic real-time slot availability updates.
 *
 * Automatically triggers `onRefresh`:
 * - When another patient reserves or books a slot (via Realtime Broadcast or Window event)
 * - When doctor or date changes
 * - When the browser tab gains focus or becomes visible (visibilitychange / window focus)
 * - Periodic polling fallback (every 4-5 seconds) while page is visible
 * - Automatically debounces rapid duplicate events (250ms)
 */
export function useSlotAvailabilityRealtime({
  clinicId,
  selectedDate,
  doctorId: _doctorId,
  enabled = true,
  pollingIntervalMs = 5000,
  onRefresh,
}: {
  clinicId?: string | null;
  selectedDate?: string | null;
  doctorId?: string | null;
  enabled?: boolean;
  pollingIntervalMs?: number;
  onRefresh: (payload?: BroadcastSlotChangePayload) => void;
}): void {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  // The viewed date is read through a ref so a date change never tears down and
  // re-creates the clinic channel (which would open a gap where events are missed).
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const triggerDebouncedRefresh = useCallback((payload?: BroadcastSlotChangePayload) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    // Instantaneous invocation on broadcast/local events for zero-latency UI update
    if (payload) {
      try {
        onRefreshRef.current(payload);
      } catch (err) {
        console.warn("[slotAvailabilityRealtime] onRefresh immediate payload error:", err);
      }
    }
    // Schedule debounced full state sync
    debounceTimerRef.current = setTimeout(() => {
      onRefreshRef.current();
    }, 250);
  }, []);

  // 1. Supabase Realtime Subscription (Broadcast & Postgres changes & Local events)
  useEffect(() => {
    if (!enabled || !clinicId) return;

    const unsubscribe = subscribeToClinicSlotChanges(clinicId, (payload) => {
      // Ignore ONLY events for a strictly DIFFERENT Manila calendar date than the one being viewed
      const viewedDate = selectedDateRef.current;
      if (payload?.date && viewedDate) {
        const payloadDate = getManilaCalendarDate(payload.date);
        const currentDate = getManilaCalendarDate(viewedDate);
        if (payloadDate !== currentDate) {
          return;
        }
      }
      triggerDebouncedRefresh(payload);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [clinicId, enabled, triggerDebouncedRefresh]);

  // 2. Tab Visibility & Focus Listener (Refresh immediately when user returns to tab)
  useEffect(() => {
    if (!enabled || !clinicId) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        triggerDebouncedRefresh();
      }
    };

    const handleFocus = () => {
      triggerDebouncedRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled, clinicId, triggerDebouncedRefresh]);

  // 3. Periodic Polling Fallback (Only while page is visible)
  useEffect(() => {
    if (!enabled || !clinicId || !pollingIntervalMs || pollingIntervalMs <= 0) return;

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      onRefreshRef.current();
    }, pollingIntervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, clinicId, pollingIntervalMs]);
}
