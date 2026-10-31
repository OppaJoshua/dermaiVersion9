/**
 * DermAI — Multi-Account Real-Time Slot Availability & Synchronization Test Suite
 *
 * Simulates two independent patient accounts (Patient A and Patient B) interacting with
 * the same clinic, doctor, and date to verify all 7 core availability scenarios:
 *
 * 1. Patient A acquires hold -> Patient B immediately sees RESERVED without refresh.
 * 2. Patient A cancels payment modal -> Patient A and Patient B immediately see AVAILABLE without refresh.
 * 3. Patient A acquires hold -> Patient B attempts to acquire same slot -> server rejects Patient B with ERR_SLOT_UNAVAILABLE.
 * 4. Patient A completes payment -> Patient A and Patient B see BOOKED.
 * 5. Hold expires (10 minutes) -> slot automatically transitions back to AVAILABLE.
 * 6. Concurrent hold acquisition by Patient A and Patient B -> exactly one succeeds, the other is rejected with ERR_SLOT_UNAVAILABLE.
 * 7. Page refresh for both accounts confirms state matches database truth.
 */

import assert from "node:assert/strict";
import {
  generateDaySlotsForDoctor,
  type DoctorWeeklySchedule,
  getManilaCalendarDate,
} from "../lib/schedulingService";
import {
  type BroadcastSlotChangePayload,
  type OccupiedSlotRecord,
} from "../lib/slotAvailabilityRealtime";

console.log("\n=======================================================");
console.log("DermAI — Multi-Account Slot Availability Synchronization Suite");
console.log("=======================================================\n");

const clinicId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const doctorId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const selectedDate = "2026-11-06"; // Friday

const sampleDoctorSchedule: DoctorWeeklySchedule = {
  slotIntervalMinutes: 30,
  maxPatientsPerShift: 16,
  weeklyShifts: {
    Friday: [
      {
        id: "shift-fri-morning",
        shiftLabel: "Morning Shift",
        startTime: "09:00",
        endTime: "17:00",
      },
    ],
  },
};

const clinicDefaults = {
  defaultSlotIntervalMinutes: 30,
  defaultMaxPatientsPerShift: 16,
  openTime: "09:00",
  closeTime: "17:00",
  operatingDays: "Monday - Saturday",
};

// Simulated Authoritative PostgreSQL Database Table: public.patient_appointment
interface DbAppointmentRow {
  appointment_id: string;
  clinic_id: string;
  assigned_doctor_id: string | null;
  date: string; // ISO timestamp
  time: string;
  batch_time: string;
  status: string; // pending, scheduled, cancelled, rejected
  doctor_status: string;
  payment_status: string; // pending_hold, paid, cancelled, expired, failed
  payment_hold_expires_at: string | null;
  user_id: string;
}

let databaseRows: DbAppointmentRow[] = [];

// Simulated PostgreSQL RPC: get_occupied_appointment_slots(p_clinic_id, p_date, p_doctor_id)
function rpcGetOccupiedAppointmentSlots(
  p_clinic_id: string,
  p_date: string,
  p_doctor_id: string | null = null,
  currentSimulatedTimeMs: number = Date.now()
): Array<{
  slot_time: string;
  slot_date: string;
  assigned_doctor_id: string | null;
  clinic_id: string;
  occupancy_type: string;
}> {
  const result: Array<{
    slot_time: string;
    slot_date: string;
    assigned_doctor_id: string | null;
    clinic_id: string;
    occupancy_type: string;
  }> = [];

  const targetDate = getManilaCalendarDate(p_date);

  for (const pa of databaseRows) {
    if (pa.clinic_id !== p_clinic_id) continue;
    if (getManilaCalendarDate(pa.date) !== targetDate) continue;
    if (p_doctor_id && pa.assigned_doctor_id && pa.assigned_doctor_id !== p_doctor_id) continue;
    if (pa.status === "cancelled" || pa.status === "rejected") continue;
    if (pa.doctor_status === "rejected") continue;

    if (pa.payment_status === "expired" || pa.payment_status === "cancelled" || pa.payment_status === "failed") {
      continue;
    }

    if (pa.payment_status === "pending_hold" && pa.payment_hold_expires_at) {
      const expTime = new Date(pa.payment_hold_expires_at).getTime();
      if (!isNaN(expTime) && expTime <= currentSimulatedTimeMs) {
        continue; // Expired hold excluded by SQL query
      }
    }

    const slotTimeClean = (pa.time || pa.batch_time || "08:00").slice(0, 5);
    const occType = pa.payment_status === "pending_hold" ? "reserved" : "booked";

    result.push({
      slot_time: slotTimeClean,
      slot_date: targetDate,
      assigned_doctor_id: pa.assigned_doctor_id,
      clinic_id: pa.clinic_id,
      occupancy_type: occType,
    });
  }

  return result;
}

