/**
 * DermAI — Slot availability state (pure, framework-free, no Supabase import).
 *
 * Design contract (the database is the ONLY authority):
 *
 *  - The authoritative snapshot is whatever `get_occupied_appointment_slots`
 *    last returned for the viewed clinic + Manila date. A successful response
 *    REPLACES the snapshot wholesale; the frontend never keeps a reservation the
 *    database no longer reports. A FAILED fetch changes nothing (unknown != free).
 *  - Realtime broadcasts are only *hints*. A hint becomes a short-lived
 *    "overlay" so the UI reacts instantly, but it is discarded as soon as an
 *    authoritative fetch that STARTED AFTER the event was observed completes.
 *    That fetch either confirms it (the record is now real) or refutes it
 *    (the slot is simply not shown as occupied).
 *  - A response whose fetch STARTED BEFORE an event was observed is stale for
 *    that slot: the overlay is kept, so a slow poll can never revert a newer
 *    RESERVED / BOOKED / AVAILABLE transition.
 *  - Exact duplicate events (same sender timestamp/type/slot, e.g. the local
 *    window event + the WebSocket self-echo + the cross-tab storage signal)
 *    collapse into one, so a delayed echo cannot resurrect a released hold.
 *  - No expiry timestamp is ever invented. Hold expiry is judged ONLY on the
 *    database clock (offset derived from the RPC's `db_now`), never by the raw
 *    browser clock. The RPC already filters expired holds; the offset only
 *    removes a hold between two polls without trusting a skewed local clock.
 *  - State priority: BOOKED > RESERVED > AVAILABLE.
 */

import type { OccupiedSlotRecord } from "./slotAvailabilityRealtime";

export type SlotChangeType =
  | "hold_acquired"
  | "hold_released"
  | "payment_completed"
  | "cancelled"
  | "update";

export interface SlotChangeEvent {
  date?: string;
  slotTime?: string;
  doctorId?: string | null;
  changeType?: SlotChangeType;
  /** Sender timestamp; identical across local/WebSocket/storage copies of ONE event. */
  timestamp?: number;
}

type OverlayKind = "reserved" | "booked" | "released";

interface Overlay {
  date: string;
  time: string;
  doctorId: string | null;
  kind: OverlayKind;
  observedAt: number;
}

/** A provisional overlay can never outlive one hold window (policy: 10 minutes) + grace. */
export const OVERLAY_MAX_AGE_MS = 11 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeSlotTime(raw?: string | null): string {
  return String(raw || "").trim().slice(0, 5);
}

/**
 * Doctor overlap rule. null/undefined = unassigned = clinic-wide (overlaps every
 * doctor). Mixed UUID / local-id comparisons cannot be resolved, so they are
 * treated as overlapping (conservative: never show a possibly-taken slot free).
 */
export function doctorScopesOverlap(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  const xu = UUID_RE.test(x);
  const yu = UUID_RE.test(y);
  if (xu !== yu) return true;
  return x === y;
}

function recordTime(r: Partial<OccupiedSlotRecord>): string {
  return normalizeSlotTime(r.time || r.batch_time);
}

function isReservedRecord(r: Partial<OccupiedSlotRecord>): boolean {
  return r.occupancy_type === "reserved" || (r.occupancy_type == null && r.payment_status === "pending_hold");
}

export class SlotAvailabilityTracker {
  private snapshot: OccupiedSlotRecord[] = [];
  private overlays: Overlay[] = [];
  private seenEvents = new Map<string, number>();
  private date = "";
  private scopeKey = "";
  private doctorId: string | null = null;
  /** Start time of the newest authoritative fetch already applied (older responses are ignored). */
  private lastFetchStartedAt = 0;
  /** dbNow - localNow when the last authoritative response arrived (null = unknown). */
  private clockOffsetMs: number | null = null;

  /**
   * Select the (clinic scope, date, doctor) the UI displays. A DATE or SCOPE (clinic) change
   * drops the old snapshot, clock offset and fetch-order guard (they belong to another view).
   * A doctor change keeps them: the snapshot is clinic-wide for the date and is filtered per
   * doctor in `visible()`.
   */
  setView(date: string, doctorId?: string | null, scopeKey: string = ""): void {
    if (date !== this.date || scopeKey !== this.scopeKey) {
      this.snapshot = [];
      this.clockOffsetMs = null;
      this.lastFetchStartedAt = 0;
    }
    if (scopeKey !== this.scopeKey) {
      this.overlays = [];
      this.seenEvents.clear();
    }
    this.date = date;
    this.scopeKey = scopeKey;
    this.doctorId = doctorId ? String(doctorId) : null;
  }

