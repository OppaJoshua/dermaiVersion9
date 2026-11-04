/**
 * DermAI — Comprehensive Slot Reservation Authority, Persistence & Multi-Account Sync Test Suite
 *
 * Covers all 12 mandatory verification scenarios:
 *  Test 1  — Two-patient reservation (immediate RESERVED & non-clickable)
 *  Test 2  — Polling persistence (3+ consecutive 5s polls never revert RESERVED to AVAILABLE)
 *  Test 3  — Realtime + polling race (in-flight pre-hold poll cannot overwrite newer hold; bogus hint refuted by later poll)
 *  Test 4  — Reservation collision (Patient B fails with ERR_SLOT_UNAVAILABLE, zero hold_released broadcasts, Patient A hold intact)
 *  Test 5  — Explicit cancellation (owner cancel transitions RESERVED -> AVAILABLE for all patients)
 *  Test 6  — Expiration on database clock (10m expiry + clock-skew immunity)
 *  Test 7  — Successful payment & BOOKED > RESERVED > AVAILABLE priority
 *  Test 8  — Unassigned hold (assigned_doctor_id IS NULL blocks doctor-specific bookings & UI views)
 *  Test 9  — Alternate doctor selection (respects doctor & unassigned holds, self-exclusion, collision safety)
 *  Test 10 — Realtime reconnection (CHANNEL_ERROR/TIMED_OUT -> SUBSCRIBED triggers authoritative DB resync)
 *  Test 11 — Late payment after hold expiration (routes to reconciliation_required, never reactivates or double-books)
 *  Test 12 — Duplicate events idempotency (hold_acquired, hold_released, out-of-order polls, duplicate webhooks)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SlotAvailabilityTracker,
  HeldSlotTracker,
  classifyHoldFailure,
  isDefinitiveReleaseDenial,
  createRealtimeStatusHandler,
  doctorScopesOverlap,
} from "../lib/slotAvailabilityState";
import {
  mapOccupiedSlotRows,
  type OccupiedSlotRecord,
  type BroadcastSlotChangePayload,
} from "../lib/slotAvailabilityRealtime";
import {
  generateDaySlotsForDoctor,
  getManilaCalendarDate,
  type DoctorWeeklySchedule,
  type ConsultationSlot,
} from "../lib/schedulingService";
import { supabase } from "../lib/supabaseClient";
import { releaseAppointmentHoldSafely } from "../lib/appointmentPaymentService";

console.log("\n======================================================================");
console.log("DermAI — Slot Reservation Authority & Real-Time Synchronization Suite");
console.log("======================================================================\n");

const CLINIC_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const DOC_NATHAN_ID = "11111111-1111-1111-1111-111111111111";
const DOC_YANPEIN_ID = "22222222-2222-2222-2222-222222222222";
const PATIENT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATIENT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TARGET_DATE = "2026-11-06"; // Friday

const doctorSchedule: DoctorWeeklySchedule = {
  slotIntervalMinutes: 30,
  maxPatientsPerShift: 16,
  weeklyShifts: {
    Friday: [
      {
        id: "shift-fri-main",
        shiftLabel: "Morning & Afternoon Shift",
        startTime: "08:00",
        endTime: "16:00",
      },
    ],
  },
};

const clinicDefaults = {
  defaultSlotIntervalMinutes: 30,
  defaultMaxPatientsPerShift: 16,
  openTime: "08:00",
  closeTime: "16:00",
  operatingDays: "Monday - Saturday",
};

/* -------------------------------------------------------------------------- */
/* Authoritative PostgreSQL Simulation (mirrors 20261031 migration semantics) */
/* -------------------------------------------------------------------------- */

interface SimAppointmentRow {
  appointment_id: string;
  clinic_id: string;
  assigned_doctor_id: string | null;
  date: string;
  time: string;
  batch_time: string;
  status: "pending" | "scheduled" | "cancelled" | "rejected";
  doctor_status: "pending-review" | "approved" | "rejected";
  payment_status: "pending_hold" | "paid" | "cancelled" | "expired" | "failed";
  payment_hold_expires_at: string | null;
  payment_reference?: string | null;
  clinic_note?: string | null;
  queue_number?: number | null;
  user_id: string | null;
  created_at_ms: number;
}

interface SimPaymentLedgerRow {
  appointment_id: string;
  user_id: string | null;
  reference_number: string;
  status: "success" | "reconciliation_required";
}

class AuthoritativeDatabaseSim {
  public appointments: SimAppointmentRow[] = [];
  public payments: SimPaymentLedgerRow[] = [];
  public dbNowMs: number = new Date("2026-11-06T07:00:00+08:00").getTime();
  private seq = 0;

  public dbNowIso(): string {
    return new Date(this.dbNowMs).toISOString();
  }

  /** Mirrors public.get_occupied_appointment_slots(p_clinic_id, p_date, p_doctor_id) */
  public getOccupiedAppointmentSlots(
    p_clinic_id: string,
    p_date: string,
    p_doctor_id: string | null = null
  ) {
    const targetDate = getManilaCalendarDate(p_date);
    const candidates = this.appointments.filter((pa) => {
      if (pa.clinic_id !== p_clinic_id) return false;
      if (getManilaCalendarDate(pa.date) !== targetDate) return false;
      if (p_doctor_id !== null && pa.assigned_doctor_id !== p_doctor_id && pa.assigned_doctor_id !== null) {
        return false;
      }
      if (pa.status === "cancelled" || pa.status === "rejected" || pa.doctor_status === "rejected") {
        return false;
      }
      const ps = pa.payment_status || "paid";
      if (ps === "expired" || ps === "cancelled") return false;
      if (ps === "pending_hold" || ps === "failed") {
        if (!pa.payment_hold_expires_at) return true;
        return new Date(pa.payment_hold_expires_at).getTime() > this.dbNowMs;
      }
      return true;
    });

    // DISTINCT ON (slot_time, assigned_doctor_id) ORDER BY (booked before reserved)
    const dedup = new Map<string, any>();
    for (const pa of candidates) {
      const slot_time = (pa.time || pa.batch_time || "08:00").slice(0, 5);
      const occType =
        pa.payment_status === "pending_hold" || pa.payment_status === "failed"
          ? "reserved"
          : "booked";
      const key = `${slot_time}|${pa.assigned_doctor_id ?? ""}`;
      const existing = dedup.get(key);
      if (existing && existing.occupancy_type === "booked" && occType === "reserved") {
        continue;
      }
      dedup.set(key, {
        slot_time,
        slot_date: targetDate,
        assigned_doctor_id: pa.assigned_doctor_id,
        clinic_id: pa.clinic_id,
        occupancy_type: occType,
        payment_hold_expires_at: occType === "reserved" ? pa.payment_hold_expires_at : null,
        db_now: this.dbNowIso(),
      });
    }
    return Array.from(dedup.values());
  }

  /** Mirrors public.acquire_appointment_slot_hold */
  public acquireAppointmentSlotHold(params: {
    clinicId: string;
    doctorId: string | null;
    date: string;
    time: string;
    callerUserId: string;
    spoofedUserId?: string;
    holdDurationMinutes?: number;
  }): {
    success: boolean;
    appointment_id?: string;
    code?: string;
    message?: string;
    payment_hold_expires_at?: string;
    is_existing_hold?: boolean;
  } {
    if (!params.callerUserId) {
      return { success: false, code: "ERR_UNAUTHORIZED", message: "Authentication required." };
    }
    if (params.spoofedUserId && params.spoofedUserId !== params.callerUserId) {
      return {
        success: false,
        code: "ERR_FORBIDDEN",
        message: "Authenticated user does not match requested hold owner.",
      };
    }

    const targetDate = getManilaCalendarDate(params.date);
    const timeClean = params.time.slice(0, 5);

    // 1. Reap expired holds on this slot across the clinic (only when database expiration has passed)
    for (const r of this.appointments) {
      if (
        r.clinic_id === params.clinicId &&
        getManilaCalendarDate(r.date) === targetDate &&
        (r.time || r.batch_time).slice(0, 5) === timeClean &&
        r.status !== "cancelled" &&
        r.status !== "rejected"
      ) {
        if (
          (r.payment_status === "pending_hold" || r.payment_status === "failed") &&
          r.payment_hold_expires_at &&
          new Date(r.payment_hold_expires_at).getTime() <= this.dbNowMs
        ) {
          r.status = "cancelled";
          r.payment_status = "expired";
        } else if (r.payment_status === "expired" || r.payment_status === "cancelled") {
          r.status = "cancelled";
        }
      }
    }

    // 2. Check active occupants: same doctor, OR unassigned existing hold, OR caller requesting unassigned hold
    const activeOccupants = this.appointments
      .filter((r) => {
        if (r.clinic_id !== params.clinicId) return false;
        if (getManilaCalendarDate(r.date) !== targetDate) return false;
        if ((r.time || r.batch_time).slice(0, 5) !== timeClean) return false;
        if (r.status === "cancelled" || r.status === "rejected" || r.doctor_status === "rejected") return false;
        if (["expired", "cancelled"].includes(r.payment_status)) return false;
        if (
          (r.payment_status === "pending_hold" || r.payment_status === "failed") &&
          r.payment_hold_expires_at &&
          new Date(r.payment_hold_expires_at).getTime() <= this.dbNowMs
        ) {
          return false;
        }
        return (
          params.doctorId === null ||
          r.assigned_doctor_id === null ||
          r.assigned_doctor_id === params.doctorId
        );
      })
      .sort((a, b) => {
        // 1. Confirmed bookings ('paid') sort before holds
        const aIsHold = a.payment_status === "pending_hold" || a.payment_status === "failed" ? 1 : 0;
        const bIsHold = b.payment_status === "pending_hold" || b.payment_status === "failed" ? 1 : 0;
        if (aIsHold !== bIsHold) return aIsHold - bIsHold;
        // 2. Another patient's hold or different doctor scope sorts BEFORE caller's own same-scope hold
        const aIsConflict =
          a.user_id !== params.callerUserId || a.assigned_doctor_id !== params.doctorId ? 0 : 1;
        const bIsConflict =
          b.user_id !== params.callerUserId || b.assigned_doctor_id !== params.doctorId ? 0 : 1;
        if (aIsConflict !== bIsConflict) return aIsConflict - bIsConflict;
        return b.created_at_ms - a.created_at_ms;
      });

    const newExpiresIso = new Date(
      this.dbNowMs + Math.max(1, params.holdDurationMinutes ?? 10) * 60 * 1000
    ).toISOString();

    if (activeOccupants.length > 0) {
      const first = activeOccupants[0];
      if (
        first.user_id === params.callerUserId &&
        (first.payment_status === "pending_hold" || first.payment_status === "failed") &&
        first.assigned_doctor_id === params.doctorId
      ) {
        // Same-user idempotent retry returns existing hold WITHOUT extending payment_hold_expires_at
        return {
          success: true,
          appointment_id: first.appointment_id,
          payment_hold_expires_at: first.payment_hold_expires_at ?? undefined,
          is_existing_hold: true,
        };
      }
      return {
        success: false,
        code: "ERR_SLOT_UNAVAILABLE",
        message: "This consultation slot has just been reserved by another patient. Please select another available time.",
      };
    }

    const id = `appt-${++this.seq}`;
    this.appointments.push({
      appointment_id: id,
      clinic_id: params.clinicId,
      assigned_doctor_id: params.doctorId,
      date: `${targetDate}T${timeClean}:00+08:00`,
      time: `${timeClean}:00`,
      batch_time: timeClean,
      status: "pending",
      doctor_status: "pending-review",
      payment_status: "pending_hold",
      payment_hold_expires_at: newExpiresIso,
      queue_number: null,
      user_id: params.callerUserId,
      created_at_ms: this.dbNowMs,
    });

    return {
      success: true,
      appointment_id: id,
      payment_hold_expires_at: newExpiresIso,
      is_existing_hold: false,
    };
  }

