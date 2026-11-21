import assert from "node:assert/strict";
import {
  ALL_DAYS_OF_WEEK,
  generateDaySlotsForDoctor,
  isDoctorCurrentlyOnDuty,
  isDoctorOnDutyOnDay,
  parseAppointmentTimeMinutes,
  parseAssignedDoctorSchedule,
  parseDoctorSchedule,
  serializeDoctorSchedule,
  validateDoctorReassignment,
  type DoctorWeeklySchedule,
} from "../lib/schedulingService.ts";
import {
  findCrossClinicDutyConflicts,
  type DoctorDutyAssignment,
} from "../lib/doctorScheduleConflicts.ts";
import {
  findConflictingAppointmentsForDoctorSchedule,
  saveAuthorizedDoctorDutySchedule,
} from "../lib/doctorDutySchedule.ts";

console.log("=== DermAI Doctor Self-Service Duty Schedule & Real-Time Sync Test Suite ===");

// ── 1. Multi-Clinic Branch Conflict Detection (Doctor & Clinic Perspectives) ──
{
  const otherBranches: DoctorDutyAssignment[] = [
    {
      doctor_id: "doc-branch-a",
      clinic_id: "clinic-a",
      duty_days: ["Monday", "Tuesday", "Sunday"],
      duty_schedule: serializeDoctorSchedule(
        {
          weeklyShifts: {
            Monday: [{ id: "s1", label: "Morning Shift", startTime: "08:00", endTime: "12:00" }],
            Tuesday: [{ id: "s2", label: "Afternoon Shift", startTime: "13:00", endTime: "20:00" }],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
            Sunday: [{ id: "s3", label: "Sunday Shift", startTime: "08:00", endTime: "17:00" }],
          },
          slotIntervalMinutes: 30,
          isCustomSchedule: true,
        },
        ["Monday", "Tuesday", "Sunday"]
      ),
      clinic: { name: "Skin Clinic" },
    },
  ];

  // Case 1A: Non-overlapping Monday afternoon shift (1:00 PM - 5:00 PM) at Derma Care -> Allowed
  const nonOverlapping = findCrossClinicDutyConflicts(otherBranches, {
    doctorId: "doc-branch-b",
    clinicId: "clinic-b",
    doctorName: "Dr. Maria Santos",
    days: ["Monday"],
    weeklyShifts: {
      Monday: [{ id: "b1", label: "Afternoon Shift", startTime: "13:00", endTime: "17:00" }],
    },
    perspective: "doctor",
  });
  assert.equal(nonOverlapping.length, 0, "Adjacent/non-overlapping shift on Monday afternoon must be allowed");

  // Case 1B: Overlapping Monday morning shift (10:00 AM - 2:00 PM) at Derma Care -> Blocked with exact required message
  const overlapping = findCrossClinicDutyConflicts(otherBranches, {
    doctorId: "doc-branch-b",
    clinicId: "clinic-b",
    doctorName: "Dr. Maria Santos",
    days: ["Monday"],
    weeklyShifts: {
      Monday: [{ id: "b2", label: "Overlap Shift", startTime: "10:00", endTime: "14:00" }],
    },
    perspective: "doctor",
  });
  assert.equal(overlapping.length, 1);
  assert.equal(
    overlapping[0].message,
    "Schedule Conflict: You already have a duty schedule at Skin Clinic from 8:00 AM to 12:00 PM on Monday."
  );

  // Case 1C: Clinic Admin perspective message remains clear and doctor-named
  const clinicPerspective = findCrossClinicDutyConflicts(otherBranches, {
    doctorId: "doc-branch-b",
    clinicId: "clinic-b",
    doctorName: "Dr. Maria Santos",
    days: ["Monday"],
    weeklyShifts: {
      Monday: [{ id: "b2", label: "Overlap Shift", startTime: "10:00", endTime: "14:00" }],
    },
    perspective: "clinic",
  });
  assert.equal(
    clinicPerspective[0].message,
    "Dr. Maria Santos is already on duty at Skin Clinic on Monday from 8:00 AM to 12:00 PM."
  );

  console.log("✓ 1. Multi-clinic branch conflict detection enforces exact conflict messages for both doctor and clinic admin.");
}