  reset(): void {
    this.snapshot = [];
    this.overlays = [];
    this.seenEvents.clear();
    this.clockOffsetMs = null;
    this.lastFetchStartedAt = 0;
  }

  /** Database-clock "now" (null when the database clock is unknown). */
  serverNow(localNow: number = Date.now()): number | null {
    return this.clockOffsetMs == null ? null : localNow + this.clockOffsetMs;
  }

  /**
   * Record a Realtime hint. Returns true when it produced/updated a slot overlay.
   * Callers must still schedule an authoritative refetch regardless of the result.
   * Idempotent for exact duplicates.
   */
  applyEvent(ev: SlotChangeEvent | undefined | null, observedAt: number = Date.now()): boolean {
    if (!ev || !ev.slotTime || !ev.date) return false;
    const date = ev.date.slice(0, 10);
    const time = normalizeSlotTime(ev.slotTime);
    if (!time) return false;

    let kind: OverlayKind | null = null;
    if (ev.changeType === "hold_acquired") kind = "reserved";
    else if (ev.changeType === "payment_completed") kind = "booked";
    else if (ev.changeType === "hold_released" || ev.changeType === "cancelled") kind = "released";
    if (!kind) return false;

    const doctorId = ev.doctorId ? String(ev.doctorId) : null;

    if (ev.timestamp != null) {
      const key = `${ev.timestamp}|${ev.changeType}|${date}|${time}|${doctorId ?? ""}`;
      for (const [k, t] of this.seenEvents) {
        if (observedAt - t > OVERLAY_MAX_AGE_MS) this.seenEvents.delete(k);
      }
      if (this.seenEvents.has(key)) return false; // exact duplicate of an already-applied event
      this.seenEvents.set(key, observedAt);
    }

    this.overlays = this.overlays.filter(
      (o) => !(o.date === date && o.time === time && (o.doctorId ?? "") === (doctorId ?? ""))
    );
    this.overlays.push({ date, time, doctorId, kind, observedAt });
    return true;
  }

  /**
   * Apply a SUCCESSFUL authoritative database response.
   * @param records        rows returned by get_occupied_appointment_slots (mapped)
   * @param fetchStartedAt local timestamp taken BEFORE the request was sent
   * @param options.forDate / options.scopeKey  the view the request was made for; a response for a
   *        different date/clinic than the one now displayed is ignored.
   *
   * Responses are applied in fetch-START order: a response from an older fetch than one already
   * applied is dropped, so out-of-order network completion can never roll the snapshot back.
   */
  applyAuthoritative(
    records: OccupiedSlotRecord[],
    fetchStartedAt: number,
    options?: { dbNow?: string | null; receivedAt?: number; forDate?: string; scopeKey?: string }
  ): OccupiedSlotRecord[] {
    const receivedAt = options?.receivedAt ?? Date.now();
    if (options?.forDate !== undefined && options.forDate !== this.date) return this.visible(receivedAt);
    if (options?.scopeKey !== undefined && options.scopeKey !== this.scopeKey) return this.visible(receivedAt);
    if (fetchStartedAt < this.lastFetchStartedAt) return this.visible(receivedAt);
    this.lastFetchStartedAt = fetchStartedAt;

    let dbNow = options?.dbNow ?? null;
    if (!dbNow) {
      const withClock = records.find((r) => r.db_now);
      dbNow = withClock?.db_now ?? null;
    }
    if (dbNow) {
      const t = new Date(dbNow).getTime();
      if (!isNaN(t)) this.clockOffsetMs = t - receivedAt;
    }
    this.snapshot = records.map((r) => ({ ...r }));
    // Events observed at/before the fetch start are superseded by this response;
    // newer events are retained because this response is stale for them.
    this.overlays = this.overlays.filter(
      (o) => o.observedAt > fetchStartedAt && receivedAt - o.observedAt <= OVERLAY_MAX_AGE_MS
    );
    return this.visible(receivedAt);
  }