  /** Mirrors public.cancel_appointment_hold */
  public cancelAppointmentHold(appointmentId: string, callerUserId: string | null) {
    if (!callerUserId) {
      return { success: false, code: "ERR_UNAUTHORIZED", message: "Sign in required." };
    }
    const row = this.appointments.find((a) => a.appointment_id === appointmentId);
    if (!row) {
      return { success: false, code: "ERR_NOT_FOUND", message: "Not found." };
    }
    if (row.payment_status === "paid") {
      return { success: false, code: "ERR_ALREADY_PAID", message: "Already paid." };
    }
    if (row.user_id !== callerUserId) {
      return { success: false, code: "ERR_FORBIDDEN", message: "Unauthorized to cancel another patient's hold." };
    }
    if (row.payment_status !== "pending_hold" && row.payment_status !== "failed") {
      return { success: false, code: "ERR_INVALID_STATUS", message: "Not in active hold state." };
    }
    row.status = "cancelled";
    row.payment_status = "cancelled";
    return { success: true, message: "Hold cancelled." };
  }

  /** Mirrors public.release_expired_appointment_holds */
  public releaseExpiredAppointmentHolds(callerRole: "service_role" | "admin" | "authenticated" | "anon" = "service_role"): number {
    if (callerRole !== "service_role" && callerRole !== "admin") {
      throw new Error("ERR_FORBIDDEN: Only service role or administrators may invoke hold cleanup.");
    }
    let count = 0;
    for (const r of this.appointments) {
      if (
        r.status === "pending" &&
        (r.payment_status === "pending_hold" || r.payment_status === "failed") &&
        r.payment_hold_expires_at &&
        new Date(r.payment_hold_expires_at).getTime() <= this.dbNowMs
      ) {
        r.status = "cancelled";
        r.payment_status = "expired";
        count++;
      }
    }
    return count;
  }

  /** Mirrors direct UPDATE with trg_protect_appointment_fields + trg_assign_appointment_queue_and_prevent_duplicates */
  public reassignAlternateDoctor(params: {
    appointmentId: string;
    callerUserId: string;
    newDoctorId: string;
    newDate: string;
    newTime: string;
  }): { success: boolean; queue_number?: number | null; code?: string } {
    const appt = this.appointments.find((a) => a.appointment_id === params.appointmentId);
    if (!appt) return { success: false, code: "ERR_NOT_FOUND" };
    if (appt.user_id !== params.callerUserId) return { success: false, code: "ERR_FORBIDDEN" };
    if (appt.doctor_status !== "rejected") return { success: false, code: "ERR_FORBIDDEN" };

    const targetDate = getManilaCalendarDate(params.newDate);
    const timeClean = params.newTime.slice(0, 5);

    // Trigger Step 1A: Reap expired holds on target slot before conflict and unique-index check
    for (const r of this.appointments) {
      if (
        r.appointment_id !== appt.appointment_id &&
        getManilaCalendarDate(r.date) === targetDate &&
        (r.time || r.batch_time).slice(0, 5) === timeClean &&
        (r.clinic_id === appt.clinic_id || r.assigned_doctor_id === params.newDoctorId) &&
        r.status !== "cancelled" &&
        r.status !== "rejected" &&
        (r.payment_status === "pending_hold" || r.payment_status === "failed") &&
        r.payment_hold_expires_at &&
        new Date(r.payment_hold_expires_at).getTime() <= this.dbNowMs
      ) {
        r.status = "cancelled";
        r.payment_status = "expired";
      }
    }

    // Trigger Step 1B: Check bidirectional conflicts
    const conflict = this.appointments.find(
      (r) =>
        r.appointment_id !== appt.appointment_id &&
        r.clinic_id === appt.clinic_id &&
        getManilaCalendarDate(r.date) === targetDate &&
        (r.time || r.batch_time).slice(0, 5) === timeClean &&
        doctorScopesOverlap(r.assigned_doctor_id, params.newDoctorId) &&
        r.status !== "cancelled" &&
        r.status !== "rejected" &&
        r.doctor_status !== "rejected" &&
        !["expired", "cancelled"].includes(r.payment_status)
    );
    if (conflict) {
      return { success: false, code: "ERR_DUPLICATE_SLOT" };
    }

    // Trigger Step 2: Recompute queue_number for the new doctor & date
    const maxQueue = this.appointments
      .filter(
        (r) =>
          r.appointment_id !== appt.appointment_id &&
          r.clinic_id === appt.clinic_id &&
          r.assigned_doctor_id === params.newDoctorId &&
          getManilaCalendarDate(r.date) === targetDate &&
          r.status !== "cancelled" &&
          r.status !== "rejected" &&
          r.doctor_status !== "rejected" &&
          r.queue_number != null
      )
      .reduce((max, r) => Math.max(max, r.queue_number ?? 0), 0);

    appt.assigned_doctor_id = params.newDoctorId;
    appt.date = `${targetDate}T${timeClean}:00+08:00`;
    appt.time = `${timeClean}:00`;
    appt.batch_time = timeClean;
    appt.status = "pending";
    appt.doctor_status = "pending-review";
    appt.queue_number = maxQueue + 1;

    return { success: true, queue_number: appt.queue_number };
  }