// ── 2. 4-Tier Precedence Rule & Explicitly Empty Weekday Schedules ──
{
  // Tier 3A: weeklyShifts has Monday: [] while Monday is in duty_days and fallback times are 08:00–17:00.
  // Explicitly empty Monday array in weeklyShifts MUST NOT synthesize a fallback 08:00–17:00 shift!
  const explicitEmptyMondaySchedule = parseDoctorSchedule(
    {
      weeklyShifts: {
        Monday: [],
        Tuesday: [{ id: "t1", label: "Morning Shift", startTime: "09:00", endTime: "12:00" }],
      },
      slotIntervalMinutes: 30,
      isCustomSchedule: true,
    },
    ["Monday", "Tuesday"],
    "08:00",
    "17:00"
  );
  assert.deepEqual(
    explicitEmptyMondaySchedule.weeklyShifts.Monday,
    [],
    "Explicitly empty weeklyShifts.Monday = [] must stay 0 shifts and never synthesize a fallback shift"
  );
  assert.equal(explicitEmptyMondaySchedule.weeklyShifts.Tuesday.length, 1);

  // Tier 1: duty_days is explicitly empty [] -> all 7 days have 0 shifts even if weeklyShifts had stale data
  const tier1EmptyDays = parseDoctorSchedule(
    {
      weeklyShifts: {
        Monday: [{ id: "m1", label: "Morning Shift", startTime: "08:00", endTime: "12:00" }],
      },
    },
    [],
    "08:00",
    "17:00"
  );
  ALL_DAYS_OF_WEEK.forEach((d) => {
    assert.deepEqual(tier1EmptyDays.weeklyShifts[d], [], `Tier 1 empty duty_days must clear ${d}`);
  });

  // Tier 4A: Legacy row with duty_days = ["Monday", "Wednesday"], duty_schedule = null -> synthesizes fallback shifts
  const tier4ALegacy = parseDoctorSchedule(null, ["Monday", "Wednesday"], "09:00", "16:00");
  assert.equal(tier4ALegacy.weeklyShifts.Monday.length, 1);
  assert.equal(tier4ALegacy.weeklyShifts.Monday[0].startTime, "09:00");
  assert.equal(tier4ALegacy.weeklyShifts.Monday[0].endTime, "16:00");
  assert.equal(tier4ALegacy.weeklyShifts.Tuesday.length, 0);
  assert.equal(tier4ALegacy.weeklyShifts.Wednesday.length, 1);

  // Assigned schedule parser ignores registration-only rows without duty_schedule JSONB
  assert.equal(
    parseAssignedDoctorSchedule({
      duty_days: ["Friday"],
      duty_schedule: null,
      duty_start_time: "13:00",
      duty_end_time: "17:00",
    }),
    null
  );

  console.log("✓ 2. 4-tier duty_days / duty_schedule precedence rule preserves explicitly empty weekdays and legacy schedules.");
}