  /** Projection shown to the UI: authoritative snapshot + still-valid newer hints. */
  visible(localNow: number = Date.now()): OccupiedSlotRecord[] {
    const serverNow = this.serverNow(localNow);
    let result: OccupiedSlotRecord[] = [];

    for (const rec of this.snapshot) {
      if (!doctorScopesOverlap(rec.assigned_doctor_id, this.doctorId)) continue;
      const copy: OccupiedSlotRecord = { ...rec };
      const dbExpiry = rec.payment_hold_expires_at;
      if (isReservedRecord(rec) && dbExpiry) {
        const exp = new Date(dbExpiry).getTime();
        if (!isNaN(exp) && serverNow != null && exp <= serverNow) {
          continue; // genuinely expired on the DATABASE clock
        }
        // Keep the real DB value for diagnostics, but stop downstream scheduling code
        // from re-judging it against the (possibly skewed) browser clock.
        copy.db_hold_expires_at = dbExpiry;
        copy.payment_hold_expires_at = null;
      }
      result.push(copy);
    }

    for (const ov of this.overlays) {
      if (localNow - ov.observedAt > OVERLAY_MAX_AGE_MS) continue;
      if (this.date && ov.date !== this.date) continue;
      if (!doctorScopesOverlap(ov.doctorId, this.doctorId)) continue;

      const matches = (r: OccupiedSlotRecord) =>
        recordTime(r) === ov.time && doctorScopesOverlap(ov.doctorId, r.assigned_doctor_id);

      if (ov.kind === "released") {
        // A release can only ever clear a RESERVED record, never a confirmed BOOKED one.
        result = result.filter((r) => !(matches(r) && isReservedRecord(r)));
      } else if (ov.kind === "booked") {
        const idx = result.findIndex(matches);
        const booked: OccupiedSlotRecord = {
          date: ov.date,
          time: ov.time,
          batch_time: ov.time,
          assigned_doctor_id: ov.doctorId ?? this.doctorId,
          clinic_id: idx >= 0 ? result[idx].clinic_id : undefined,
          status: "scheduled",
          doctor_status: "approved",
          payment_status: "paid",
          occupancy_type: "booked",
          payment_hold_expires_at: null,
          provisional: true,
        };
        if (idx >= 0) result[idx] = { ...result[idx], ...booked };
        else result.push(booked);
      } else if (!result.some(matches)) {
        // reserved: only fills a gap; never downgrades an existing BOOKED/RESERVED record.
        result.push({
          date: ov.date,
          time: ov.time,
          batch_time: ov.time,
          assigned_doctor_id: ov.doctorId ?? this.doctorId,
          status: "pending",
          doctor_status: "approved",
          payment_status: "pending_hold",
          occupancy_type: "reserved",
          payment_hold_expires_at: null,
          provisional: true,
        });
      }
    }
    return result;
  }
}

/* -------------------------------------------------------------------------- */
/* Retained Held-Slot Metadata Tracker (independent of UI `selectedTime`)     */
/* -------------------------------------------------------------------------- */

export interface HeldSlotMetadata {
  appointmentId: string;
  clinicId: string;
  date: string;
  doctorId: string | null;
  slotTime: string;
}

/**
 * Retains the exact held appointment coordinates independently of `selectedTime`.
 *
 * - Survives self-broadcast `hold_acquired` events and UI `RESERVED` transitions that
 *   clear `selectedTime` to `""`.
 * - Never fabricates a fallback time (such as `"08:00"`).
 * - Clears ONLY when the hold has been successfully released, successfully fulfilled
 *   (payment completed), or definitively confirmed as no longer active.
 */
export class HeldSlotTracker {
  private current: HeldSlotMetadata | null = null;

  record(meta: HeldSlotMetadata): HeldSlotMetadata | null {
    const appointmentId = String(meta.appointmentId || "").trim();
    const clinicId = String(meta.clinicId || "").trim();
    const date = String(meta.date || "").trim().slice(0, 10);
    const slotTime = normalizeSlotTime(meta.slotTime);
    const doctorId = meta.doctorId ? String(meta.doctorId).trim() : null;

    if (!appointmentId || !clinicId || !date || !slotTime) {
      return this.get();
    }

    this.current = {
      appointmentId,
      clinicId,
      date,
      doctorId,
      slotTime,
    };
    return this.get();
  }

  get(): HeldSlotMetadata | null {
    return this.current ? { ...this.current } : null;
  }

  getForAppointment(appointmentId?: string | null): HeldSlotMetadata | null {
    if (!this.current) return null;
    if (appointmentId && this.current.appointmentId !== String(appointmentId).trim()) {
      return null;
    }
    return { ...this.current };
  }