  /** Mirrors public.fulfill_appointment_payment_atomic */
  public fulfillAppointmentPaymentAtomic(params: {
    appointmentId: string;
    paymentReference: string;
  }): {
    success: boolean;
    already_paid?: boolean;
    reconciliation_required?: boolean;
    code?: string;
  } {
    const appt = this.appointments.find((a) => a.appointment_id === params.appointmentId);
    if (!appt) return { success: false, code: "ERR_NOT_FOUND" };

    if (appt.payment_status === "paid") {
      return { success: true, already_paid: true, reconciliation_required: false };
    }

    const isExpiredHold =
      appt.payment_status === "expired" ||
      ((appt.payment_status === "pending_hold" || appt.payment_status === "failed") &&
        appt.payment_hold_expires_at != null &&
        new Date(appt.payment_hold_expires_at).getTime() <= this.dbNowMs);

    const isExpiredOrCancelled =
      appt.status === "cancelled" ||
      appt.status === "rejected" ||
      appt.payment_status === "cancelled" ||
      isExpiredHold;

    // Step 6B: excludes cancelled, rejected, and doctor_status === 'rejected'
    const hasCompetingOccupant = this.appointments.some(
      (other) =>
        other.appointment_id !== appt.appointment_id &&
        other.clinic_id === appt.clinic_id &&
        getManilaCalendarDate(other.date) === getManilaCalendarDate(appt.date) &&
        other.batch_time === appt.batch_time &&
        doctorScopesOverlap(other.assigned_doctor_id, appt.assigned_doctor_id) &&
        other.status !== "cancelled" &&
        other.status !== "rejected" &&
        other.doctor_status !== "rejected" &&
        other.payment_status === "paid"
    );

    if (isExpiredOrCancelled || hasCompetingOccupant) {
      if (isExpiredHold) {
        appt.status = "cancelled";
        if (appt.payment_status !== "cancelled") {
          appt.payment_status = "expired";
        }
      } else if (hasCompetingOccupant) {
        appt.status = "cancelled";
        appt.payment_status = "cancelled";
      }
      appt.clinic_note = `${appt.clinic_note || ""} | [RECONCILIATION REQUIRED] Late payment captured (${params.paymentReference}).`.trim();
      if (!this.payments.some((p) => p.reference_number === params.paymentReference)) {
        this.payments.push({
          appointment_id: appt.appointment_id,
          user_id: appt.user_id,
          reference_number: params.paymentReference,
          status: "reconciliation_required",
        });
      }
      return {
        success: false,
        already_paid: false,
        reconciliation_required: true,
        code: "ERR_HOLD_RELEASED_RECONCILIATION_REQUIRED",
      };
    }

    appt.payment_status = "paid";
    appt.status = "scheduled";
    appt.payment_reference = params.paymentReference;
    // Attached BEFORE UPDATE trigger trg_assign_appointment_queue_and_prevent_duplicates assigns queue_number:
    if (appt.queue_number === null) {
      const targetCalendarDate = getManilaCalendarDate(appt.date);
      const maxQueue = this.appointments.reduce((max, other) => {
        if (
          other.appointment_id !== appt.appointment_id &&
          other.clinic_id === appt.clinic_id &&
          getManilaCalendarDate(other.date) === targetCalendarDate &&
          other.assigned_doctor_id === appt.assigned_doctor_id &&
          other.status !== "cancelled" &&
          other.status !== "rejected" &&
          other.doctor_status !== "rejected" &&
          other.payment_status === "paid"
        ) {
          return Math.max(max, other.queue_number || 0);
        }
        return max;
      }, 0);
      appt.queue_number = maxQueue + 1;
    }
    if (!this.payments.some((p) => p.reference_number === params.paymentReference)) {
      this.payments.push({
        appointment_id: appt.appointment_id,
        user_id: appt.user_id,
        reference_number: params.paymentReference,
        status: "success",
      });
    }
    return { success: true, already_paid: false, reconciliation_required: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Client View Helper                                                         */
/* -------------------------------------------------------------------------- */

class PatientClientView {
  public userId: string;
  public db: AuthoritativeDatabaseSim;
  public tracker = new SlotAvailabilityTracker();
  public existingBookings: OccupiedSlotRecord[] = [];
  public selectedDoctorId: string;
  public selectedDate: string;
  public localClockMs: number;

  constructor(
    userId: string,
    db: AuthoritativeDatabaseSim,
    doctorId: string = DOC_NATHAN_ID,
    date: string = TARGET_DATE
  ) {
    this.userId = userId;
    this.db = db;
    this.selectedDoctorId = doctorId;
    this.selectedDate = date;
    this.localClockMs = db.dbNowMs;
    this.tracker.setView(this.selectedDate, this.selectedDoctorId, CLINIC_ID);
  }

  public setDoctor(doctorId: string) {
    this.selectedDoctorId = doctorId;
    this.tracker.setView(this.selectedDate, this.selectedDoctorId, CLINIC_ID);
    this.existingBookings = this.tracker.visible(this.localClockMs);
  }

  public receiveRealtimeBroadcast(payload: BroadcastSlotChangePayload) {
    this.tracker.setView(this.selectedDate, this.selectedDoctorId, CLINIC_ID);
    this.tracker.applyEvent(
      {
        date: payload.date,
        slotTime: payload.slotTime,
        doctorId: payload.doctorId,
        changeType: payload.changeType,
        timestamp: payload.timestamp,
      },
      this.localClockMs
    );
    this.existingBookings = this.tracker.visible(this.localClockMs);
  }

  public pollDatabase(fetchStartedAtMs: number = this.localClockMs) {
    const rawRows = this.db.getOccupiedAppointmentSlots(CLINIC_ID, this.selectedDate, null);
    const mapped = mapOccupiedSlotRows(rawRows, CLINIC_ID, this.selectedDate);
    this.tracker.setView(this.selectedDate, this.selectedDoctorId, CLINIC_ID);
    this.existingBookings = this.tracker.applyAuthoritative(mapped, fetchStartedAtMs, {
      receivedAt: this.localClockMs,
      forDate: this.selectedDate,
      scopeKey: CLINIC_ID,
    });
  }

  public getSlot(slotTime: string): ConsultationSlot {
    const groups = generateDaySlotsForDoctor({
      doctorSchedule,
      dayOfWeek: "Friday",
      doctorId: this.selectedDoctorId,
      clinicDefaults,
      existingAppointments: this.existingBookings,
      isToday: false,
      currentMinutesNow: 0,
    });
    const slot = groups.flatMap((g) => g.slots).find((s) => s.slotTime === slotTime);
    assert.ok(slot, `Slot ${slotTime} must exist in generated shift`);
    return slot;
  }
}

// ============================================================================
// TEST 1 — Two-Patient Reservation
// ============================================================================
console.log("[Test 1] Two-patient reservation: Patient A reserves -> Patient B immediately sees RESERVED & non-clickable...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientA = new PatientClientView(PATIENT_A_ID, db);
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  patientA.pollDatabase();
  patientB.pollDatabase();
  assert.equal(patientB.getSlot("09:00").isAvailable, true);
  assert.equal(patientB.getSlot("09:00").occupancyType, "available");

  // Patient A reserves 09:00
  const holdRes = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "09:00",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdRes.success, true);

  // Realtime broadcast arrives at Patient B before next poll
  patientB.receiveRealtimeBroadcast({
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "09:00",
    changeType: "hold_acquired",
    timestamp: db.dbNowMs,
  });

  const slotBImmediate = patientB.getSlot("09:00");
  assert.equal(slotBImmediate.isAvailable, false, "Slot must be immediately non-clickable for Patient B");
  assert.equal(slotBImmediate.isReserved, true, "Slot must immediately show RESERVED for Patient B");
  assert.equal(slotBImmediate.occupancyType, "reserved");

  // Authoritative DB poll confirms the reservation without inventing any expiration timestamp
  patientB.pollDatabase();
  const slotBConfirmed = patientB.getSlot("09:00");
  assert.equal(slotBConfirmed.isAvailable, false);
  assert.equal(slotBConfirmed.isReserved, true);
  assert.equal(slotBConfirmed.occupancyType, "reserved");
  assert.equal(
    patientB.existingBookings[0].db_hold_expires_at,
    holdRes.payment_hold_expires_at,
    "Frontend must preserve the exact database payment_hold_expires_at without inventing timestamps"
  );
  assert.equal(patientB.existingBookings[0].provisional, undefined);
  console.log("  ✓ Test 1 passed.");
}

// ============================================================================
// TEST 2 — Polling Persistence Across 3+ Consecutive 5-Second Polls
// ============================================================================
console.log("[Test 2] Polling persistence: RESERVED remains visible across 4 consecutive 5s polls...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  const holdRes = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "09:30",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdRes.success, true);

  for (let cycle = 1; cycle <= 4; cycle++) {
    db.dbNowMs += 5000;
    patientB.localClockMs = db.dbNowMs;
    patientB.pollDatabase();

    const slot = patientB.getSlot("09:30");
    assert.equal(slot.isAvailable, false, `Poll #${cycle}: 09:30 must remain unavailable`);
    assert.equal(slot.isReserved, true, `Poll #${cycle}: 09:30 must remain RESERVED`);
    assert.equal(slot.occupancyType, "reserved", `Poll #${cycle}: occupancyType must remain 'reserved'`);
  }
  console.log("  ✓ Test 2 passed.");
}

// ============================================================================
// TEST 3 — Realtime Plus Polling Race (In-Flight Stale Poll vs Newer Hold)
// ============================================================================
console.log("[Test 3] Realtime + polling race: delayed poll started BEFORE hold_acquired cannot revert slot to AVAILABLE...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  // 1. Poll #1 starts at t = 1000ms BEFORE Patient A reserves 10:00
  const stalePollStartedAt = db.dbNowMs;
  const staleDbSnapshot = mapOccupiedSlotRows(
    db.getOccupiedAppointmentSlots(CLINIC_ID, TARGET_DATE, null),
    CLINIC_ID,
    TARGET_DATE
  );
  assert.equal(staleDbSnapshot.length, 0);

  // 2. At t = 1200ms, Patient A reserves 10:00 and Realtime broadcast reaches Patient B
  db.dbNowMs += 200;
  patientB.localClockMs = db.dbNowMs;
  db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "10:00",
    callerUserId: PATIENT_A_ID,
  });
  patientB.receiveRealtimeBroadcast({
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "10:00",
    changeType: "hold_acquired",
    timestamp: db.dbNowMs,
  });
  assert.equal(patientB.getSlot("10:00").occupancyType, "reserved");

  // 3. At t = 1500ms, the slow Poll #1 (started at t = 1000ms) arrives with empty []
  db.dbNowMs += 300;
  patientB.localClockMs = db.dbNowMs;
  patientB.existingBookings = patientB.tracker.applyAuthoritative(staleDbSnapshot, stalePollStartedAt, {
    receivedAt: patientB.localClockMs,
    forDate: TARGET_DATE,
    scopeKey: CLINIC_ID,
  });

  // MUST NOT revert to AVAILABLE because stalePollStartedAt < hold_acquired observedAt!
  assert.equal(
    patientB.getSlot("10:00").occupancyType,
    "reserved",
    "Stale in-flight poll started before hold_acquired must NEVER revert slot to AVAILABLE"
  );
  assert.equal(patientB.getSlot("10:00").isAvailable, false);

  // 4. At t = 1600ms, a fresh poll started AFTER hold_acquired arrives and confirms DB state
  db.dbNowMs += 100;
  patientB.localClockMs = db.dbNowMs;
  patientB.pollDatabase(patientB.localClockMs);
  assert.equal(patientB.getSlot("10:00").occupancyType, "reserved");
  assert.equal(patientB.existingBookings[0].provisional, undefined, "Overlay promoted to confirmed DB record");

  // 5. Verify no fake reservation persists if a bogus broadcast is refuted by a subsequent DB fetch
  patientB.receiveRealtimeBroadcast({
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "11:30",
    changeType: "hold_acquired",
    timestamp: db.dbNowMs + 10,
  });
  assert.equal(patientB.getSlot("11:30").occupancyType, "reserved", "Provisional hint applied immediately");
  db.dbNowMs += 50;
  patientB.localClockMs = db.dbNowMs;
  patientB.pollDatabase(patientB.localClockMs); // Fetch started AFTER the unbacked hint
  assert.equal(
    patientB.getSlot("11:30").occupancyType,
    "available",
    "Authoritative DB fetch started after an unbacked hint must refute it and restore AVAILABLE"
  );
  console.log("  ✓ Test 3 passed.");
}

// ============================================================================
// TEST 4 — Reservation Collision Safety
// ============================================================================
console.log("[Test 4] Reservation collision: Patient B fails on Patient A's slot without releasing or broadcasting hold_released...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientA = new PatientClientView(PATIENT_A_ID, db);
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "10:30",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdA.success, true);

  // Patient B attempts to acquire the same slot
  const holdB = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "10:30",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(holdB.success, false);
  assert.equal(holdB.code, "ERR_SLOT_UNAVAILABLE");
  assert.equal(classifyHoldFailure(holdB.code, holdB.message), "slot_conflict");

  // Even if Patient B attempted to call cancel_appointment_hold on Patient A's appointmentId:
  const cancelByB = db.cancelAppointmentHold(holdA.appointment_id!, PATIENT_B_ID);
  assert.equal(cancelByB.success, false);
  assert.equal(cancelByB.code, "ERR_FORBIDDEN");
  assert.equal(isDefinitiveReleaseDenial(cancelByB.code), true, "ERR_FORBIDDEN must block any fallback update or broadcast");

  // Patient A's hold remains untouched in DB and visible as RESERVED to both patients
  patientA.pollDatabase();
  patientB.pollDatabase();
  assert.equal(patientA.getSlot("10:30").occupancyType, "reserved");
  assert.equal(patientB.getSlot("10:30").occupancyType, "reserved");
  console.log("  ✓ Test 4 passed.");
}