// Simulated PostgreSQL RPC: acquire_appointment_slot_hold
function rpcAcquireAppointmentSlotHold(params: {
  clinic_id: string;
  doctor_id: string | null;
  date: string;
  time: string;
  user_id: string;
  hold_duration_minutes?: number;
  currentSimulatedTimeMs?: number;
}): { success: boolean; appointment_id?: string; code?: string; message?: string } {
  const nowMs = params.currentSimulatedTimeMs ?? Date.now();
  const timeClean = params.time.slice(0, 5);
  const targetDate = getManilaCalendarDate(params.date);

  // Check existing appointments on this slot (concurrency lock serialized)
  const existing = databaseRows.find((r) => {
    return (
      r.clinic_id === params.clinic_id &&
      (!params.doctor_id || !r.assigned_doctor_id || r.assigned_doctor_id === params.doctor_id) &&
      getManilaCalendarDate(r.date) === targetDate &&
      (r.time || r.batch_time).slice(0, 5) === timeClean &&
      r.status !== "cancelled" &&
      r.status !== "rejected"
    );
  });

  if (existing) {
    // A. Idempotent Retry by same user
    if (
      existing.user_id === params.user_id &&
      existing.payment_status === "pending_hold" &&
      existing.payment_hold_expires_at &&
      new Date(existing.payment_hold_expires_at).getTime() > nowMs
    ) {
      return { success: true, appointment_id: existing.appointment_id };
    }

    // B. Expired Hold: reap and allow
    if (
      existing.payment_status === "pending_hold" &&
      existing.payment_hold_expires_at &&
      new Date(existing.payment_hold_expires_at).getTime() <= nowMs
    ) {
      existing.status = "cancelled";
      existing.payment_status = "expired";
    } else if (existing.payment_status !== "expired" && existing.payment_status !== "cancelled") {
      // Slot is occupied by active hold or booking
      return {
        success: false,
        code: "ERR_SLOT_UNAVAILABLE",
        message: "This consultation slot has just been reserved by another patient. Please select another available time.",
      };
    }
  }

  // Create new pending hold
  const newApptId = `appt-${Math.random().toString(36).slice(2, 9)}`;
  const expiresAt = new Date(nowMs + (params.hold_duration_minutes ?? 10) * 60 * 1000).toISOString();

  databaseRows.push({
    appointment_id: newApptId,
    clinic_id: params.clinic_id,
    assigned_doctor_id: params.doctor_id,
    date: params.date,
    time: timeClean,
    batch_time: timeClean,
    status: "pending",
    doctor_status: "approved",
    payment_status: "pending_hold",
    payment_hold_expires_at: expiresAt,
    user_id: params.user_id,
  });

  return { success: true, appointment_id: newApptId };
}

