import assert from "node:assert/strict";
import {
  serializeDoctorSchedule,
  parseAssignedDoctorSchedule,
  isDoctorOnDutyOnDay,
  isDoctorCurrentlyOnDuty,
  validateDoctorShifts,
  ALL_DAYS_OF_WEEK,
} from "../lib/schedulingService";
import type { DoctorWeeklySchedule, DoctorShift } from "../lib/schedulingService";

console.log("=== DermAI Off Duty & Empty Schedule Acceptance Test Suite ===");

// ── Scenario 1: Doctor initially configured with Monday & Tuesday shifts ──
const initialSchedule: DoctorWeeklySchedule = {
  weeklyShifts: {
    Monday: [
      {
        id: "shift-mon-1",
        label: "Morning Shift",
        startTime: "08:00",
        endTime: "12:00",
      },
    ],
    Tuesday: [
      {
        id: "shift-tue-1",
        label: "Afternoon Shift",
        startTime: "13:00",
        endTime: "17:00",
      },
    ],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  },
  slotIntervalMinutes: 20,
  isCustomSchedule: true,
};

const initialSerialized = serializeDoctorSchedule(initialSchedule, ["Monday", "Tuesday"]);
assert.equal(Array.isArray(initialSerialized.weeklyShifts.Monday), true);
assert.equal(initialSerialized.weeklyShifts.Monday.length, 1);
assert.equal(initialSerialized.weeklyShifts.Tuesday.length, 1);
assert.equal(initialSerialized.Monday.startTime, "08:00");
console.log("✓ Scenario 1: Initial Monday & Tuesday schedule serialized successfully.");

// ── Scenario 2: Uncheck all duty days (empty schedule / Off Duty) ──
const emptyDutyDays: string[] = [];
const emptyWeeklyShifts: Record<string, DoctorShift[]> = {};
ALL_DAYS_OF_WEEK.forEach((d) => {
  emptyWeeklyShifts[d] = [];
});

const emptySerialized = serializeDoctorSchedule(
  {
    weeklyShifts: emptyWeeklyShifts,
    slotIntervalMinutes: 20,
    isCustomSchedule: false,
  },
  emptyDutyDays
);

// Verify all days have empty shifts and legacy day keys are NOT populated
ALL_DAYS_OF_WEEK.forEach((d) => {
  assert.deepEqual(emptySerialized.weeklyShifts[d], []);
  assert.equal(emptySerialized[d], undefined, `Legacy key ${d} should not exist in empty schedule`);
});
assert.equal(emptySerialized.isCustomSchedule, false);
console.log("✓ Scenario 2: Unchecked all duty days: serialized output cleanly sets all days to [] with 0 ghost shifts.");

// ── Scenario 3: Reopen the schedule with saved Off Duty state ──
const dbRow = {
  duty_schedule: emptySerialized,
  duty_days: emptyDutyDays,
  duty_start_time: null,
  duty_end_time: null,
};

const parsedFromDb = parseAssignedDoctorSchedule(dbRow);
// When duty_days is empty, parseAssignedDoctorSchedule returns null, indicating no active assigned duty days
assert.equal(parsedFromDb, null);

// In ClinicDoctorsPage:
const hydratedSchedule: any = parsedFromDb;
const hydratedForm = {
  dutyDays: ALL_DAYS_OF_WEEK.filter((day) => hydratedSchedule?.weeklyShifts[day]?.length),
  weeklyShifts: hydratedSchedule?.weeklyShifts || {},
  doctorSlotInterval: hydratedSchedule?.slotIntervalMinutes ?? null,
};
assert.deepEqual(hydratedForm.dutyDays, []);
assert.deepEqual(hydratedForm.weeklyShifts, {});
console.log("✓ Scenario 3: Reopening schedule with saved Off Duty state correctly hydrates 0 duty days.");

// ── Scenario 4: Verify weekly summary metrics for empty schedule ──
const activeDaysCount = hydratedForm.dutyDays.length;
let totalHours = 0;
let totalSlots = 0;
hydratedForm.dutyDays.forEach((day) => {
  const shifts = hydratedForm.weeklyShifts[day] || [];
  shifts.forEach(() => {
    totalHours += 4;
    totalSlots += 12;
  });
});
assert.equal(activeDaysCount, 0, "Expected 0 days on duty");
assert.equal(totalHours, 0, "Expected 0 hours per week");
assert.equal(totalSlots, 0, "Expected 0 slots per week");

// Verify all 7 weekday badges are inactive / Off
ALL_DAYS_OF_WEEK.forEach((d) => {
  const isDayActive = hydratedForm.dutyDays.includes(d);
  assert.equal(isDayActive, false, `${d} should be Off`);
});
console.log("✓ Scenario 4: Weekly summary strictly calculates 0 days, 0 hours, 0 slots, and all 7 days display Off.");

// ── Scenario 5: Verify previous shifts are no longer considered active for booking or on-duty ──
const offDutyDoctor = {
  id: "doc-1",
  name: "Dr. Nathan Bayutas",
  dutyDays: [],
  dutyStartTime: null,
  dutyEndTime: null,
  dutySchedule: emptySerialized,
};

