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
  payment_hold_expires_at?: string | null;
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
            setTimeout(() => {
              try {
                supabase.removeChannel(channel);
              } catch {}
            }, 3000);
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

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.debug(`[slotAvailabilityRealtime] Subscribed to realtime availability for clinic ${clinicId}`);
      }
    });
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
 * Authoritatively retrieves occupied appointment slots for a clinic and date.
 * Strictly differentiates between 'reserved' (active temporary checkout hold) and 'booked' (confirmed/paid).
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
  const cleanClinicId = isValidUuid(clinicId) ? clinicId : null;
  const bookingsList: OccupiedSlotRecord[] = [];
  let rpcSucceeded = false;

  // 1. Authoritative privacy-preserving RPC call
  if (cleanClinicId) {
    try {
      const { data: rpcSlots, error: rpcErr } = await (supabase.rpc as any)(
        "get_occupied_appointment_slots",
        {
          p_clinic_id: cleanClinicId,
          p_date: cleanDate,
          p_doctor_id: cleanDocId,
        }
      );

      if (!rpcErr && rpcSlots && Array.isArray(rpcSlots)) {
        rpcSucceeded = true;
        for (const s of rpcSlots) {
          const slotTimeClean = (s.slot_time || "").slice(0, 5);
          if (!slotTimeClean) continue;

          const occType: "reserved" | "booked" =
            s.occupancy_type === "reserved" || s.payment_status === "pending_hold"
              ? "reserved"
              : "booked";

          bookingsList.push({
            date: cleanDate,
            time: slotTimeClean,
            batch_time: slotTimeClean,
            assigned_doctor_id: s.assigned_doctor_id,
            clinic_id: s.clinic_id || cleanClinicId,
            status: occType === "reserved" ? "pending" : "scheduled",
            doctor_status: "approved",
            payment_status: occType === "reserved" ? "pending_hold" : "paid",
            occupancy_type: occType,
            payment_hold_expires_at: s.payment_hold_expires_at || null,
          });
        }
      } else if (rpcErr) {
        console.debug("[slotAvailabilityRealtime] RPC query response:", rpcErr.message || rpcErr);
      }
    } catch (rpcEx) {
      console.debug("[slotAvailabilityRealtime] RPC query fallback:", rpcEx);
    }
  }

  // 2. Direct table fallback ONLY if RPC failed / threw an error
  if (!rpcSucceeded && cleanClinicId) {
    try {
      let query = supabase
        .from("patient_appointment")
        .select("appointment_id, date, time, batch_time, queue_number, status, doctor_status, assigned_doctor_id, clinic_id, payment_status, payment_hold_expires_at")
        .eq("clinic_id", cleanClinicId)
        .neq("status", "cancelled")
        .neq("status", "rejected");

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        const nowMs = Date.now();
        const matched = data.filter((row: any) => {
          if (!row.date) return false;
          const st = String(row.status || "").toLowerCase().trim();
          if (st === "cancelled" || st === "rejected" || st === "declined") return false;
          const docSt = String(row.doctor_status || "").toLowerCase().trim();
          if (docSt === "rejected" || docSt === "declined") return false;

          const paySt = String(row.payment_status || "").toLowerCase().trim();
          if (paySt === "cancelled" || paySt === "expired" || paySt === "failed") return false;
          if (paySt === "pending_hold" && row.payment_hold_expires_at) {
            const exp = new Date(row.payment_hold_expires_at).getTime();
            if (!isNaN(exp) && exp <= nowMs) return false;
          }

          return getManilaCalendarDate(row.date) === cleanDate;
        });

        for (const m of matched) {
          const mTime = (m.time || m.batch_time || "").slice(0, 5);
          const mDocId = m.assigned_doctor_id;
          const exists = bookingsList.some((b) => {
            const bTime = (b.time || b.batch_time || "").slice(0, 5);
            const bDocId = b.assigned_doctor_id;
            return bTime === mTime && (!mDocId || !bDocId || String(bDocId) === String(mDocId));
          });

          if (!exists) {
            const occType: "reserved" | "booked" =
              m.payment_status === "pending_hold" ? "reserved" : "booked";

            bookingsList.push({
              appointment_id: m.appointment_id,
              date: cleanDate,
              time: mTime,
              batch_time: mTime,
              assigned_doctor_id: mDocId,
              clinic_id: m.clinic_id || cleanClinicId,
              status: m.status || "scheduled",
              doctor_status: m.doctor_status || "approved",
              payment_status: m.payment_status || "paid",
              occupancy_type: occType,
              payment_hold_expires_at: m.payment_hold_expires_at,
            });
          }
        }
      }
    } catch (tabEx) {
      console.debug("[slotAvailabilityRealtime] Table query fallback:", tabEx);
    }
  }

  // 3. Merge local demo/cached bookings ONLY if RPC failed / unavailable
  if (!rpcSucceeded) {
    try {
      const rawLocal = localStorage.getItem("dermai_clinic_appointments");
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (Array.isArray(parsed)) {
        for (const loc of parsed) {
          const locClinicId = String(loc.clinic_id || loc.clinicId || "");
          if (locClinicId === String(clinicId)) {
            const locDateStr = getManilaCalendarDate(loc.date);
            if (locDateStr === cleanDate) {
              const locTime = (loc.time || loc.batch_time || loc.batchTime || "").slice(0, 5);
              const locDocId = loc.assigned_doctor_id || loc.assignedDoctorId;
              const exists = bookingsList.some((b) => {
                const bTime = (b.time || b.batch_time || "").slice(0, 5);
                const bDocId = b.assigned_doctor_id;
                return bTime === locTime && (!locDocId || !bDocId || String(bDocId) === String(locDocId));
              });

              if (!exists) {
                const paySt = String(loc.payment_status || loc.paymentStatus || "").toLowerCase();
                const occType: "reserved" | "booked" = paySt === "pending_hold" ? "reserved" : "booked";

                bookingsList.push({
                  appointment_id: loc.appointment_id || loc.id,
                  date: cleanDate,
                  time: locTime,
                  batch_time: locTime,
                  assigned_doctor_id: locDocId,
                  clinic_id: clinicId,
                  status: loc.status || "scheduled",
                  doctor_status: loc.doctor_status || "approved",
                  payment_status: loc.payment_status || "paid",
                  occupancy_type: occType,
                  payment_hold_expires_at: loc.payment_hold_expires_at || loc.paymentHoldExpiresAt,
                });
              }
            }
          }
        }
      }
    }
    } catch {}
  }

  return bookingsList;
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
      // If date is provided in payload and doesn't match selectedDate, ignore ONLY if it's strictly a DIFFERENT Manila calendar date
      if (payload?.date && selectedDate) {
        const payloadDate = getManilaCalendarDate(payload.date);
        const currentDate = getManilaCalendarDate(selectedDate);
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
  }, [clinicId, selectedDate, enabled, triggerDebouncedRefresh]);

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