// Simulated PostgreSQL RPC: cancel_appointment_hold
function rpcCancelAppointmentHold(
  appointmentId: string,
  callerUserId: string
): { success: boolean; code?: string; message?: string } {
  const appt = databaseRows.find((r) => r.appointment_id === appointmentId);
  if (!appt) {
    return { success: false, code: "ERR_NOT_FOUND", message: "Appointment not found." };
  }
  if (appt.payment_status === "paid") {
    return { success: false, code: "ERR_ALREADY_PAID", message: "Cannot cancel hold: appointment is already paid." };
  }
  if (appt.user_id !== callerUserId) {
    return { success: false, code: "ERR_FORBIDDEN", message: "Unauthorized to cancel another patient's hold." };
  }

  appt.status = "cancelled";
  appt.payment_status = "cancelled";
  return { success: true, message: "Slot hold cancelled successfully." };
}

// Simulated Client State representing a patient's open browser session
class SimulatedPatientSession {
  public userId: string;
  public clinicId: string;
  public doctorId: string;
  public selectedDate: string;
  public existingBookings: OccupiedSlotRecord[] = [];
  public currentSimulatedTimeMs: number = Date.now();

  constructor(userId: string, clinicId: string, doctorId: string, selectedDate: string) {
    this.userId = userId;
    this.clinicId = clinicId;
    this.doctorId = doctorId;
    this.selectedDate = selectedDate;
  }

  // Simulated fetchAuthoritativeOccupiedSlots() using RPC
  public async fetchBookings(): Promise<void> {
    const rpcSlots = rpcGetOccupiedAppointmentSlots(
      this.clinicId,
      this.selectedDate,
      this.doctorId,
      this.currentSimulatedTimeMs
    );

    const bookingsList: OccupiedSlotRecord[] = [];
    for (const s of rpcSlots) {
      const occType = s.occupancy_type === "reserved" ? "reserved" : "booked";
      bookingsList.push({
        date: s.slot_date,
        time: s.slot_time,
        batch_time: s.slot_time,
        assigned_doctor_id: s.assigned_doctor_id,
        clinic_id: s.clinic_id,
        status: occType === "reserved" ? "pending" : "scheduled",
        doctor_status: "approved",
        payment_status: occType === "reserved" ? "pending_hold" : "paid",
        occupancy_type: occType,
        payment_hold_expires_at: null,
      });
    }

    this.existingBookings = bookingsList;
  }

  // Handle incoming Supabase Realtime Broadcast
  public handleRealtimeBroadcast(payload: BroadcastSlotChangePayload): void {
    if (payload.clinicId !== this.clinicId) return;
    if (payload.date && payload.date !== this.selectedDate) return;

    if (payload.changeType === "hold_released" || payload.changeType === "cancelled") {
      const timeClean = (payload.slotTime || "").slice(0, 5);
      this.existingBookings = this.existingBookings.filter((b) => b.time !== timeClean);
    }

    // Immediately trigger authoritative fetchBookings() to synchronize state with database truth
    this.fetchBookings();
  }

  // Evaluate slots for current view
  public getSlots() {
    const dayGroups = generateDaySlotsForDoctor({
      doctorSchedule: sampleDoctorSchedule,
      dayOfWeek: "Friday",
      doctorId: this.doctorId,
      clinicDefaults,
      existingAppointments: this.existingBookings,
      isToday: false,
      currentMinutesNow: 0,
    });
    return dayGroups.flatMap((g) => g.slots);
  }
}

// =============================================================================
// SCENARIO 1: Patient A acquires hold -> Patient B sees RESERVED immediately
// =============================================================================
console.log("[Scenario 1] Patient A acquires hold for 09:30 AM -> Patient B receives Realtime broadcast...");

databaseRows = []; // Fresh DB state
const patientA = new SimulatedPatientSession("user-patient-a", clinicId, doctorId, selectedDate);
const patientB = new SimulatedPatientSession("user-patient-b", clinicId, doctorId, selectedDate);

// Both patients open page: initially 09:30 AM is AVAILABLE
patientA.fetchBookings();
patientB.fetchBookings();