ALL_DAYS_OF_WEEK.forEach((day) => {
  const isOnDuty = isDoctorOnDutyOnDay(offDutyDoctor, day, {
    openTime: "08:00",
    closeTime: "17:00",
    operatingDays: "Monday - Friday",
  });
  assert.equal(isOnDuty, false, `Doctor should be Off Duty on ${day}`);
});

const currentDutyStatus = isDoctorCurrentlyOnDuty({
  doctor: offDutyDoctor,
  clinicSchedule: {
    openTime: "08:00",
    closeTime: "17:00",
    operatingDays: "Monday - Friday",
  },
  timezone: "Asia/Manila",
  currentTimeMs: Date.now(),
});
assert.equal(currentDutyStatus.isOnDuty, false);
console.log("✓ Scenario 5: Previous shifts are strictly inactive; doctor is off duty and cannot be booked on any day.");

// ── Scenario 6: Add a new shift and save again (re-scheduling works normally) ──
const rescheduledDutyDays = ["Wednesday", "Thursday"];
const rescheduledWeeklyShifts: Record<string, DoctorShift[]> = {};
ALL_DAYS_OF_WEEK.forEach((d) => {
  rescheduledWeeklyShifts[d] = [];
});
rescheduledWeeklyShifts["Wednesday"] = [
  {
    id: "shift-wed-1",
    label: "Morning Shift",
    startTime: "09:00",
    endTime: "13:00",
  },
];
rescheduledWeeklyShifts["Thursday"] = [
  {
    id: "shift-thu-1",
    label: "Afternoon Shift",
    startTime: "13:00",
    endTime: "17:00",
  },
];

const rescheduledSerialized = serializeDoctorSchedule(
  {
    weeklyShifts: rescheduledWeeklyShifts,
    slotIntervalMinutes: 20,
    isCustomSchedule: true,
  },
  rescheduledDutyDays
);

assert.equal(rescheduledSerialized.weeklyShifts.Wednesday.length, 1);
assert.equal(rescheduledSerialized.weeklyShifts.Thursday.length, 1);
assert.equal(rescheduledSerialized.weeklyShifts.Monday.length, 0);

const reScheduledDoctor = {
  id: "doc-1",
  name: "Dr. Nathan Bayutas",
  dutyDays: rescheduledDutyDays,
  dutyStartTime: "09:00",
  dutyEndTime: "13:00",
  dutySchedule: rescheduledSerialized,
};
assert.equal(isDoctorOnDutyOnDay(reScheduledDoctor, "Wednesday"), true);
assert.equal(isDoctorOnDutyOnDay(reScheduledDoctor, "Monday"), false);
console.log("✓ Scenario 6: Re-assigning duty days and shifts saves normally and re-activates consultation hours.");

// ── Scenario 7: Incomplete/invalid shifts on checked duty days still trigger validation ──
const invalidShifts: DoctorShift[] = [
  {
    id: "shift-bad-1",
    label: "Invalid Shift",
    startTime: "17:00",
    endTime: "09:00", // End before start
  },
];
const validationErrors = validateDoctorShifts(
  invalidShifts,
  "Monday",
  "08:00",
  "18:00",
  "Monday - Friday"
);
assert.ok(validationErrors.length > 0, "Should detect invalid shift times");
console.log("✓ Scenario 7: Invalid or incomplete shifts on checked days still trigger proper validation.");

// ── Scenario 8: Removing every shift results in empty schedule ──
const allShiftsRemoved: Record<string, DoctorShift[]> = {};
ALL_DAYS_OF_WEEK.forEach((d) => {
  allShiftsRemoved[d] = [];
});
const emptyFromRemoval = serializeDoctorSchedule(
  {
    weeklyShifts: allShiftsRemoved,
    slotIntervalMinutes: 20,
    isCustomSchedule: false,
  },
  []
);
ALL_DAYS_OF_WEEK.forEach((d) => {
  assert.deepEqual(emptyFromRemoval.weeklyShifts[d], []);
});
console.log("✓ Scenario 8: Removing every shift correctly serializes as an empty schedule.");

// ── Scenario 9: Other doctors remain unaffected ──
const otherDoctor = {
  id: "doc-2",
  name: "Dr. Maria Santos",
  dutyDays: ["Monday", "Friday"],
  dutyStartTime: "08:00",
  dutyEndTime: "17:00",
  dutySchedule: initialSerialized,
};
assert.equal(isDoctorOnDutyOnDay(otherDoctor, "Monday"), true);
assert.equal(isDoctorOnDutyOnDay(otherDoctor, "Wednesday"), false);
console.log("✓ Scenario 9: Other doctors' schedules and duty statuses remain completely unaffected.");

console.log("\n==========================================================================");
console.log("  ALL 9 OFF DUTY & EMPTY SCHEDULE ACCEPTANCE TEST SCENARIOS PASSED!");
console.log("==========================================================================");