  /**
   * Checks whether the current patient owns an active hold for the given slot.
   */
  matches(date?: string | null, slotTime?: string | null, doctorId?: string | null): boolean {
    if (!this.current) return false;
    if (!date || !slotTime) return false;
    const matchDate = this.current.date === date.slice(0, 10);
    const matchTime = this.current.slotTime === normalizeSlotTime(slotTime);
    const matchDoc = doctorScopesOverlap(this.current.doctorId, doctorId);
    return matchDate && matchTime && matchDoc;
  }

  /**
   * Receiving a Realtime event (including the browser's own `hold_acquired` broadcast)
   * must NEVER clear the retained held-slot metadata needed for checkout cancellation.
   */
  onRealtimeEvent(_ev?: SlotChangeEvent | null): HeldSlotMetadata | null {
    return this.get();
  }

  /**
   * Clears retained metadata ONLY when the hold release succeeded or the hold was
   * definitively confirmed as already inactive (cancelled / expired).
   * A failed or unauthorized release preserves the retained metadata.
   */
  clearOnReleaseResult(result?: {
    success?: boolean;
    alreadyInactive?: boolean;
  } | null): boolean {
    if (result && (result.success === true || result.alreadyInactive === true)) {
      this.current = null;
      return true;
    }
    return false;
  }

  /**
   * Clears retained metadata when payment succeeds, without releasing the paid appointment.
   */
  clearOnPaymentSuccess(appointmentId?: string | null): boolean {
    if (!this.current) return false;
    if (appointmentId && this.current.appointmentId !== String(appointmentId).trim()) {
      return false;
    }
    this.current = null;
    return true;
  }

  /**
   * Clears retained metadata when an authoritative database check confirms the hold
   * is no longer active (e.g. expired or cancelled).
   */
  clearConfirmedInactive(appointmentId?: string | null): boolean {
    if (!this.current) return false;
    if (appointmentId && this.current.appointmentId !== String(appointmentId).trim()) {
      return false;
    }
    this.current = null;
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Hold-acquisition failure classification                                     */
/* -------------------------------------------------------------------------- */

export type HoldFailureKind = "slot_conflict" | "schedule_config" | "other";

/**
 * A slot conflict means ANOTHER occupant owns the slot. It is NOT a cancellation:
 * callers must never release a hold or broadcast `hold_released` for it.
 */
export function classifyHoldFailure(code?: string | null, message?: string | null): HoldFailureKind {
  const text = `${code || ""} ${message || ""}`.toLowerCase();
  if (
    text.includes("err_slot_unavailable") ||
    text.includes("err_duplicate_slot") ||
    text.includes("exclusive_doctor_slot") ||
    text.includes("exclusive_unassigned_slot") ||
    text.includes("already reserved") ||
    text.includes("already booked") ||
    text.includes("reserved by another patient") ||
    text.includes("booked by another patient")
  ) {
    return "slot_conflict";
  }
  if (text.includes("err_schedule_config") || text.includes("appointment interval") || text.includes("duty schedule")) {
    return "schedule_config";
  }
  return "other";
}

/** Deterministic business denials from cancel_appointment_hold: never retry via a direct table update. */
export function isDefinitiveReleaseDenial(code?: string | null): boolean {
  return [
    "ERR_FORBIDDEN",
    "ERR_UNAUTHORIZED",
    "ERR_ALREADY_PAID",
    "ERR_NOT_FOUND",
    "ERR_INVALID_STATUS",
    "ERR_CONCURRENT_STATE_CHANGE",
    "ERR_INVALID_PARAMS",
  ].includes(String(code || "").toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Realtime channel status handling (reconnect => authoritative resync)       */
/* -------------------------------------------------------------------------- */

/**
 * Returns a status callback for `channel.subscribe(cb)`. It fires `onResync`
 * on the FIRST successful subscription (closes the gap between the initial
 * fetch and the socket join) and on EVERY re-subscription after a disconnect
 * (CHANNEL_ERROR / TIMED_OUT / CLOSED), so missed broadcasts are recovered
 * from the database instead of being assumed delivered.
 */
export function createRealtimeStatusHandler(onResync: (reason: "initial" | "reconnect") => void) {
  let everSubscribed = false;
  let wasDisconnected = false;
  return (status: string): void => {
    if (status === "SUBSCRIBED") {
      const reason: "initial" | "reconnect" | null = !everSubscribed ? "initial" : wasDisconnected ? "reconnect" : null;
      everSubscribed = true;
      wasDisconnected = false;
      if (reason) onResync(reason);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      wasDisconnected = true;
    }
  };
}