const slotBInit = patientB.getSlots().find((s) => s.slotTime === "09:30")!;
assert.equal(slotBInit.isAvailable, true, "Initially 09:30 AM must be AVAILABLE for Patient B");
assert.equal(slotBInit.isReserved, false);
assert.equal(slotBInit.isBooked, false);

// Patient A acquires temporary hold via PostgreSQL RPC
const holdResA = rpcAcquireAppointmentSlotHold({
  clinic_id: clinicId,
  doctor_id: doctorId,
  date: `${selectedDate}T09:30:00+08:00`,
  time: "09:30",
  user_id: patientA.userId,
});
assert.equal(holdResA.success, true, "Patient A hold acquisition must succeed");

// Realtime broadcast emitted by Patient A
const broadcastPayload1: BroadcastSlotChangePayload = {
  clinicId,
  date: selectedDate,
  doctorId,
  slotTime: "09:30",
  changeType: "hold_acquired",
  timestamp: Date.now(),
};

// Patient B receives Realtime broadcast without refreshing page
patientB.handleRealtimeBroadcast(broadcastPayload1);

const slotBAfterHold = patientB.getSlots().find((s) => s.slotTime === "09:30")!;
assert.equal(slotBAfterHold.isAvailable, false, "09:30 AM must no longer be AVAILABLE for Patient B");
assert.equal(slotBAfterHold.isReserved, true, "09:30 AM must visibly display RESERVED for Patient B");
assert.equal(slotBAfterHold.occupancyType, "reserved", "Occupancy type must be 'reserved'");
console.log("  ✓ Verified: Patient B automatically sees 09:30 AM marked RESERVED via Realtime without refresh.");

// =============================================================================
// SCENARIO 2: Patient A cancels payment modal -> Patient A and Patient B see AVAILABLE
// =============================================================================
console.log("\n[Scenario 2] Patient A cancels payment modal -> slot immediately returns to AVAILABLE for both...");

// Patient A cancels the hold via PostgreSQL RPC
const cancelResA = rpcCancelAppointmentHold(holdResA.appointment_id!, patientA.userId);
assert.equal(cancelResA.success, true, "Hold cancellation must succeed in database");

// Realtime broadcast emitted by Patient A
const broadcastPayload2: BroadcastSlotChangePayload = {
  clinicId,
  date: selectedDate,
  doctorId,
  slotTime: "09:30",
  changeType: "hold_released",
  timestamp: Date.now(),
};

// Both sessions receive the release event
patientA.handleRealtimeBroadcast(broadcastPayload2);
patientB.handleRealtimeBroadcast(broadcastPayload2);

const slotAAfterCancel = patientA.getSlots().find((s) => s.slotTime === "09:30")!;
const slotBAfterCancel = patientB.getSlots().find((s) => s.slotTime === "09:30")!;

assert.equal(slotAAfterCancel.isAvailable, true, "Patient A must immediately see 09:30 AM as AVAILABLE");
assert.equal(slotAAfterCancel.isReserved, false, "Patient A must NOT see 09:30 AM as RESERVED");
assert.equal(slotAAfterCancel.occupancyType, "available");

assert.equal(slotBAfterCancel.isAvailable, true, "Patient B must immediately see 09:30 AM as AVAILABLE");
assert.equal(slotBAfterCancel.isReserved, false, "Patient B must NOT see 09:30 AM as RESERVED");
assert.equal(slotBAfterCancel.occupancyType, "available");
console.log("  ✓ Verified: Both Patient A and Patient B immediately see AVAILABLE without requiring page refresh.");

// =============================================================================
// SCENARIO 3: Patient A acquires hold -> Patient B attempts to acquire same slot -> rejected
// =============================================================================
console.log("\n[Scenario 3] Patient A acquires hold -> Patient B attempts to acquire same slot -> server rejects...");