// ── 3. Full Appointment Duration Validation (e.g. 4:45 PM vs 5:00 PM shift end with 30m duration) ──
{
  const doctorWith5PmEnd = {
    id: "doc-duration-test",
    name: "Dr. Elena Cruz",
    status: "Active",
    duty_days: ["Monday"],
    duty_schedule: serializeDoctorSchedule(
      {
        weeklyShifts: {
          Monday: [
            {
              id: "mon-1",
              label: "Afternoon Shift",
              startTime: "13:00",
              endTime: "17:00",
              slotIntervalMinutes: 30,
            },
          ],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: [],
        },
        slotIntervalMinutes: 30,
        isCustomSchedule: true,
      },
      ["Monday"]
    ),
  };

  // 4:30 PM (16:30) appointment with 30m duration ends at 5:00 PM (17:00) -> FITS!
  const valid430 = validateDoctorReassignment({
    doctorId: doctorWith5PmEnd.id,
    doctor: doctorWith5PmEnd,
    appointmentDate: "2026-11-30", // Monday
    appointmentTime: "16:30",
    existingAppointments: [],
    clinicDefaults: {
      defaultSlotIntervalMinutes: 30,
      openTime: "08:00",
      closeTime: "18:00",
      operatingDays: "Monday - Saturday",
    },
  });
  assert.equal(valid430.isAvailable, true, "4:30 PM appointment with 30m duration fits in 1:00 PM–5:00 PM shift");

  // 4:45 PM (16:45) appointment with 30m duration ends at 5:15 PM (17:15) -> MUST BE REJECTED!
  const invalid445 = validateDoctorReassignment({
    doctorId: doctorWith5PmEnd.id,
    doctor: doctorWith5PmEnd,
    appointmentDate: "2026-11-30", // Monday
    appointmentTime: "16:45",
    existingAppointments: [],
    clinicDefaults: {
      defaultSlotIntervalMinutes: 30,
      openTime: "08:00",
      closeTime: "18:00",
      operatingDays: "Monday - Saturday",
    },
  });
  assert.equal(
    invalid445.isAvailable,
    false,
    "4:45 PM appointment with 30m duration must be rejected against a 5:00 PM shift end"
  );

  // Also test findConflictingAppointmentsForDoctorSchedule when doctor shortens Monday shift from 5:00 PM to 4:45 PM
  // while an active 4:30 PM (30-min) appointment exists
  const referenceNowMs = new Date("2026-11-23T01:00:00Z").getTime(); // Nov 23, 2026 09:00 AM Manila
  const existing430Appt = [
    {
      appointment_id: "appt-430",
      date: "2026-11-30T16:30:00+08:00",
      time: "4:30 PM",
      status: "confirmed",
      payment_status: "paid",
      patient_name: "Juan Dela Cruz",
    },
  ];

  // Proposed schedule ending at 16:45 leaves the 16:30–17:00 appointment hanging by 15 minutes -> CONFLICT!
  const shortenedConflicts = findConflictingAppointmentsForDoctorSchedule(
    existing430Appt,
    {
      dutyDays: ["Monday"],
      weeklyShifts: {
        Monday: [
          {
            id: "mon-short",
            label: "Afternoon Shift",
            startTime: "13:00",
            endTime: "16:45",
            slotIntervalMinutes: 30,
          },
        ],
      },
      slotIntervalMinutes: 30,
    },
    { defaultSlotIntervalMinutes: 30 },
    referenceNowMs
  );
  assert.equal(
    shortenedConflicts.length,
    1,
    "Shortening shift to 4:45 PM must flag conflict with existing 4:30 PM 30-minute appointment"
  );

  // Proposed schedule ending at 17:00 fits the 16:30–17:00 appointment -> NO CONFLICT!
  const fittingConflicts = findConflictingAppointmentsForDoctorSchedule(
    existing430Appt,
    {
      dutyDays: ["Monday"],
      weeklyShifts: {
        Monday: [
          {
            id: "mon-fit",
            label: "Afternoon Shift",
            startTime: "13:00",
            endTime: "17:00",
            slotIntervalMinutes: 30,
          },
        ],
      },
      slotIntervalMinutes: 30,
    },
    { defaultSlotIntervalMinutes: 30 },
    referenceNowMs
  );
  assert.equal(fittingConflicts.length, 0);

  console.log("✓ 3. Full appointment duration (start + effective_interval <= shift_end) is strictly enforced.");
}