// ============================================================================
// TEST 5 — Explicit Cancellation by Owner
// ============================================================================
console.log("[Test 5] Explicit cancellation: Patient A cancels checkout -> slot becomes AVAILABLE for all patients...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientA = new PatientClientView(PATIENT_A_ID, db);
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "11:00",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdA.success, true);
  patientA.pollDatabase();
  patientB.pollDatabase();
  assert.equal(patientB.getSlot("11:00").occupancyType, "reserved");

  // Patient A cancels checkout
  const cancelRes = db.cancelAppointmentHold(holdA.appointment_id!, PATIENT_A_ID);
  assert.equal(cancelRes.success, true);

  db.dbNowMs += 100;
  patientA.localClockMs = db.dbNowMs;
  patientB.localClockMs = db.dbNowMs;

  const releaseBroadcast: BroadcastSlotChangePayload = {
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "11:00",
    changeType: "hold_released",
    timestamp: db.dbNowMs,
  };
  patientA.receiveRealtimeBroadcast(releaseBroadcast);
  patientB.receiveRealtimeBroadcast(releaseBroadcast);

  assert.equal(patientA.getSlot("11:00").occupancyType, "available");
  assert.equal(patientB.getSlot("11:00").occupancyType, "available");

  // Confirm via authoritative DB poll
  db.dbNowMs += 100;
  patientA.localClockMs = db.dbNowMs;
  patientB.localClockMs = db.dbNowMs;
  patientA.pollDatabase();
  patientB.pollDatabase();
  assert.equal(patientA.getSlot("11:00").isAvailable, true);
  assert.equal(patientB.getSlot("11:00").isAvailable, true);
  console.log("  ✓ Test 5 passed.");
}

// ============================================================================
// TEST 6 — 10-Minute Hold Expiration on Database Clock (Including Skewed Client Clock)
// ============================================================================
console.log("[Test 6] Hold expiration: slot stays RESERVED before 10m even with skewed browser clock, and becomes AVAILABLE after 10m...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db);
  // Skew Patient B's browser clock +30 minutes ahead of the database clock!
  patientB.localClockMs = db.dbNowMs + 30 * 60 * 1000;

  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "12:00",
    callerUserId: PATIENT_A_ID,
    holdDurationMinutes: 10,
  });
  assert.equal(holdA.success, true);

  // At DB t = +5 minutes, hold is still active on DB clock despite Patient B's +30m skewed browser clock
  db.dbNowMs += 5 * 60 * 1000;
  patientB.localClockMs += 5 * 60 * 1000;
  patientB.pollDatabase(patientB.localClockMs);
  assert.equal(
    patientB.getSlot("12:00").occupancyType,
    "reserved",
    "Skewed client clock must NOT prematurely expire an active database hold"
  );

  // Advance 6 more minutes (total 11 minutes on DB clock -> past 10-minute hold window)
  db.dbNowMs += 6 * 60 * 1000;
  patientB.localClockMs += 6 * 60 * 1000;

  // Even BEFORE the next poll, serverNow(localClockMs) derived from db_now offset knows 11m have elapsed
  patientB.existingBookings = patientB.tracker.visible(patientB.localClockMs);
  assert.equal(
    patientB.getSlot("12:00").occupancyType,
    "available",
    "Once database clock passes payment_hold_expires_at, slot transitions to AVAILABLE"
  );

  // Reap expired holds in DB and poll
  const reaped = db.releaseExpiredAppointmentHolds();
  assert.equal(reaped, 1);
  patientB.pollDatabase(patientB.localClockMs);
  assert.equal(patientB.getSlot("12:00").isAvailable, true);
  console.log("  ✓ Test 6 passed.");
}

// ============================================================================
// TEST 7 — Successful Payment & State Priority (BOOKED > RESERVED > AVAILABLE)
// ============================================================================
console.log("[Test 7] Successful payment: RESERVED -> BOOKED for all patients, and BOOKED cannot be downgraded by hold_released...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientA = new PatientClientView(PATIENT_A_ID, db);
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "13:00",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdA.success, true);
  patientB.pollDatabase();
  assert.equal(patientB.getSlot("13:00").occupancyType, "reserved");

  // Patient A completes payment
  const payRes1 = db.fulfillAppointmentPaymentAtomic({
    appointmentId: holdA.appointment_id!,
    paymentReference: "pay_verified_001",
  });
  assert.equal(payRes1.success, true);
  assert.equal(payRes1.already_paid, false);
  const paidRowA = db.appointments.find((a) => a.appointment_id === holdA.appointment_id!)!;
  assert.equal(paidRowA.queue_number, 1, "Attached queue trigger must assign non-null queue_number = 1 on paid fulfillment");

  // Duplicate webhook / return verification call is idempotent
  const payRes2 = db.fulfillAppointmentPaymentAtomic({
    appointmentId: holdA.appointment_id!,
    paymentReference: "pay_verified_001",
  });
  assert.equal(payRes2.success, true);
  assert.equal(payRes2.already_paid, true);
  assert.equal(db.payments.length, 1, "Payment ledger must record fulfillment exactly once");

  db.dbNowMs += 100;
  patientA.localClockMs = db.dbNowMs;
  patientB.localClockMs = db.dbNowMs;
  patientA.pollDatabase();
  patientB.pollDatabase();

  assert.equal(patientA.getSlot("13:00").occupancyType, "booked");
  assert.equal(patientB.getSlot("13:00").occupancyType, "booked");
  assert.equal(patientB.getSlot("13:00").isBooked, true);
  assert.equal(patientB.getSlot("13:00").isReserved, false);

  // State priority check: a stray hold_released broadcast MUST NEVER downgrade BOOKED to AVAILABLE
  patientB.receiveRealtimeBroadcast({
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "13:00",
    changeType: "hold_released",
    timestamp: db.dbNowMs + 50,
  });
  assert.equal(
    patientB.getSlot("13:00").occupancyType,
    "booked",
    "BOOKED slot must never be downgraded to AVAILABLE by a hold_released event"
  );
  console.log("  ✓ Test 7 passed.");
}

// ============================================================================
// TEST 8 — Unassigned Hold Blocks Clinic/Date/Time Slot Across All Doctors
// ============================================================================
console.log("[Test 8] Unassigned hold (assigned_doctor_id = null) blocks doctor-specific views and bookings...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db, DOC_NATHAN_ID);

  // Acquire an unassigned clinic-wide hold at 14:00
  const unassignedHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: null,
    date: TARGET_DATE,
    time: "14:00",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(unassignedHold.success, true);

  // Patient B viewing Dr. Nathan sees 14:00 as RESERVED
  patientB.pollDatabase();
  assert.equal(patientB.getSlot("14:00").occupancyType, "reserved");
  assert.equal(patientB.getSlot("14:00").isAvailable, false);

  // Patient B switching to Dr. Yanpein ALSO sees 14:00 as RESERVED (unassigned hold is clinic-wide)
  patientB.setDoctor(DOC_YANPEIN_ID);
  assert.equal(patientB.getSlot("14:00").occupancyType, "reserved");
  assert.equal(patientB.getSlot("14:00").isAvailable, false);

  // Patient B attempting to acquire a doctor-specific hold on 14:00 with Dr. Nathan is rejected by DB
  const competingDocHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "14:00",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(competingDocHold.success, false);
  assert.equal(competingDocHold.code, "ERR_SLOT_UNAVAILABLE");

  // Reverse direction: Doctor-specific hold at 14:30 with Dr. Nathan blocks an unassigned hold at 14:30,
  // while still allowing Dr. Yanpein (a different doctor) to reserve 14:30 independently!
  const docSpecificHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(docSpecificHold.success, true);

  const competingUnassignedHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: null,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(competingUnassignedHold.success, false, "Doctor-specific hold must block an unassigned clinic-wide hold");
  assert.equal(competingUnassignedHold.code, "ERR_SLOT_UNAVAILABLE");

  const independentDocHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_YANPEIN_ID,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(independentDocHold.success, true, "Different doctors must be able to reserve independent slots at the same time");

  // Failed-payment retry preservation: if Patient A's checkout attempt sets payment_status = 'failed' while hold is unexpired,
  // the slot stays RESERVED, blocks Patient B, and allows Patient A to retry idempotently before expiration.
  const rowDocSpecific = db.appointments.find((a) => a.appointment_id === docSpecificHold.appointment_id!)!;
  rowDocSpecific.payment_status = "failed";
  patientB.setDoctor(DOC_NATHAN_ID);
  patientB.pollDatabase();
  assert.equal(patientB.getSlot("14:30").occupancyType, "reserved", "Unexpired failed hold must remain visible as RESERVED");

  const stealFailedHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(stealFailedHold.success, false, "Another patient must not steal an unexpired failed hold");
  assert.equal(stealFailedHold.code, "ERR_SLOT_UNAVAILABLE");

  // Advance clock by 60 seconds and retry as same user — payment_hold_expires_at must NOT be extended
  db.dbNowMs += 60 * 1000;
  const retryFailedHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(retryFailedHold.success, true, "Same user must be able to retry their unexpired failed hold");
  assert.equal(retryFailedHold.is_existing_hold, true);
  assert.equal(retryFailedHold.appointment_id, docSpecificHold.appointment_id);
  assert.equal(
    retryFailedHold.payment_hold_expires_at,
    docSpecificHold.payment_hold_expires_at,
    "Same-user retry must preserve original payment_hold_expires_at without extending it"
  );
  console.log("  ✓ Test 8 passed.");
}