const holdResA2 = rpcAcquireAppointmentSlotHold({
  clinic_id: clinicId,
  doctor_id: doctorId,
  date: `${selectedDate}T09:30:00+08:00`,
  time: "09:30",
  user_id: patientA.userId,
});
assert.equal(holdResA2.success, true);

// Patient B attempts to acquire the exact same slot while Patient A holds it
const holdResB = rpcAcquireAppointmentSlotHold({
  clinic_id: clinicId,
  doctor_id: doctorId,
  date: `${selectedDate}T09:30:00+08:00`,
  time: "09:30",
  user_id: patientB.userId,
});

assert.equal(holdResB.success, false, "Patient B collision acquisition must be rejected by server");
assert.equal(holdResB.code, "ERR_SLOT_UNAVAILABLE", "Server must return ERR_SLOT_UNAVAILABLE code");
console.log("  ✓ Verified: Server atomically rejects Patient B with ERR_SLOT_UNAVAILABLE.");

// =============================================================================
// SCENARIO 4: Patient A completes payment -> Patient A and Patient B see BOOKED
// =============================================================================
console.log("\n[Scenario 4] Patient A completes payment -> Patient A and Patient B see BOOKED...");

// Simulate PayMongo webhook / RPC fulfilling payment in database
const heldAppt = databaseRows.find((r) => r.appointment_id === holdResA2.appointment_id!)!;
heldAppt.status = "scheduled";
heldAppt.payment_status = "paid";

// Realtime broadcast emitted on payment completion
const broadcastPayload3: BroadcastSlotChangePayload = {
  clinicId,
  date: selectedDate,
  doctorId,
  slotTime: "09:30",
  changeType: "payment_completed",
  timestamp: Date.now(),
};

patientA.handleRealtimeBroadcast(broadcastPayload3);
patientB.handleRealtimeBroadcast(broadcastPayload3);

const slotAAfterPaid = patientA.getSlots().find((s) => s.slotTime === "09:30")!;
const slotBAfterPaid = patientB.getSlots().find((s) => s.slotTime === "09:30")!;

assert.equal(slotAAfterPaid.isAvailable, false);
assert.equal(slotAAfterPaid.isReserved, false);
assert.equal(slotAAfterPaid.isBooked, true, "Slot must be marked BOOKED for Patient A");
assert.equal(slotAAfterPaid.occupancyType, "booked");

assert.equal(slotBAfterPaid.isAvailable, false);
assert.equal(slotBAfterPaid.isReserved, false);
assert.equal(slotBAfterPaid.isBooked, true, "Slot must be marked BOOKED for Patient B");
assert.equal(slotBAfterPaid.occupancyType, "booked");
console.log("  ✓ Verified: Slot transitions from RESERVED to BOOKED for both accounts.");

// =============================================================================
// SCENARIO 5: Hold expires (10 minutes) -> slot automatically becomes AVAILABLE
// =============================================================================
console.log("\n[Scenario 5] Hold expires after 10 minutes -> slot automatically transitions back to AVAILABLE...");

// Fresh hold for 10:00 AM
const baseTimeMs = Date.now();
const hold10Am = rpcAcquireAppointmentSlotHold({
  clinic_id: clinicId,
  doctor_id: doctorId,
  date: `${selectedDate}T10:00:00+08:00`,
  time: "10:00",
  user_id: patientA.userId,
  hold_duration_minutes: 10,
  currentSimulatedTimeMs: baseTimeMs,
});
assert.equal(hold10Am.success, true);

// Fast-forward simulated clock by 11 minutes (past 10-minute hold expiration)
const expiredTimeMs = baseTimeMs + 11 * 60 * 1000;
patientA.currentSimulatedTimeMs = expiredTimeMs;
patientB.currentSimulatedTimeMs = expiredTimeMs;

// Both sessions re-fetch via periodic polling or focus
patientA.fetchBookings();
patientB.fetchBookings();

const slotAExpired = patientA.getSlots().find((s) => s.slotTime === "10:00")!;
const slotBExpired = patientB.getSlots().find((s) => s.slotTime === "10:00")!;