// ── 4. Active Appointment & Unexpired Payment Hold Protection (Including 12h AM/PM & 24h Formats) ──
{
  const refNowMs = new Date("2026-11-23T01:00:00Z").getTime(); // Monday Nov 23, 2026 09:00 AM Manila

  // Active unexpired payment hold at 2:00 PM on Tuesday Nov 24, 2026
  const unexpiredHold = {
    appointment_id: "hold-active-1",
    date: "2026-11-24T14:00:00+08:00",
    time: "2:00 PM",
    status: "pending",
    payment_status: "pending_hold",
    payment_hold_expires_at: new Date(refNowMs + 8 * 60 * 1000).toISOString(),
  };

  // Expired abandoned hold at 3:00 PM on Wednesday Nov 25, 2026
  const expiredHold = {
    appointment_id: "hold-expired-1",
    date: "2026-11-25T15:00:00+08:00",
    time: "15:00:00",
    status: "pending",
    payment_status: "pending_hold",
    payment_hold_expires_at: new Date(refNowMs - 5 * 60 * 1000).toISOString(),
    payment_reference: "SIM-HOLD-20261123-ABCD",
  };

  // Removing Tuesday & Wednesday from schedule:
  // Must block because of Tuesday's active unexpired hold, but ignore Wednesday's expired hold!
  const holdConflicts = findConflictingAppointmentsForDoctorSchedule(
    [unexpiredHold, expiredHold],
    {
      dutyDays: ["Monday"],
      weeklyShifts: {
        Monday: [{ id: "m1", label: "Morning", startTime: "08:00", endTime: "12:00" }],
      },
      slotIntervalMinutes: 30,
    },
    { defaultSlotIntervalMinutes: 30 },
    refNowMs
  );

  assert.equal(holdConflicts.length, 1);
  assert.equal(holdConflicts[0].appointmentId, "hold-active-1");
  assert.equal(holdConflicts[0].dayOfWeek, "Tuesday");
  assert.equal(holdConflicts[0].formattedTime, "2:00 PM");

  // Time parser handles all stored formats
  assert.equal(parseAppointmentTimeMinutes("08:30"), 510);
  assert.equal(parseAppointmentTimeMinutes("14:30:00"), 870);
  assert.equal(parseAppointmentTimeMinutes("2:30 PM"), 870);
  assert.equal(parseAppointmentTimeMinutes("12:00 AM"), 0);
  assert.equal(parseAppointmentTimeMinutes("12:00 PM"), 720);

  console.log("✓ 4. Existing confirmed/pending appointments and unexpired payment holds are protected across 12h and 24h formats.");
}

// ── 5. Public Booking Real-Time Availability & Slot Generation Synchronization ──
{
  const updatedSchedule: DoctorWeeklySchedule = {
    weeklyShifts: {
      Monday: [{ id: "m1", label: "Morning Shift", startTime: "08:00", endTime: "12:00" }],
      Tuesday: [{ id: "t1", label: "Afternoon Shift", startTime: "13:00", endTime: "20:00" }],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [{ id: "s1", label: "Sunday Shift", startTime: "08:00", endTime: "17:00" }],
    },
    slotIntervalMinutes: 30,
    isCustomSchedule: true,
  };

  const doctorRecord = {
    id: "doc-skin-clinic",
    name: "Dr. Camille Reyes",
    status: "Active",
    dutyDays: ["Monday", "Tuesday", "Sunday"],
    dutySchedule: serializeDoctorSchedule(updatedSchedule, ["Monday", "Tuesday", "Sunday"]),
    weeklySchedule: updatedSchedule,
  };

  const clinicConfig = {
    openTime: "08:00",
    closeTime: "20:00",
    operatingDays: "Monday - Sunday",
    defaultSlotIntervalMinutes: 30,
  };

  assert.equal(isDoctorOnDutyOnDay(doctorRecord, "Monday", clinicConfig), true);
  assert.equal(isDoctorOnDutyOnDay(doctorRecord, "Tuesday", clinicConfig), true);
  assert.equal(isDoctorOnDutyOnDay(doctorRecord, "Wednesday", clinicConfig), false);
  assert.equal(isDoctorOnDutyOnDay(doctorRecord, "Sunday", clinicConfig), true);

  // Monday slots: 8:00 AM to 12:00 PM at 30m intervals = 8 slots (last slot 11:30 AM – 12:00 PM)
  const mondayShiftGroups = generateDaySlotsForDoctor({
    doctorId: doctorRecord.id,
    doctorSchedule: updatedSchedule,
    dayOfWeek: "Monday",
    existingAppointments: [],
    clinicDefaults: clinicConfig,
  });
  const mondayAllSlots = mondayShiftGroups.flatMap((g) => g.slots);
  assert.equal(mondayAllSlots.length, 8);
  assert.equal(mondayAllSlots[0].slotTime, "08:00");
  assert.equal(mondayAllSlots[7].slotTime, "11:30");

  // Wednesday slots (removed duty day): 0 slots
  const wednesdayShiftGroups = generateDaySlotsForDoctor({
    doctorId: doctorRecord.id,
    doctorSchedule: updatedSchedule,
    dayOfWeek: "Wednesday",
    existingAppointments: [],
    clinicDefaults: clinicConfig,
  });
  assert.equal(wednesdayShiftGroups.length, 0);

  // Live On-Duty status check on Tuesday at 2:30 PM Manila vs 10:00 AM Manila
  const tuesday230PmUtc = new Date("2026-11-24T06:30:00Z").getTime(); // 14:30 Manila
  const tuesday10AmUtc = new Date("2026-11-24T02:00:00Z").getTime(); // 10:00 Manila
  assert.equal(
    isDoctorCurrentlyOnDuty({
      doctor: doctorRecord,
      clinicSchedule: clinicConfig,
      currentTimeMs: tuesday230PmUtc,
    }).isOnDuty,
    true
  );
  assert.equal(
    isDoctorCurrentlyOnDuty({
      doctor: doctorRecord,
      clinicSchedule: clinicConfig,
      currentTimeMs: tuesday10AmUtc,
    }).isOnDuty,
    false
  );

  console.log("✓ 5. Public appointment booking slots and on-duty badges synchronize accurately with doctor schedule updates.");
}