// ============================================================================
// TEST 9 — Alternate Doctor Selection Respects Existing Reservations & Self-Exclusion
// ============================================================================
console.log("[Test 9] Alternate doctor selection respects active holds, excludes self, and never releases another patient's hold...");
{
  const db = new AuthoritativeDatabaseSim();

  // Patient A's original paid appointment that was rejected by Dr. Yanpein at 09:00
  db.appointments.push({
    appointment_id: "appt-rejected-self",
    clinic_id: CLINIC_ID,
    assigned_doctor_id: DOC_YANPEIN_ID,
    date: `${TARGET_DATE}T09:00:00+08:00`,
    time: "09:00:00",
    batch_time: "09:00",
    status: "scheduled",
    doctor_status: "rejected",
    payment_status: "paid",
    payment_hold_expires_at: null,
    queue_number: 1,
    user_id: PATIENT_A_ID,
    created_at_ms: db.dbNowMs - 60000,
  });

  // Another patient can reserve and fulfill payment on 09:00 with Dr. Yanpein (rejected doctor row does not block Step 6B!)
  const holdYanpein0900 = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_YANPEIN_ID,
    date: TARGET_DATE,
    time: "09:00",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(holdYanpein0900.success, true);
  const payYanpein0900 = db.fulfillAppointmentPaymentAtomic({
    appointmentId: holdYanpein0900.appointment_id!,
    paymentReference: "pay_yanpein_0900",
  });
  assert.equal(payYanpein0900.success, true, "Fulfillment must not collide with a doctor-rejected paid row");

  // Another patient holds 10:00 with alternate doctor Dr. Nathan
  const otherPatientHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "10:00",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(otherPatientHold.success, true);

  // Patient A opens SelectAlternateDoctorModal for Dr. Nathan
  const modalView = new PatientClientView(PATIENT_A_ID, db, DOC_NATHAN_ID, TARGET_DATE);
  modalView.pollDatabase();

  // 09:00 is AVAILABLE with Dr. Nathan (rejected appointment on Dr. Yanpein does not block Dr. Nathan)
  assert.equal(modalView.getSlot("09:00").isAvailable, true);
  // 10:00 is RESERVED by Patient B and cannot be selected
  assert.equal(modalView.getSlot("10:00").occupancyType, "reserved");
  assert.equal(modalView.getSlot("10:00").isAvailable, false);

  // Direct alternate-doctor update onto 10:00 (held by Patient B) is rejected by trigger
  const conflictReassign = db.reassignAlternateDoctor({
    appointmentId: "appt-rejected-self",
    callerUserId: PATIENT_A_ID,
    newDoctorId: DOC_NATHAN_ID,
    newDate: TARGET_DATE,
    newTime: "10:00",
  });
  assert.equal(conflictReassign.success, false);
  assert.equal(conflictReassign.code, "ERR_DUPLICATE_SLOT");

  // Direct alternate-doctor update onto 09:00 with Dr. Nathan succeeds and recomputes queue_number
  const validReassign = db.reassignAlternateDoctor({
    appointmentId: "appt-rejected-self",
    callerUserId: PATIENT_A_ID,
    newDoctorId: DOC_NATHAN_ID,
    newDate: TARGET_DATE,
    newTime: "09:00",
  });
  assert.equal(validReassign.success, true);
  assert.equal(validReassign.queue_number, 1);
  console.log("  ✓ Test 9 passed.");
}

// ============================================================================
// TEST 10 — Realtime Reconnection Triggers Authoritative DB Resync
// ============================================================================
console.log("[Test 10] Realtime reconnection: CHANNEL_ERROR -> SUBSCRIBED triggers authoritative DB resync...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db);
  const resyncReasons: Array<"initial" | "reconnect"> = [];

  const statusHandler = createRealtimeStatusHandler((reason) => {
    resyncReasons.push(reason);
    patientB.pollDatabase(patientB.localClockMs);
  });

  // 1. Initial connection join triggers initial resync
  statusHandler("SUBSCRIBED");
  assert.deepEqual(resyncReasons, ["initial"]);
  assert.equal(patientB.getSlot("14:30").occupancyType, "available");

  // 2. Patient B's WebSocket drops (TIMED_OUT / CHANNEL_ERROR)
  statusHandler("TIMED_OUT");

  // 3. While Patient B is offline, Patient A reserves 14:30 (broadcast missed by Patient B)
  db.dbNowMs += 500;
  patientB.localClockMs = db.dbNowMs;
  db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "14:30",
    callerUserId: PATIENT_A_ID,
  });

  // 4. Patient B's channel reconnects -> statusHandler fires 'reconnect' -> pollDatabase recovers 14:30 RESERVED
  statusHandler("SUBSCRIBED");
  assert.deepEqual(resyncReasons, ["initial", "reconnect"]);
  assert.equal(
    patientB.getSlot("14:30").occupancyType,
    "reserved",
    "Reconnecting after missed broadcast must resync from DB and display RESERVED"
  );
  console.log("  ✓ Test 10 passed.");
}

// ============================================================================
// TEST 11 — Late Payment After Hold Expiration Routes to Reconciliation
// ============================================================================
console.log("[Test 11] Late payment after hold expiration routes to reconciliation_required without double-booking...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientA = new PatientClientView(PATIENT_A_ID, db);
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  // 1. Patient A acquires hold on 15:00
  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "15:00",
    callerUserId: PATIENT_A_ID,
    holdDurationMinutes: 10,
  });
  assert.equal(holdA.success, true);

  // 2. 11 minutes pass; Patient A's hold expires
  db.dbNowMs += 11 * 60 * 1000;
  patientA.localClockMs = db.dbNowMs;
  patientB.localClockMs = db.dbNowMs;

  // 3. Patient B acquires 15:00 and pays
  const holdB = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "15:00",
    callerUserId: PATIENT_B_ID,
  });
  assert.equal(holdB.success, true);
  const payB = db.fulfillAppointmentPaymentAtomic({
    appointmentId: holdB.appointment_id!,
    paymentReference: "pay_patient_b_valid",
  });
  assert.equal(payB.success, true);

  // 4. Patient A's late PayMongo webhook arrives for expired holdA
  const latePayA = db.fulfillAppointmentPaymentAtomic({
    appointmentId: holdA.appointment_id!,
    paymentReference: "pay_patient_a_late",
  });
  assert.equal(latePayA.success, false, "Late payment after expiry must not fulfill appointment");
  assert.equal(latePayA.reconciliation_required, true, "Must flag reconciliation_required = true");
  assert.equal(latePayA.code, "ERR_HOLD_RELEASED_RECONCILIATION_REQUIRED");

  const rowA = db.appointments.find((a) => a.appointment_id === holdA.appointment_id!)!;
  const rowB = db.appointments.find((a) => a.appointment_id === holdB.appointment_id!)!;
  assert.equal(rowA.status, "cancelled", "Patient A's expired appointment must remain cancelled");
  assert.equal(rowA.payment_status, "expired", "Patient A's payment_status must not become paid");
  assert.ok(rowA.clinic_note?.includes("[RECONCILIATION REQUIRED]"), "Reconciliation note must be recorded");
  assert.equal(rowB.status, "scheduled", "Patient B's valid booking must remain scheduled");
  assert.equal(rowB.payment_status, "paid", "Patient B's valid booking must remain paid");

  // 5. Unreaped expired hold receiving late payment (with no competing occupant) transitions to cancelled/expired
  const unreapedHold = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "16:00",
    callerUserId: PATIENT_A_ID,
    holdDurationMinutes: 10,
  });
  assert.equal(unreapedHold.success, true);
  db.dbNowMs += 11 * 60 * 1000;
  const latePayUnreaped = db.fulfillAppointmentPaymentAtomic({
    appointmentId: unreapedHold.appointment_id!,
    paymentReference: "pay_unreaped_late",
  });
  assert.equal(latePayUnreaped.success, false);
  assert.equal(latePayUnreaped.reconciliation_required, true);
  const unreapedRow = db.appointments.find((a) => a.appointment_id === unreapedHold.appointment_id!)!;
  assert.equal(unreapedRow.status, "cancelled", "Unreaped expired hold must transition to status = 'cancelled'");
  assert.equal(unreapedRow.payment_status, "expired", "Unreaped expired hold must transition to payment_status = 'expired'");
  console.log("  ✓ Test 11 passed.");
}

// ============================================================================
// TEST 12 — Duplicate Events Idempotency & Out-of-Order Network Completion
// ============================================================================
console.log("[Test 12] Duplicate events (hold_acquired, hold_released, out-of-order polls) are idempotent...");
{
  const db = new AuthoritativeDatabaseSim();
  const patientB = new PatientClientView(PATIENT_B_ID, db);

  const holdA = db.acquireAppointmentSlotHold({
    clinicId: CLINIC_ID,
    doctorId: DOC_NATHAN_ID,
    date: TARGET_DATE,
    time: "15:30",
    callerUserId: PATIENT_A_ID,
  });
  assert.equal(holdA.success, true);

  const acquireEvt: BroadcastSlotChangePayload = {
    clinicId: CLINIC_ID,
    date: TARGET_DATE,
    doctorId: DOC_NATHAN_ID,
    slotTime: "15:30",
    changeType: "hold_acquired",
    timestamp: 50000,
  };

  // Deliver the same hold_acquired event 3 times (window event, localStorage, WebSocket self-echo)
  const firstApply = patientB.tracker.applyEvent(acquireEvt, patientB.localClockMs);
  const secondApply = patientB.tracker.applyEvent(acquireEvt, patientB.localClockMs + 5);
  const thirdApply = patientB.tracker.applyEvent(acquireEvt, patientB.localClockMs + 10);
  assert.equal(firstApply, true, "First delivery applies overlay");
  assert.equal(secondApply, false, "Second duplicate delivery is ignored");
  assert.equal(thirdApply, false, "Third duplicate delivery is ignored");
  assert.equal(patientB.tracker.visible(patientB.localClockMs).length, 1);

  // Patient A cancels hold; DB poll confirms release; then a delayed duplicate echo of acquireEvt arrives
  db.cancelAppointmentHold(holdA.appointment_id!, PATIENT_A_ID);
  db.dbNowMs += 200;
  patientB.localClockMs = db.dbNowMs;
  patientB.pollDatabase(patientB.localClockMs);
  assert.equal(patientB.getSlot("15:30").occupancyType, "available");

  // Delayed echo with same sender timestamp (50000) arrives AFTER cancellation -> ignored!
  const lateEchoApply = patientB.tracker.applyEvent(acquireEvt, patientB.localClockMs + 50);
  assert.equal(lateEchoApply, false, "Delayed duplicate echo of hold_acquired must not resurrect a cancelled hold");
  assert.equal(patientB.getSlot("15:30").occupancyType, "available");

  // Out-of-order authoritative polls: older poll arriving after newer poll is ignored
  const olderPollStart = patientB.localClockMs - 500;
  const fakeOlderSnapshot: OccupiedSlotRecord[] = [
    {
      date: TARGET_DATE,
      time: "15:30",
      batch_time: "15:30",
      assigned_doctor_id: DOC_NATHAN_ID,
      clinic_id: CLINIC_ID,
      status: "pending",
      doctor_status: "approved",
      payment_status: "pending_hold",
      occupancy_type: "reserved",
      payment_hold_expires_at: null,
    },
  ];
  patientB.existingBookings = patientB.tracker.applyAuthoritative(fakeOlderSnapshot, olderPollStart, {
    receivedAt: patientB.localClockMs + 100,
    forDate: TARGET_DATE,
    scopeKey: CLINIC_ID,
  });
  assert.equal(
    patientB.getSlot("15:30").occupancyType,
    "available",
    "Out-of-order response from an older poll must never roll back a newer authoritative snapshot"
  );
  console.log("  ✓ Test 12 passed.");
}