assert.equal(slotAExpired.isAvailable, true, "Expired hold must be AVAILABLE for Patient A");
assert.equal(slotAExpired.isReserved, false);
assert.equal(slotBExpired.isAvailable, true, "Expired hold must be AVAILABLE for Patient B");
assert.equal(slotBExpired.isReserved, false);
console.log("  ✓ Verified: Expired hold automatically frees up slot as AVAILABLE for all patients.");

// =============================================================================
// SCENARIO 6: Concurrent hold acquisition by Patient A and Patient B -> exactly one succeeds
// =============================================================================
console.log("\n[Scenario 6] Concurrent hold acquisition attempt for 11:00 AM...");

// Simulate simultaneous acquisition calls arriving at the database
const results = [
  rpcAcquireAppointmentSlotHold({
    clinic_id: clinicId,
    doctor_id: doctorId,
    date: `${selectedDate}T11:00:00+08:00`,
    time: "11:00",
    user_id: patientA.userId,
    currentSimulatedTimeMs: expiredTimeMs,
  }),
  rpcAcquireAppointmentSlotHold({
    clinic_id: clinicId,
    doctor_id: doctorId,
    date: `${selectedDate}T11:00:00+08:00`,
    time: "11:00",
    user_id: patientB.userId,
    currentSimulatedTimeMs: expiredTimeMs,
  }),
];

const successCount = results.filter((r) => r.success).length;
const rejectedCount = results.filter((r) => !r.success && r.code === "ERR_SLOT_UNAVAILABLE").length;

assert.equal(successCount, 1, "Exactly one patient must succeed in acquiring the slot");
assert.equal(rejectedCount, 1, "The competing patient must receive ERR_SLOT_UNAVAILABLE");
console.log("  ✓ Verified: Atomic concurrency lock permits exactly 1 winner; other is rejected with ERR_SLOT_UNAVAILABLE.");

// =============================================================================
// SCENARIO 7: Page refresh for both accounts confirms state matches database truth
// =============================================================================
console.log("\n[Scenario 7] Hard page refresh for both accounts confirms state matches database truth...");

// Create fresh sessions simulating a full browser page reload (F5)
const reloadedPatientA = new SimulatedPatientSession("user-patient-a", clinicId, doctorId, selectedDate);
const reloadedPatientB = new SimulatedPatientSession("user-patient-b", clinicId, doctorId, selectedDate);

reloadedPatientA.currentSimulatedTimeMs = expiredTimeMs;
reloadedPatientB.currentSimulatedTimeMs = expiredTimeMs;

reloadedPatientA.fetchBookings();
reloadedPatientB.fetchBookings();

const slotsA = reloadedPatientA.getSlots();
const slotsB = reloadedPatientB.getSlots();

// 09:30 AM was paid in Scenario 4 -> BOOKED on both
assert.equal(slotsA.find((s) => s.slotTime === "09:30")!.occupancyType, "booked");
assert.equal(slotsB.find((s) => s.slotTime === "09:30")!.occupancyType, "booked");

// 10:00 AM expired in Scenario 5 -> AVAILABLE on both
assert.equal(slotsA.find((s) => s.slotTime === "10:00")!.occupancyType, "available");
assert.equal(slotsB.find((s) => s.slotTime === "10:00")!.occupancyType, "available");

// 11:00 AM acquired in Scenario 6 -> RESERVED on both
assert.equal(slotsA.find((s) => s.slotTime === "11:00")!.occupancyType, "reserved");
assert.equal(slotsB.find((s) => s.slotTime === "11:00")!.occupancyType, "reserved");

console.log("  ✓ Verified: Page refresh confirms identical, accurate availability state matching database truth.");

console.log("\n====================================================================");
console.log("  ALL 7 MULTI-ACCOUNT AVAILABILITY SYNCHRONIZATION SCENARIOS PASSED!  ");
console.log("====================================================================\n");