// ── 6. Authorized RPC Execution & Simultaneous Doctor / Clinic Admin Update Handling ──
await (async () => {
  const rpcCalls: any[] = [];
  const mockSupabase: any = {
    rpc: async (fnName: string, args: any) => {
      rpcCalls.push({ fnName, args });
      if (fnName === "get_owned_doctor_other_shifts") {
        return { data: [], error: null };
      }
      if (fnName === "save_authorized_doctor_duty_schedule") {
        return {
          data: {
            success: true,
            doctor_id: args.p_doctor_id,
            clinic_id: args.p_clinic_id,
            duty_days: args.p_duty_days,
            duty_schedule: args.p_duty_schedule,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              neq: () => ({
                neq: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  };

  // Doctor self-service update
  const doctorSaveRes = await saveAuthorizedDoctorDutySchedule({
    client: mockSupabase,
    doctorId: "doc-uuid-1",
    clinicId: "clinic-uuid-1",
    clinicName: "Skin Clinic",
    doctorName: "Dr. Camille Reyes",
    userId: "user-uuid-1",
    actorRole: "doctor",
    dutyDays: ["Monday", "Tuesday"],
    weeklyShifts: {
      Monday: [{ id: "m1", label: "Morning Shift", startTime: "08:00", endTime: "12:00" }],
      Tuesday: [{ id: "t1", label: "Afternoon Shift", startTime: "13:00", endTime: "17:00" }],
    },
    slotIntervalMinutes: 30,
    clinicOpenTime: "08:00",
    clinicCloseTime: "20:00",
    clinicOperatingDays: "Monday - Saturday",
  });

  assert.equal(doctorSaveRes.isOffDuty, false);
  assert.deepEqual(doctorSaveRes.dutyDays, ["Monday", "Tuesday"]);

  // Clinic Admin update on the same doctor also goes through save_authorized_doctor_duty_schedule RPC
  const adminSaveRes = await saveAuthorizedDoctorDutySchedule({
    client: mockSupabase,
    doctorId: "doc-uuid-1",
    clinicId: "clinic-uuid-1",
    clinicName: "Skin Clinic",
    doctorName: "Dr. Camille Reyes",
    userId: "clinic-owner-uuid",
    actorRole: "clinic",
    dutyDays: [],
    weeklyShifts: {},
    slotIntervalMinutes: 30,
    clinicOpenTime: "08:00",
    clinicCloseTime: "20:00",
    clinicOperatingDays: "Monday - Saturday",
  });

  assert.equal(adminSaveRes.isOffDuty, true);
  assert.deepEqual(adminSaveRes.dutyDays, []);

  const saveRpcCalls = rpcCalls.filter((c) => c.fnName === "save_authorized_doctor_duty_schedule");
  assert.equal(
    saveRpcCalls.length,
    2,
    "Both Doctor self-service and Clinic Admin schedule updates must execute through save_authorized_doctor_duty_schedule RPC"
  );

  console.log("✓ 6. Both Doctor and Clinic Admin schedule saves route through save_authorized_doctor_duty_schedule RPC.");
})();

console.log("\nALL DOCTOR SELF-SERVICE DUTY SCHEDULE TESTS PASSED SUCCESSFULLY!");