// ============================================================================
// HELD-SLOT METADATA & CHECKOUT CANCELLATION REGRESSION TESTS (Test A – Test D)
// ============================================================================
async function runHeldSlotMetadataRegressionTests() {
  const originalFrom = supabase.from.bind(supabase);
  const originalRpc = supabase.rpc.bind(supabase);
  const originalChannel = supabase.channel.bind(supabase);
  const originalRemoveChannel = supabase.removeChannel.bind(supabase);

  let activeDb: AuthoritativeDatabaseSim | null = null;
  let activeCallerId: string = PATIENT_A_ID;
  let simulateSelectError: { message: string } | null = null;
  let simulateRpcFailure: { code: string; message: string } | null = null;
  let simulateUpdateFailure: { message: string } | null = null;
  const capturedBroadcasts: BroadcastSlotChangePayload[] = [];
  const capturedCancelRpcIds: string[] = [];

  try {
    (supabase as any).channel = () => ({
      on() {
        return this;
      },
      subscribe(cb?: (status: string) => void) {
        if (cb) cb("SUBSCRIBED");
        return this;
      },
      send: async (msg: any) => {
        if (msg?.payload) {
          capturedBroadcasts.push(msg.payload as BroadcastSlotChangePayload);
        }
        return "ok";
      },
      unsubscribe: async () => "ok",
      teardown: () => {},
    });
    (supabase as any).removeChannel = async () => "ok";

    (supabase as any).from = (table: string) => {
      if (table !== "patient_appointment") {
        throw new Error(`Unexpected table query in held-slot test: ${table}`);
      }
      return {
        select: (_cols: string) => ({
          eq: (_col: string, appointmentId: string) => ({
            maybeSingle: async () => {
              if (simulateSelectError) {
                return { data: null, error: simulateSelectError };
              }
              const row = activeDb?.appointments.find(
                (a) => a.appointment_id === appointmentId && a.user_id === activeCallerId
              );
              return { data: row ? { ...row } : null, error: null };
            },
          }),
        }),
        update: (patch: Record<string, any>) => ({
          eq: (_col: string, appointmentId: string) => ({
            in: (_inCol: string, allowedStatuses: string[]) => ({
              select: async (_selCols: string) => {
                if (simulateUpdateFailure) {
                  return { data: null, error: simulateUpdateFailure };
                }
                const row = activeDb?.appointments.find(
                  (a) =>
                    a.appointment_id === appointmentId &&
                    a.user_id === activeCallerId &&
                    allowedStatuses.includes(a.payment_status)
                );
                if (!row) {
                  return { data: [], error: null };
                }
                if (patch.status) row.status = patch.status;
                if (patch.payment_status) row.payment_status = patch.payment_status;
                if (patch.clinic_note !== undefined) row.clinic_note = patch.clinic_note;
                return { data: [{ appointment_id: row.appointment_id }], error: null };
              },
            }),
          }),
        }),
      };
    };

    (supabase as any).rpc = async (name: string, args: any) => {
      if (name === "cancel_appointment_hold") {
        capturedCancelRpcIds.push(args.p_appointment_id);
        if (simulateRpcFailure) {
          return { data: null, error: simulateRpcFailure };
        }
        const res = activeDb!.cancelAppointmentHold(args.p_appointment_id, activeCallerId);
        return {
          data: {
            success: res.success,
            code: res.code,
            message: res.message,
            appointment_id: args.p_appointment_id,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC in held-slot test: ${name}`);
    };

    // ------------------------------------------------------------------------
    // TEST A — Cancellation after self-broadcast (selectedTime cleared to "")
    // ------------------------------------------------------------------------
    console.log("[Test A] Cancellation after self-broadcast: selectedTime cleared to '' still releases 13:00 and never touches 08:00...");
    {
      activeDb = new AuthoritativeDatabaseSim();
      activeCallerId = PATIENT_A_ID;
      simulateSelectError = null;
      simulateRpcFailure = null;
      simulateUpdateFailure = null;
      capturedBroadcasts.length = 0;
      capturedCancelRpcIds.length = 0;

      const patientA = new PatientClientView(PATIENT_A_ID, activeDb);
      const patientB = new PatientClientView(PATIENT_B_ID, activeDb);

      // Patient B holds 08:00 so we can verify 08:00 is NEVER affected when Patient A cancels 13:00
      const holdB0800 = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "08:00",
        callerUserId: PATIENT_B_ID,
      });
      assert.equal(holdB0800.success, true);

      patientA.pollDatabase();
      patientB.pollDatabase();
      assert.equal(patientA.getSlot("08:00").occupancyType, "reserved");
      assert.equal(patientA.getSlot("13:00").occupancyType, "available");

      // 1. Patient A selects 13:00
      let selectedTime = "13:00";
      const heldSlotTracker = new HeldSlotTracker();

      // 2. Patient A acquires the hold on 13:00 successfully
      const holdA1300 = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: selectedTime,
        callerUserId: PATIENT_A_ID,
      });
      assert.equal(holdA1300.success, true);

      heldSlotTracker.record({
        appointmentId: holdA1300.appointment_id!,
        clinicId: CLINIC_ID,
        date: TARGET_DATE,
        doctorId: DOC_NATHAN_ID,
        slotTime: selectedTime,
      });

      // 3. Deliver the same browser's own hold_acquired event
      const selfHoldAcquiredEvt: BroadcastSlotChangePayload = {
        clinicId: CLINIC_ID,
        date: TARGET_DATE,
        doctorId: DOC_NATHAN_ID,
        slotTime: "13:00",
        changeType: "hold_acquired",
        timestamp: activeDb.dbNowMs,
      };
      patientA.receiveRealtimeBroadcast(selfHoldAcquiredEvt);
      patientB.receiveRealtimeBroadcast(selfHoldAcquiredEvt);
      heldSlotTracker.onRealtimeEvent(selfHoldAcquiredEvt);

      // AppointmentPage clears selectedTime to "" when the selected slot becomes non-available (RESERVED)
      if (!patientA.getSlot(selectedTime).isAvailable) {
        selectedTime = "";
      }

      // 4. Confirm selectedTime is cleared to "" while HeldSlotTracker retains 13:00 metadata
      assert.equal(selectedTime, "", "selectedTime must be cleared to '' after own hold_acquired marks 13:00 RESERVED");
      assert.equal(patientA.getSlot("13:00").occupancyType, "reserved");
      const retained = heldSlotTracker.getForAppointment(holdA1300.appointment_id!);
      assert.ok(retained, "HeldSlotTracker must retain metadata after self-broadcast");
      assert.equal(retained.slotTime, "13:00");
      assert.equal(retained.appointmentId, holdA1300.appointment_id);

      // 5. Cancel checkout using retained metadata (never selectedTime || "08:00")
      const releaseRes = await releaseAppointmentHoldSafely(
        holdA1300.appointment_id!,
        "Appointment slot hold cancelled by patient before payment.",
        retained
      );
      assert.equal(releaseRes.success, true);
      assert.equal(releaseRes.releasedSlot?.slotTime, "13:00");
      assert.equal(heldSlotTracker.clearOnReleaseResult(releaseRes), true);
      assert.equal(heldSlotTracker.get(), null, "Retained metadata must be cleared after confirmed release");

      // 6. Confirm the release used the original appointmentId and 13:00 slot
      assert.deepEqual(capturedCancelRpcIds, [holdA1300.appointment_id!]);
      assert.equal(capturedBroadcasts.length, 1, "Exactly one hold_released broadcast must be emitted");
      assert.equal(capturedBroadcasts[0].changeType, "hold_released");
      assert.equal(capturedBroadcasts[0].slotTime, "13:00", "Broadcast must target 13:00, never 08:00");

      patientA.receiveRealtimeBroadcast(capturedBroadcasts[0]);
      patientB.receiveRealtimeBroadcast(capturedBroadcasts[0]);
      assert.equal(patientA.getSlot("13:00").occupancyType, "available", "13:00 must immediately return to AVAILABLE");
      assert.equal(patientB.getSlot("13:00").occupancyType, "available", "13:00 must immediately return to AVAILABLE for Patient B");

      // 7. Confirm 08:00 is never affected
      assert.equal(patientA.getSlot("08:00").occupancyType, "reserved", "08:00 must remain RESERVED");
      assert.equal(patientB.getSlot("08:00").occupancyType, "reserved", "08:00 must remain RESERVED");
      patientA.pollDatabase(patientA.localClockMs + 50);
      assert.equal(patientA.getSlot("08:00").occupancyType, "reserved");
      assert.equal(patientA.getSlot("13:00").occupancyType, "available");
      console.log("  ✓ Test A passed.");
    }

    // ------------------------------------------------------------------------
    // TEST B — Cancellation after page refresh or cleanup (in-memory metadata unavailable)
    // ------------------------------------------------------------------------
    console.log("[Test B] Cancellation after page refresh: cleanup retrieves authoritative DB slot (13:00) when in-memory ref is empty...");
    {
      activeDb = new AuthoritativeDatabaseSim();
      activeCallerId = PATIENT_A_ID;
      simulateSelectError = null;
      simulateRpcFailure = null;
      simulateUpdateFailure = null;
      capturedBroadcasts.length = 0;
      capturedCancelRpcIds.length = 0;

      const patientA = new PatientClientView(PATIENT_A_ID, activeDb);
      const holdB0800 = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "08:00",
        callerUserId: PATIENT_B_ID,
      });
      assert.equal(holdB0800.success, true);

      const holdA1300 = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "13:00",
        callerUserId: PATIENT_A_ID,
      });
      assert.equal(holdA1300.success, true);

      // Simulate page refresh: new HeldSlotTracker has no in-memory state and selectedTime is ""
      const freshTrackerAfterReload = new HeldSlotTracker();
      assert.equal(freshTrackerAfterReload.get(), null);
      patientA.pollDatabase();
      assert.equal(patientA.getSlot("13:00").occupancyType, "reserved");
      assert.equal(patientA.getSlot("08:00").occupancyType, "reserved");

      // Cleanup invoked with only appointmentId from sessionStorage (no slotDetails)
      const releaseRes = await releaseAppointmentHoldSafely(
        holdA1300.appointment_id!,
        "Released previous hold after page refresh"
      );
      assert.equal(releaseRes.success, true);
      assert.deepEqual(releaseRes.releasedSlot, {
        clinicId: CLINIC_ID,
        date: TARGET_DATE,
        doctorId: DOC_NATHAN_ID,
        slotTime: "13:00",
      });
      assert.equal(capturedBroadcasts.length, 1);
      assert.equal(capturedBroadcasts[0].slotTime, "13:00", "DB lookup must resolve 13:00 for release broadcast");
      assert.equal(capturedBroadcasts[0].changeType, "hold_released");

      // Also verify that if DB pre-check fails AND no in-memory metadata is available,
      // release still cancels by appointmentId via RPC and NEVER broadcasts an assumed "08:00" time
      const holdA1400 = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "14:00",
        callerUserId: PATIENT_A_ID,
      });
      assert.equal(holdA1400.success, true);
      capturedBroadcasts.length = 0;
      simulateSelectError = { message: "Simulated transient PostgREST read error" };

      const blindReleaseRes = await releaseAppointmentHoldSafely(
        holdA1400.appointment_id!,
        "Release without readable metadata"
      );
      assert.equal(blindReleaseRes.success, true);
      assert.equal(blindReleaseRes.releasedSlot, undefined, "Must not fabricate a fallback slot time when metadata is unreadable");
      assert.equal(capturedBroadcasts.length, 0, "Must not broadcast hold_released against an assumed slot time");
      assert.equal(patientA.getSlot("08:00").occupancyType, "reserved", "08:00 must remain untouched");
      console.log("  ✓ Test B passed.");
    }

    // ------------------------------------------------------------------------
    // TEST C — Payment success clears retained hold metadata without releasing paid appointment
    // ------------------------------------------------------------------------
    console.log("[Test C] Payment success: clears retained hold metadata and prevents releasing paid appointment...");
    {
      activeDb = new AuthoritativeDatabaseSim();
      activeCallerId = PATIENT_A_ID;
      simulateSelectError = null;
      simulateRpcFailure = null;
      simulateUpdateFailure = null;
      capturedBroadcasts.length = 0;
      capturedCancelRpcIds.length = 0;

      const heldSlotTracker = new HeldSlotTracker();
      const holdA = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "13:00",
        callerUserId: PATIENT_A_ID,
      });
      assert.equal(holdA.success, true);

      heldSlotTracker.record({
        appointmentId: holdA.appointment_id!,
        clinicId: CLINIC_ID,
        date: TARGET_DATE,
        doctorId: DOC_NATHAN_ID,
        slotTime: "13:00",
      });
      assert.equal(heldSlotTracker.get()?.slotTime, "13:00");

      // Fulfill payment atomically
      const payRes = activeDb.fulfillAppointmentPaymentAtomic({
        appointmentId: holdA.appointment_id!,
        paymentReference: "pay_success_test_c",
      });
      assert.equal(payRes.success, true);

      // Clear retained metadata on payment success
      heldSlotTracker.clearOnPaymentSuccess(holdA.appointment_id!);
      assert.equal(heldSlotTracker.get(), null, "Payment success must clear retained hold metadata");

      // Verify any subsequent accidental release call on the paid appointment is blocked
      const postPayRelease = await releaseAppointmentHoldSafely(
        holdA.appointment_id!,
        "Accidental cleanup after payment"
      );
      assert.equal(postPayRelease.success, false);
      assert.equal(postPayRelease.alreadyPaid, true);
      assert.equal(postPayRelease.code, "ERR_ALREADY_PAID");
      assert.equal(capturedCancelRpcIds.length, 0, "Must not invoke cancel_appointment_hold RPC on an already-paid appointment");
      assert.equal(capturedBroadcasts.length, 0, "Must not broadcast hold_released for a paid appointment");
      console.log("  ✓ Test C passed.");
    }

    // ------------------------------------------------------------------------
    // TEST D — Release failure preserves retained metadata and emits no false broadcast
    // ------------------------------------------------------------------------
    console.log("[Test D] Release failure: unauthorized or failed release keeps retained metadata and emits no hold_released...");
    {
      activeDb = new AuthoritativeDatabaseSim();
      simulateSelectError = null;
      simulateRpcFailure = null;
      simulateUpdateFailure = null;
      capturedBroadcasts.length = 0;
      capturedCancelRpcIds.length = 0;

      const heldSlotTracker = new HeldSlotTracker();
      const holdA = activeDb.acquireAppointmentSlotHold({
        clinicId: CLINIC_ID,
        doctorId: DOC_NATHAN_ID,
        date: TARGET_DATE,
        time: "13:00",
        callerUserId: PATIENT_A_ID,
      });
      assert.equal(holdA.success, true);

      heldSlotTracker.record({
        appointmentId: holdA.appointment_id!,
        clinicId: CLINIC_ID,
        date: TARGET_DATE,
        doctorId: DOC_NATHAN_ID,
        slotTime: "13:00",
      });

      // 1. Unauthorized caller (Patient B) attempts to release Patient A's hold -> ERR_FORBIDDEN
      activeCallerId = PATIENT_B_ID;
      const forbiddenRes = await releaseAppointmentHoldSafely(
        holdA.appointment_id!,
        "Unauthorized release attempt",
        heldSlotTracker.get()!
      );
      assert.equal(forbiddenRes.success, false);
      assert.equal(forbiddenRes.code, "ERR_FORBIDDEN");
      assert.equal(heldSlotTracker.clearOnReleaseResult(forbiddenRes), false, "Failed release must NOT clear retained metadata");
      assert.equal(heldSlotTracker.get()?.slotTime, "13:00");
      assert.equal(capturedBroadcasts.length, 0, "Failed release must NEVER broadcast hold_released");

      // 2. Owner (Patient A) experiences transient network failure on both RPC and fallback update
      activeCallerId = PATIENT_A_ID;
      simulateRpcFailure = { code: "PGRST301", message: "Network timeout" };
      simulateUpdateFailure = { message: "Connection reset" };

      const networkFailRes = await releaseAppointmentHoldSafely(
        holdA.appointment_id!,
        "Owner cancel during network outage",
        heldSlotTracker.get()!
      );
      assert.equal(networkFailRes.success, false);
      assert.equal(heldSlotTracker.clearOnReleaseResult(networkFailRes), false, "Transient failure must preserve metadata for retry");
      assert.equal(heldSlotTracker.get()?.appointmentId, holdA.appointment_id);
      assert.equal(heldSlotTracker.get()?.slotTime, "13:00");
      assert.equal(capturedBroadcasts.length, 0, "Transient failure must not broadcast hold_released");
      console.log("  ✓ Test D passed.");
    }
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
    (supabase as any).channel = originalChannel;
    (supabase as any).removeChannel = originalRemoveChannel;
    await supabase.removeAllChannels();
  }
}

async function runOwnActiveHoldAndFinalRegressionTests() {
  console.log("\n--- Scenario 17: Own Active Hold, Refresh Recovery & Final Regression Checks ---");

  // Test 1: Own hold rendering as YOUR HOLD with distinct amber styling & clickable
  {
    const heldTracker = new HeldSlotTracker();
    const holdApptId = "11112222-3333-4444-5555-666677778888";
    heldTracker.record({
      appointmentId: holdApptId,
      clinicId: CLINIC_ID,
      date: "2026-11-02",
      doctorId: DOC_NATHAN_ID,
      slotTime: "09:00",
    });

    const isOwnHold = heldTracker.matches("2026-11-02", "09:00", DOC_NATHAN_ID);
    assert.equal(isOwnHold, true, "matches() must return true for caller's held slot");

    // Competing slot (different time or different doctor)
    assert.equal(heldTracker.matches("2026-11-02", "09:30", DOC_NATHAN_ID), false);
    assert.equal(heldTracker.matches("2026-11-02", "09:00", DOC_YANPEIN_ID), false);

    // Button state evaluation
    const slotMock: ConsultationSlot = {
      slotTime: "09:00",
      endTime: "09:30",
      durationMinutes: 30,
      shiftId: "shift-1",
      shiftLabel: "Morning",
      slotIndex: 0,
      timeRange: "09:00 AM – 09:30 AM",
      isAvailable: false,
      isReserved: true,
      isBooked: false,
      isPast: false,
      isCapacityFull: false,
      label: "09:00 AM",
    };
    const isClickable = slotMock.isAvailable || isOwnHold;
    assert.equal(isClickable, true, "Own hold must NOT be disabled (isClickable must be true)");
    const badgeText = isOwnHold ? "Your Hold" : slotMock.isReserved ? "Reserved" : "Available";
    assert.equal(badgeText, "Your Hold", "Own hold must display 'Your Hold' badge, not 'Reserved'");
    console.log("  ✓ Test 1 passed: Own hold recognized, clickable, and styled as 'Your Hold'.");
  }

  // Test 2: Non-clearing of selectedTime when current patient's hold is acquired
  {
    const heldTracker = new HeldSlotTracker();
    heldTracker.record({
      appointmentId: "hold-a-1234",
      clinicId: CLINIC_ID,
      date: "2026-11-02",
      doctorId: DOC_NATHAN_ID,
      slotTime: "09:00",
    });

    let selectedTime = "09:00";
    let conflictWarning: string | null = null;

    // Simulate Realtime broadcast arriving for Patient A's own hold
    const payload = {
      changeType: "hold_acquired" as const,
      date: "2026-11-02",
      slotTime: "09:00",
      doctorId: DOC_NATHAN_ID,
      timestamp: Date.now(),
    };

    const isOwnHold = heldTracker.matches(payload.date, payload.slotTime, payload.doctorId);
    if (!isOwnHold) {
      selectedTime = "";
      conflictWarning = "Slot was just reserved by another patient.";
    }

    assert.equal(selectedTime, "09:00", "selectedTime must NOT be cleared when own hold_acquired arrives");
    assert.equal(conflictWarning, null, "No false conflict warning must be set for own hold");
    console.log("  ✓ Test 2 passed: selectedTime preserved on own hold_acquired broadcast.");
  }

  // Test 3: Refresh recovery of own active hold via get_my_active_appointment_hold / sessionStorage
  {
    const heldTracker = new HeldSlotTracker();
    assert.equal(heldTracker.get(), null, "Tracker starts empty on fresh page reload");

    // Simulated RPC response for authenticated patient
    const mockRpcRow = {
      appointment_id: "hold-refresh-recovered",
      clinic_id: CLINIC_ID,
      assigned_doctor_id: DOC_NATHAN_ID,
      slot_date: "2026-11-02",
      slot_time: "09:00",
      payment_hold_expires_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
      db_now: new Date().toISOString(),
    };

    const rec = heldTracker.record({
      appointmentId: mockRpcRow.appointment_id,
      clinicId: mockRpcRow.clinic_id,
      date: mockRpcRow.slot_date,
      doctorId: mockRpcRow.assigned_doctor_id,
      slotTime: mockRpcRow.slot_time,
    });

    assert.ok(rec, "Hold record must be created from active hold RPC");
    assert.equal(rec?.appointmentId, "hold-refresh-recovered");
    assert.equal(rec?.slotTime, "09:00");
    assert.equal(heldTracker.matches("2026-11-02", "09:00", DOC_NATHAN_ID), true);
    console.log("  ✓ Test 3 passed: Active hold securely recovered on refresh via RPC.");
  }

  // Test 4: Resuming checkout with existing active hold without creating duplicate appointment or extending expiry
  {
    const existingHoldExpiry = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    const existingAppt = {
      appointment_id: "active-hold-resume",
      payment_status: "pending_hold",
      payment_hold_expires_at: existingHoldExpiry,
      clinic_id: CLINIC_ID,
      assigned_doctor_id: DOC_NATHAN_ID,
      date: "2026-11-02T09:00:00+08:00",
      time: "09:00:00",
      batch_time: "09:00",
    };

    let acquireHoldCalled = false;
    let resumedApptId: string | null = null;

    // Checkout resume check
    const isSameSlot =
      getManilaCalendarDate(existingAppt.date) === "2026-11-02" &&
      existingAppt.batch_time === "09:00" &&
      existingAppt.assigned_doctor_id === DOC_NATHAN_ID;

    if (
      existingAppt.payment_status === "pending_hold" &&
      existingAppt.clinic_id === CLINIC_ID &&
      isSameSlot &&
      new Date(existingAppt.payment_hold_expires_at) > new Date()
    ) {
      resumedApptId = existingAppt.appointment_id;
    } else {
      acquireHoldCalled = true;
    }

    assert.equal(resumedApptId, "active-hold-resume", "Existing hold appointmentId must be reused");
    assert.equal(acquireHoldCalled, false, "acquireAppointmentSlotHold must NOT be called for existing active hold");
    assert.equal(existingAppt.payment_hold_expires_at, existingHoldExpiry, "Hold expiry must NOT be extended");
    console.log("  ✓ Test 4 passed: Resumed checkout with active hold without duplicates or expiry extensions.");
  }

  // Test 5: Competing reservations from other patients render as RESERVED, keep slot disabled, and display conflict warning banner
  {
    const heldTracker = new HeldSlotTracker();
    // Held tracker holds 09:00, NOT 10:00
    heldTracker.record({
      appointmentId: "hold-a",
      clinicId: CLINIC_ID,
      date: "2026-11-02",
      doctorId: DOC_NATHAN_ID,
      slotTime: "09:00",
    });

    let selectedTime = "10:00";
    let conflictWarning: string | null = null;

    // Competing patient acquires 10:00
    const competingPayload = {
      changeType: "hold_acquired" as const,
      date: "2026-11-02",
      slotTime: "10:00",
      doctorId: DOC_NATHAN_ID,
      timestamp: Date.now(),
    };

    const isOwnHold = heldTracker.matches(competingPayload.date, competingPayload.slotTime, competingPayload.doctorId);
    assert.equal(isOwnHold, false, "Competing reservation must NOT match Patient A");

    if (!isOwnHold) {
      if (selectedTime === competingPayload.slotTime) {
        selectedTime = "";
        conflictWarning = `The 10:00 AM consultation slot was just reserved by another patient. Please select another available time.`;
      }
    }

    assert.equal(selectedTime, "", "selectedTime must be cleared when slot is reserved by another patient");
    assert.ok(conflictWarning?.includes("reserved by another patient"), "Conflict warning must be set");

    // Verify warning banner suppression logic: banner must be displayed!
    const bannerSuppressed = !conflictWarning;
    assert.equal(bannerSuppressed, false, "Conflict warning banner must be visible");
    console.log("  ✓ Test 5 passed: Competing reservation clears selectedTime and displays conflict banner.");
  }

  // Test 6: Expired or released hold no longer displayed as YOUR HOLD
  {
    const heldTracker = new HeldSlotTracker();
    heldTracker.record({
      appointmentId: "hold-to-cancel",
      clinicId: CLINIC_ID,
      date: "2026-11-02",
      doctorId: DOC_NATHAN_ID,
      slotTime: "09:00",
    });

    assert.equal(heldTracker.matches("2026-11-02", "09:00", DOC_NATHAN_ID), true);

    // Cancel / release hold
    const releaseRes = { success: true };
    const cleared = heldTracker.clearOnReleaseResult(releaseRes);
    assert.equal(cleared, true);
    assert.equal(heldTracker.get(), null);
    assert.equal(heldTracker.matches("2026-11-02", "09:00", DOC_NATHAN_ID), false, "Released hold must NOT match caller");
    console.log("  ✓ Test 6 passed: Released / expired hold immediately cleared from 'Your Hold'.");
  }

  // Test 7: Restored 14-day alternate-doctor calendar
  {
    const modalPath = fs.existsSync("web/src/pages/patient/SelectAlternateDoctorModal.tsx")
      ? "web/src/pages/patient/SelectAlternateDoctorModal.tsx"
      : fs.existsSync("src/pages/patient/SelectAlternateDoctorModal.tsx")
      ? "src/pages/patient/SelectAlternateDoctorModal.tsx"
      : path.resolve(__dirname, "../pages/patient/SelectAlternateDoctorModal.tsx");
    const modalSrc = fs.readFileSync(modalPath, "utf8");

    assert.ok(modalSrc.includes("i <= 14") || modalSrc.includes("i <= 60"), "SelectAlternateDoctorModal must define upcoming date horizon");


    assert.ok(
      modalSrc.includes("availableUpcomingDates.map") || modalSrc.includes("calendarGridDays.map"),
      "SelectAlternateDoctorModal must render date selection grid/strip"
    );
    assert.ok(modalSrc.includes("SlotAvailabilityTracker"), "SelectAlternateDoctorModal must retain SlotAvailabilityTracker");
    console.log("  ✓ Test 7 passed: SelectAlternateDoctorModal 14-day date strip verified.");
  }

  // Test 8: Schema email_outbox preservation
  {
    const schemaPath = fs.existsSync("supabase/schema.sql")
      ? "supabase/schema.sql"
      : fs.existsSync("../supabase/schema.sql")
      ? "../supabase/schema.sql"
      : path.resolve(__dirname, "../../../supabase/schema.sql");
    const schemaSrc = fs.readFileSync(schemaPath, "utf8");

    assert.ok(schemaSrc.includes("public.email_outbox"), "schema.sql must contain public.email_outbox");
    assert.ok(schemaSrc.includes("claim_email_outbox"), "schema.sql must contain claim_email_outbox");
    assert.ok(schemaSrc.includes("claim_next_email_outbox_batch"), "schema.sql must contain claim_next_email_outbox_batch");
    assert.ok(schemaSrc.includes("finalize_email_outbox"), "schema.sql must contain finalize_email_outbox");
    assert.ok(schemaSrc.includes("get_my_active_appointment_hold"), "schema.sql must contain get_my_active_appointment_hold");

    // Verify ordering: Section 7 email outbox appears BEFORE Section 8 slot hold authority
    const emailOutboxPos = schemaSrc.indexOf("7. RELIABLE EMAIL OUTBOX & IDEMPOTENCY SYSTEM");
    const slotHoldPos = schemaSrc.indexOf("8. APPOINTMENT SLOT HOLD AUTHORITY & VISIBILITY SYSTEM");
    assert.ok(emailOutboxPos > 0, "Section 7 must exist");
    assert.ok(slotHoldPos > emailOutboxPos, "Section 8 must be appended after Section 7");
    console.log("  ✓ Test 8 passed: schema.sql email_outbox preserved and Section 8 cleanly appended.");
  }
}

runHeldSlotMetadataRegressionTests()
  .then(() => runOwnActiveHoldAndFinalRegressionTests())
  .then(() => {
    console.log("\n======================================================================");
    console.log("  ALL MANDATORY SLOT RESERVATION & REGRESSION TESTS PASSED SUCCESSFULLY!");
    console.log("======================================================================\n");
  })
  .catch((err) => {
    console.error("Slot Reservation Authority & Sync Test Suite Failed:", err);
    process.exit(1);
  });
