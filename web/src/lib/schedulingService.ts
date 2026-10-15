// ============================================================================
// DermAI — Unified Scheduling Service & Source of Truth
// Standardized scheduling logic for Clinic Settings, Doctor Shifts, and Patient Booking
// ============================================================================

export interface DoctorShift {
  id: string;                  // Unique shift ID within doctor (e.g. "shift-mon-1")
  label: string;               // e.g. "Morning Shift", "Afternoon Shift"
  startTime: string;           // "08:00" (HH:mm in 24h format)
  endTime: string;             // "12:00" (HH:mm in 24h format)
  slotIntervalMinutes?: number;// Optional shift-specific override
  maxPatientsPerShift?: number;// Optional shift-specific capacity override
  breaks?: { startTime: string; endTime: string }[]; // Optional break periods
}

export interface DoctorWeeklySchedule {
  // Doctor-level overrides (if undefined/null, inherits clinic default)
  slotIntervalMinutes?: number;
  maxPatientsPerShift?: number;

  // Working shifts by day: key is full day name ("Monday", "Tuesday", etc.)
  weeklyShifts: Record<string, DoctorShift[]>;

  // Legacy uniform flag
  isCustomSchedule?: boolean;
}

export interface ClinicOperatingSchedule {
  openTime: string;                   // e.g. "08:00"
  closeTime: string;                  // e.g. "21:00" (9:00 PM)
  operatingDays: string;              // e.g. "Monday - Saturday"
  defaultSlotIntervalMinutes: number; // e.g. 30
  defaultMaxPatientsPerShift: number; // e.g. 10
}

export interface ConsultationSlot {
  shiftId: string;
  shiftLabel: string;
  slotIndex: number;
  slotTime: string;       // "08:00"
  endTime: string;        // "08:45"
  timeRange: string;      // "8:00 AM – 8:45 AM"
  label: string;          // "8:00 AM"
  durationMinutes: number;// 45
  isBooked: boolean;
  isPast: boolean;
  isCapacityFull: boolean;
  isAvailable: boolean;
}

export interface EffectiveShiftSettings {
  interval: number;
  intervalSource: "shift" | "doctor" | "clinic";
  capacity: number;
  capacitySource: "shift" | "doctor" | "clinic";
  possibleSlots: number;
  effectiveCapacity: number; // min(possibleSlots, capacity)
}

export const ALL_DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type DayOfWeek = typeof ALL_DAYS_OF_WEEK[number];

/* ── Time & Day Helper Utilities ──────────────────────────────────── */

export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTime12h(time24: string): string {
  if (!time24) return "";
  const parts = time24.split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function normalizeDayName(rawDay: string): string {
  if (!rawDay) return "";
  const s = String(rawDay).trim().toLowerCase();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return rawDay.trim();
}

/* ── Dynamic Time Options Bounded by Clinic Operating Hours ────────── */

/**
 * Generates selectable time options strictly bounded by the clinic's operating window.
 * For example, if clinic opens at 8:00 AM and closes at 9:00 PM (21:00),
 * this yields ["08:00", "08:30", ..., "21:00"].
 */
export function generateTimeOptionsForClinicHours(
  openTime = "07:30",
  closeTime = "21:00",
  stepMinutes = 30
): { value: string; label: string }[] {
  let openM = timeToMinutes(openTime);
  let closeM = timeToMinutes(closeTime);
  if (closeM <= openM) {
    closeM = Math.min(24 * 60, openM + 8 * 60);
  }
  // Ensure the options cover at least standard clinic range 07:00 to 22:00 so shifts are never cut off
  openM = Math.min(openM, 7 * 60);
  closeM = Math.max(closeM, 21 * 60 + 30);

  const options: { value: string; label: string }[] = [];
  for (let m = openM; m <= closeM; m += stepMinutes) {
    const timeStr = minutesToTime(m);
    options.push({
      value: timeStr,
      label: formatTime12h(timeStr),
    });
  }
  return options;
}

/* ── Settings Hierarchy & Inheritance ─────────────────────────────── */

/**
 * Resolves the effective appointment interval and capacity for a shift
 * following the agreed inheritance hierarchy:
 * 1. Shift explicit override
 * 2. Doctor explicit override
 * 3. Dynamic slot-based capacity (bounded by clinic operating hours and slot interval)
 */
export function getEffectiveShiftSettings(
  shift: DoctorShift,
  doctorSchedule?: DoctorWeeklySchedule | null,
  clinicDefaults?: {
    defaultSlotIntervalMinutes?: number;
    defaultMaxPatientsPerShift?: number;
    openTime?: string;
    closeTime?: string;
  } | null
): EffectiveShiftSettings {
  // 1. Slot Interval
  let interval = shift.slotIntervalMinutes;
  let intervalSource: "shift" | "doctor" | "clinic" = "shift";
  if (!interval || interval <= 0) {
    if (doctorSchedule?.slotIntervalMinutes && doctorSchedule.slotIntervalMinutes > 0) {
      interval = doctorSchedule.slotIntervalMinutes;
      intervalSource = "doctor";
    } else {
      interval = clinicDefaults?.defaultSlotIntervalMinutes || 30;
      intervalSource = "clinic";
    }
  }

  // 2. Consultation window & possible slots (bounded by clinic operating hours if provided)
  let shiftStartM = timeToMinutes(shift.startTime);
  let shiftEndM = timeToMinutes(shift.endTime);

  if (clinicDefaults?.openTime) {
    const clinicOpenM = timeToMinutes(clinicDefaults.openTime);
    shiftStartM = Math.max(shiftStartM, clinicOpenM);
  }
  if (clinicDefaults?.closeTime) {
    const clinicCloseM = timeToMinutes(clinicDefaults.closeTime);
    shiftEndM = Math.min(shiftEndM, clinicCloseM);
  }

  const possibleSlots = Math.max(0, Math.floor((shiftEndM - shiftStartM) / interval));

  // 3. Shift Capacity:
  // Capacity is determined by the available appointment times (possibleSlots).
  // If an explicit override is set on the shift or doctor, respect it (up to possibleSlots);
  // otherwise, capacity equals possibleSlots without artificial arbitrary caps.
  let capacity = possibleSlots;
  let capacitySource: "shift" | "doctor" | "clinic" = "clinic";

  if (shift.maxPatientsPerShift && shift.maxPatientsPerShift > 0) {
    capacity = Math.min(possibleSlots, shift.maxPatientsPerShift);
    capacitySource = "shift";
  } else if (doctorSchedule?.maxPatientsPerShift && doctorSchedule.maxPatientsPerShift > 0) {
    capacity = Math.min(possibleSlots, doctorSchedule.maxPatientsPerShift);
    capacitySource = "doctor";
  } else if (clinicDefaults?.defaultMaxPatientsPerShift && clinicDefaults.defaultMaxPatientsPerShift > 0) {
    capacity = Math.min(possibleSlots, clinicDefaults.defaultMaxPatientsPerShift);
    capacitySource = "clinic";
  } else {
    capacity = possibleSlots;
    capacitySource = "clinic";
  }

  const effectiveCapacity = capacity;

  return {
    interval,
    intervalSource,
    capacity,
    capacitySource,
    possibleSlots,
    effectiveCapacity,
  };
}

/**
 * Calculates the number of complete, non-overlapping appointment slots that fit
 * entirely within the shift duration.
 */
export function calculateShiftPossibleSlots(
  startTime: string,
  endTime: string,
  intervalMinutes: number
): number {
  const startM = timeToMinutes(startTime);
  const endM = timeToMinutes(endTime);
  if (endM <= startM || intervalMinutes <= 0) return 0;
  return Math.floor((endM - startM) / intervalMinutes);
}

/* ── Schedule Parser and Serializer ───────────────────────────────── */

/**
 * Safely parses any database or local storage representation of a doctor schedule
 * into the canonical DoctorWeeklySchedule format with multiple shifts support.
 */
export function parseDoctorSchedule(
  rawSchedule: any,
  rawDutyDays?: any,
  fallbackStart = "08:00",
  fallbackEnd = "17:00"
): DoctorWeeklySchedule {
  let scheduleObj: any = rawSchedule;

  if (typeof rawSchedule === "string") {
    try {
      scheduleObj = JSON.parse(rawSchedule);
    } catch {
      scheduleObj = null;
    }
  }

  // Parse duty days
  let dutyDays: string[] = [];
  if (Array.isArray(rawDutyDays)) {
    dutyDays = rawDutyDays.map(normalizeDayName).filter(Boolean);
  } else if (typeof rawDutyDays === "string" && rawDutyDays.trim()) {
    try {
      const parsed = JSON.parse(rawDutyDays);
      if (Array.isArray(parsed)) {
        dutyDays = parsed.map(normalizeDayName).filter(Boolean);
      }
    } catch {
      dutyDays = rawDutyDays
        .replace(/^\{|\}$/g, "")
        .split(",")
        .map((s) => normalizeDayName(s.replace(/["'\\]/g, "").trim()))
        .filter(Boolean);
    }
  }

  const weeklyShifts: Record<string, DoctorShift[]> = {};
  ALL_DAYS_OF_WEEK.forEach((day) => {
    weeklyShifts[day] = [];
  });

  let doctorSlotInterval: number | undefined = undefined;
  let doctorMaxPatients: number | undefined = undefined;
  let isCustom = false;

  if (scheduleObj && typeof scheduleObj === "object" && !Array.isArray(scheduleObj)) {
    if (scheduleObj.slotIntervalMinutes) doctorSlotInterval = Number(scheduleObj.slotIntervalMinutes);
    if (scheduleObj.maxPatientsPerDay) doctorMaxPatients = Number(scheduleObj.maxPatientsPerDay);
    if (scheduleObj.maxPatientsPerShift) doctorMaxPatients = Number(scheduleObj.maxPatientsPerShift);
    if (scheduleObj.isCustomSchedule !== undefined) isCustom = Boolean(scheduleObj.isCustomSchedule);

    // Case 1: scheduleObj contains a weeklyShifts map
    if (scheduleObj.weeklyShifts && typeof scheduleObj.weeklyShifts === "object") {
      Object.entries(scheduleObj.weeklyShifts).forEach(([rawDay, shifts]) => {
        const normDay = normalizeDayName(rawDay);
        if (normDay && Array.isArray(shifts)) {
          weeklyShifts[normDay] = shifts
            .filter((s: any) => s && s.startTime && s.endTime)
            .map((s: any, idx: number) => ({
              id: s.id || `shift-${normDay.toLowerCase()}-${idx + 1}`,
              label: s.label || (idx === 0 ? "Morning Shift" : idx === 1 ? "Afternoon Shift" : `Shift ${idx + 1}`),
              startTime: s.startTime,
              endTime: s.endTime,
              slotIntervalMinutes: s.slotIntervalMinutes ? Number(s.slotIntervalMinutes) : undefined,
              maxPatientsPerShift: s.maxPatientsPerShift ? Number(s.maxPatientsPerShift) : undefined,
            }));
        }
      });
    } else {
      // Case 2: Legacy single-shift format { Monday: { startTime, endTime }, ... }
      ALL_DAYS_OF_WEEK.forEach((day) => {
        const dayVal = scheduleObj[day];
        if (dayVal) {
          if (Array.isArray(dayVal)) {
            weeklyShifts[day] = dayVal.map((s: any, idx: number) => ({
              id: s.id || `shift-${day.toLowerCase()}-${idx + 1}`,
              label: s.label || (idx === 0 ? "Morning Shift" : idx === 1 ? "Afternoon Shift" : `Shift ${idx + 1}`),
              startTime: s.startTime || fallbackStart,
              endTime: s.endTime || fallbackEnd,
              slotIntervalMinutes: s.slotIntervalMinutes ? Number(s.slotIntervalMinutes) : undefined,
              maxPatientsPerShift: s.maxPatientsPerShift ? Number(s.maxPatientsPerShift) : undefined,
            }));
          } else if (typeof dayVal === "object" && dayVal.startTime && dayVal.endTime) {
            weeklyShifts[day] = [
              {
                id: `shift-${day.toLowerCase()}-1`,
                label: "Duty Shift",
                startTime: dayVal.startTime,
                endTime: dayVal.endTime,
                slotIntervalMinutes: dayVal.slotIntervalMinutes ? Number(dayVal.slotIntervalMinutes) : undefined,
                maxPatientsPerShift: dayVal.maxPatientsPerShift ? Number(dayVal.maxPatientsPerShift) : undefined,
              },
            ];
          }
        }
      });
    }
  }

  // If dutyDays was provided, strictly enforce it as the authority on active days:
  // 1. Clear any shifts on days not included in dutyDays
  // 2. Ensure each active duty day has at least one shift
  if (dutyDays.length > 0) {
    ALL_DAYS_OF_WEEK.forEach((day) => {
      if (!dutyDays.includes(day)) {
        weeklyShifts[day] = [];
      } else if (!weeklyShifts[day] || weeklyShifts[day].length === 0) {
        weeklyShifts[day] = [
          {
            id: `shift-${day.toLowerCase()}-1`,
            label: "Duty Shift",
            startTime: fallbackStart,
            endTime: fallbackEnd,
          },
        ];
      }
    });
  }

  return {
    weeklyShifts,
    slotIntervalMinutes: doctorSlotInterval,
    maxPatientsPerShift: doctorMaxPatients,
    isCustomSchedule: isCustom,
  };
}

/**
 * Serializes a DoctorWeeklySchedule for Supabase JSONB storage,
 * providing both modern multi-shift arrays and backward-compatible single shift keys.
 * If dutyDays is provided, inactive days are pruned to prevent ghost shifts.
 */
export function serializeDoctorSchedule(
  schedule: DoctorWeeklySchedule,
  dutyDays?: string[]
): Record<string, any> {
  const activeDays = (dutyDays && dutyDays.length > 0)
    ? dutyDays.map(normalizeDayName).filter(Boolean)
    : ALL_DAYS_OF_WEEK.filter((d) => schedule.weeklyShifts[d] && schedule.weeklyShifts[d].length > 0);

  const cleanWeeklyShifts: Record<string, DoctorShift[]> = {};
  ALL_DAYS_OF_WEEK.forEach((day) => {
    cleanWeeklyShifts[day] = activeDays.includes(day) ? (schedule.weeklyShifts[day] || []) : [];
  });

  const payload: Record<string, any> = {
    weeklyShifts: cleanWeeklyShifts,
    slotIntervalMinutes: schedule.slotIntervalMinutes,
    maxPatientsPerShift: schedule.maxPatientsPerShift,
    maxPatientsPerDay: schedule.maxPatientsPerShift, // Backward compatibility
    isCustomSchedule: schedule.isCustomSchedule ?? true,
  };

  // Populate legacy day keys with the first shift of each day ONLY for active days
  activeDays.forEach((day) => {
    const shifts = cleanWeeklyShifts[day];
    if (shifts && shifts.length > 0) {
      payload[day] = {
        startTime: shifts[0].startTime,
        endTime: shifts[0].endTime,
        slotIntervalMinutes: shifts[0].slotIntervalMinutes || schedule.slotIntervalMinutes,
        maxPatientsPerShift: shifts[0].maxPatientsPerShift || schedule.maxPatientsPerShift,
      };
    }
  });

  return payload;
}

/* ── Shift Validation ─────────────────────────────────────────────── */

export interface ShiftValidationError {
  day: string;
  shiftIndex: number;
  message: string;
}

/**
 * Validates shifts for a doctor:
 * 1. Start time must be earlier than End time.
 * 2. Shift must fit completely within clinic operating hours.
 * 3. Shifts on the same day cannot overlap.
 */
export function validateDoctorShifts(
  shifts: DoctorShift[],
  day: string,
  clinicOpenTime = "07:30",
  clinicCloseTime = "21:00"
): ShiftValidationError[] {
  const errors: ShiftValidationError[] = [];
  const rawOpenM = timeToMinutes(clinicOpenTime);
  const rawCloseM = timeToMinutes(clinicCloseTime);
  // Allow doctors to work anywhere within the extended clinic service envelope
  const clinicOpenM = Math.min(rawOpenM, 7 * 60);
  const clinicCloseM = Math.max(rawCloseM, 21 * 60 + 30);

  shifts.forEach((shift, idx) => {
    const startM = timeToMinutes(shift.startTime);
    const endM = timeToMinutes(shift.endTime);

    if (endM <= startM) {
      errors.push({
        day,
        shiftIndex: idx,
        message: `On ${day}, ${shift.label || `Shift ${idx + 1}`} end time (${formatTime12h(shift.endTime)}) must be later than start time (${formatTime12h(shift.startTime)}).`,
      });
      return;
    }

    if (startM < clinicOpenM || endM > clinicCloseM) {
      errors.push({
        day,
        shiftIndex: idx,
        message: `On ${day}, ${shift.label || `Shift ${idx + 1}`} (${formatTime12h(shift.startTime)} – ${formatTime12h(shift.endTime)}) must fit within clinic hours (${formatTime12h(minutesToTime(clinicOpenM))} – ${formatTime12h(minutesToTime(clinicCloseM))}).`,
      });
    }
  });

  // Check pairwise overlapping shifts on the same day
  for (let i = 0; i < shifts.length; i++) {
    const s1 = shifts[i];
    const s1Start = timeToMinutes(s1.startTime);
    const s1End = timeToMinutes(s1.endTime);

    for (let j = i + 1; j < shifts.length; j++) {
      const s2 = shifts[j];
      const s2Start = timeToMinutes(s2.startTime);
      const s2End = timeToMinutes(s2.endTime);

      // Overlap condition: start < otherEnd && end > otherStart
      if (s1Start < s2End && s1End > s2Start) {
        errors.push({
          day,
          shiftIndex: j,
          message: `On ${day}, ${s1.label} (${s1.startTime}–${s1.endTime}) overlaps with ${s2.label} (${s2.startTime}–${s2.endTime}). Same doctor shifts cannot overlap.`,
        });
      }
    }
  }

  return errors;
}

/* ── Complete Slot Generation Engine ───────────────────────────────── */

export interface GenerateShiftSlotsParams {
  shift: DoctorShift;
  doctorSchedule?: DoctorWeeklySchedule | null;
  clinicDefaults?: {
    defaultSlotIntervalMinutes?: number;
    defaultMaxPatientsPerShift?: number;
    openTime?: string;
    closeTime?: string;
  } | null;
  doctorId?: string;
  activeAppointments?: any[];
  isToday?: boolean;
  currentMinutesNow?: number;
}

/**
 * Generates all valid consecutive consultation slots for a specific doctor shift.
 */
export function generateSlotsForShift({
  shift,
  doctorSchedule,
  clinicDefaults,
  doctorId,
  activeAppointments = [],
  isToday = false,
  currentMinutesNow = 0,
}: GenerateShiftSlotsParams): {
  slots: ConsultationSlot[];
  totalBookedInShift: number;
  remainingShiftCapacity: number;
  isShiftCapacityReached: boolean;
  effectiveSettings: EffectiveShiftSettings;
} {
  const effectiveSettings = getEffectiveShiftSettings(shift, doctorSchedule, clinicDefaults);
  const { interval, capacity } = effectiveSettings;

  let startMin = timeToMinutes(shift.startTime);
  let endMin = timeToMinutes(shift.endTime);

  // Bound slot window by clinic operating hours if provided in clinicDefaults
  if (clinicDefaults?.openTime) {
    const clinicOpenM = timeToMinutes(clinicDefaults.openTime);
    startMin = Math.max(startMin, clinicOpenM);
  }
  if (clinicDefaults?.closeTime) {
    const clinicCloseM = timeToMinutes(clinicDefaults.closeTime);
    endMin = Math.min(endMin, clinicCloseM);
  }

  // Filter active appointments that belong to this shift and this doctor
  const activeBookingsInShift = activeAppointments.filter((appt) => {
    const st = String(appt.status || "").toLowerCase().trim();
    if (st === "cancelled" || st === "rejected" || st === "declined") return false;

    // Doctor match
    if (doctorId && appt.assigned_doctor_id && String(appt.assigned_doctor_id) !== String(doctorId)) {
      return false;
    }

    // Time inside this shift bounds: [startMin, endMin)
    const rawTime = (appt.time || appt.batch_time || "").slice(0, 5);
    const apptMin = timeToMinutes(rawTime);
    return apptMin >= startMin && apptMin < endMin;
  });

  const totalBookedInShift = activeBookingsInShift.length;
  const remainingShiftCapacity = Math.max(0, capacity - totalBookedInShift);
  const isShiftCapacityReached = totalBookedInShift >= capacity;

  const slots: ConsultationSlot[] = [];
  let currentMin = startMin;
  let slotIndex = 1;

  while (currentMin + interval <= endMin) {
    const slotStart = currentMin;
    const slotEnd = currentMin + interval;
    const slotTimeStr = minutesToTime(slotStart);
    const endTimeStr = minutesToTime(slotEnd);
    const timeRange = `${formatTime12h(slotTimeStr)} – ${formatTime12h(endTimeStr)}`;
    const label = formatTime12h(slotTimeStr);

    const isPast = isToday && slotStart <= currentMinutesNow;

    const isBooked = activeBookingsInShift.some((appt) => {
      const bTime = (appt.time || appt.batch_time || "").slice(0, 5);
      return bTime === slotTimeStr;
    });

    const isCapacityFull = isShiftCapacityReached;
    const isAvailable = !isBooked && !isPast && !isCapacityFull;

    slots.push({
      shiftId: shift.id,
      shiftLabel: shift.label,
      slotIndex,
      slotTime: slotTimeStr,
      endTime: endTimeStr,
      timeRange,
      label,
      durationMinutes: interval,
      isBooked,
      isPast,
      isCapacityFull,
      isAvailable,
    });

    currentMin += interval;
    slotIndex++;
  }

  return {
    slots,
    totalBookedInShift,
    remainingShiftCapacity,
    isShiftCapacityReached,
    effectiveSettings,
  };
}

export interface DayShiftSlotsGroup {
  shift: DoctorShift;
  effectiveSettings: EffectiveShiftSettings;
  totalBooked: number;
  remainingCapacity: number;
  isCapacityReached: boolean;
  slots: ConsultationSlot[];
}

/**
 * Generates all shifts and their slots for a doctor on a specific day of the week.
 */
export function generateDaySlotsForDoctor({
  doctorSchedule,
  dayOfWeek,
  doctorId,
  clinicDefaults,
  existingAppointments = [],
  isToday = false,
  currentMinutesNow = 0,
}: {
  doctorSchedule: DoctorWeeklySchedule;
  dayOfWeek: string;
  doctorId?: string;
  clinicDefaults?: {
    defaultSlotIntervalMinutes?: number;
    defaultMaxPatientsPerShift?: number;
    openTime?: string;
    closeTime?: string;
  } | null;
  existingAppointments?: any[];
  isToday?: boolean;
  currentMinutesNow?: number;
}): DayShiftSlotsGroup[] {
  const normDay = normalizeDayName(dayOfWeek);
  const shiftsForDay = doctorSchedule.weeklyShifts[normDay] || [];

  if (shiftsForDay.length === 0) {
    return [];
  }

  return shiftsForDay.map((shift) => {
    const res = generateSlotsForShift({
      shift,
      doctorSchedule,
      clinicDefaults,
      doctorId,
      activeAppointments: existingAppointments,
      isToday,
      currentMinutesNow,
    });

    return {
      shift,
      effectiveSettings: res.effectiveSettings,
      totalBooked: res.totalBookedInShift,
      remainingCapacity: res.remainingShiftCapacity,
      isCapacityReached: res.isShiftCapacityReached,
      slots: res.slots,
    };
  });
}

/* ── Doctor Reassignment & Schedule Validation ───────────────────── */

export interface DoctorReassignmentValidation {
  isAvailable: boolean;
  reason?: string;
  matchedShift?: DoctorShift;
}

export interface AppointmentHistoryEntry {
  action:
    | "created"
    | "doctor_assigned"
    | "doctor_reviewed"
    | "doctor_reassigned"
    | "doctor_approved"
    | "doctor_rejected"
    | "reschedule_requested"
    | "reschedule_accepted"
    | "reschedule_declined"
    | "reschedule_withdrawn"
    | "patient_reschedule_needed"
    | "cancelled"
    | "completed";
  actor?: string; // "patient" | "clinic" | "doctor" | name
  timestamp: string;
  date?: string;
  time?: string;
  requestedDate?: string;
  requestedTime?: string;
  doctorId?: string;
  doctorName?: string;
  previousDoctorId?: string;
  previousDoctorName?: string;
  newDoctorId?: string;
  newDoctorName?: string;
  previousDate?: string;
  previousTime?: string;
  newDate?: string;
  newTime?: string;
  reason?: string;
  notes?: string;
  primaryScanId?: string;
}

/**
 * Validates whether a replacement doctor can take an appointment at the specified date & time:
 * 1. Checks doctor-clinic association & active status.
 * 2. Checks doctor's schedule on the appointment's day of week (must have a shift covering the slot).
 * 3. Checks slot conflicts (replacement doctor does not already have an active appointment at that time).
 * 4. Checks shift capacity (the shift has not reached its max capacity).
 */
export function validateDoctorReassignment({
  doctorId,
  targetClinicId,
  appointmentDate,
  appointmentTime,
  doctor,
  existingAppointments = [],
  clinicDefaults,
}: {
  doctorId: string;
  targetClinicId?: string;
  appointmentDate: string; // "YYYY-MM-DD" or Date parseable
  appointmentTime: string; // "HH:mm" or "HH:mm:ss" or 12h
  doctor: any;
  existingAppointments?: any[];
  clinicDefaults?: {
    defaultSlotIntervalMinutes?: number;
    defaultMaxPatientsPerShift?: number;
    openTime?: string;
    closeTime?: string;
  } | null;
}): DoctorReassignmentValidation {
  if (!doctor) {
    return { isAvailable: false, reason: "Doctor record not found." };
  }

  // 1. Check doctor-clinic association & active status
  const docClinicId = doctor.clinic_id || doctor.clinicId;
  if (docClinicId && targetClinicId && String(docClinicId) !== String(targetClinicId)) {
    return { isAvailable: false, reason: "Doctor is not registered with this clinic." };
  }

  if (doctor.status && String(doctor.status).toLowerCase() === "inactive") {
    return { isAvailable: false, reason: "Doctor is currently marked as Inactive." };
  }

  // Parse appointment date to day of week
  const dateObj = new Date(appointmentDate);
  if (isNaN(dateObj.getTime())) {
    return { isAvailable: false, reason: "Invalid appointment date." };
  }
  const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });
  const normDay = normalizeDayName(dayName);

  // Normalize appointment time to 24h HH:mm
  let cleanTime = (appointmentTime || "").trim();
  if (cleanTime.toLowerCase().includes("am") || cleanTime.toLowerCase().includes("pm")) {
    const match = cleanTime.match(/(\d+):(\d+)\s*(am|pm)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = match[2];
      const isPm = match[3].toLowerCase() === "pm";
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      cleanTime = `${String(h).padStart(2, "0")}:${m}`;
    }
  } else {
    cleanTime = cleanTime.slice(0, 5);
  }
  const apptMinutes = timeToMinutes(cleanTime);

  // 2. Schedule availability check
  const schedule: DoctorWeeklySchedule =
    doctor.weeklySchedule ||
    parseDoctorSchedule(
      doctor.duty_schedule || doctor.dutySchedule || doctor.schedule,
      doctor.duty_days || doctor.dutyDays,
      doctor.duty_start_time || doctor.dutyStartTime,
      doctor.duty_end_time || doctor.dutyEndTime
    );

  const shiftsForDay = schedule.weeklyShifts[normDay] || [];
  if (shiftsForDay.length === 0) {
    return { isAvailable: false, reason: `Not scheduled on duty on ${normDay}s.` };
  }

  // Find shift covering this appointment time
  const matchedShift = shiftsForDay.find((shift) => {
    const sStart = timeToMinutes(shift.startTime);
    const sEnd = timeToMinutes(shift.endTime);
    return apptMinutes >= sStart && apptMinutes < sEnd;
  });

  if (!matchedShift) {
    const shiftTimes = shiftsForDay
      .map((s) => `${formatTime12h(s.startTime)}–${formatTime12h(s.endTime)}`)
      .join(", ");
    return {
      isAvailable: false,
      reason: `Outside scheduled shift hours on ${normDay} (${shiftTimes}).`,
    };
  }

  // 3. Slot conflict check: does this doctor already have an appointment on this date & time?
  const dateStringYmd = appointmentDate.split("T")[0];
  const hasConflict = existingAppointments.some((appt) => {
    const apptStatus = String(appt.status || "").toLowerCase().trim();
    if (apptStatus === "cancelled" || apptStatus === "rejected" || apptStatus === "declined") {
      return false;
    }
    const apptDocId =
      appt.assigned_doctor_id || appt.assignedDoctorId || appt.doctor_id || appt.doctorId;
    if (String(apptDocId) !== String(doctorId)) {
      return false;
    }

    const apptDateStr = String(appt.date || "").split("T")[0];
    if (apptDateStr !== dateStringYmd) {
      return false;
    }

    const existingTime = (appt.time || appt.batch_time || appt.batchTime || "").slice(0, 5);
    return existingTime === cleanTime;
  });

  if (hasConflict) {
    return {
      isAvailable: false,
      reason: `Already has an appointment booked at ${formatTime12h(cleanTime)} on this date.`,
    };
  }

  // 4. Shift capacity check
  const shiftRes = generateSlotsForShift({
    shift: matchedShift,
    doctorSchedule: schedule,
    clinicDefaults,
    doctorId,
    activeAppointments: existingAppointments.filter((a) => {
      const aDate = String(a.date || "").split("T")[0];
      return aDate === dateStringYmd;
    }),
  });

  if (shiftRes.isShiftCapacityReached) {
    return {
      isAvailable: false,
      reason: `Shift capacity (${shiftRes.effectiveSettings.capacity} patients) reached for this day.`,
    };
  }

  return { isAvailable: true, matchedShift };
}

/**
 * Categorizes a list of clinic doctors into available vs unavailable for a specific slot.
 */
export function findAvailableDoctorsForSlot({
  doctors,
  targetClinicId,
  appointmentDate,
  appointmentTime,
  existingAppointments = [],
  clinicDefaults,
  excludeDoctorId,
}: {
  doctors: any[];
  targetClinicId?: string;
  appointmentDate: string;
  appointmentTime: string;
  existingAppointments?: any[];
  clinicDefaults?: { defaultSlotIntervalMinutes?: number; defaultMaxPatientsPerShift?: number } | null;
  excludeDoctorId?: string;
}): {
  availableDoctors: { doctor: any; matchedShift: DoctorShift }[];
  unavailableDoctors: { doctor: any; reason: string }[];
} {
  const availableDoctors: { doctor: any; matchedShift: DoctorShift }[] = [];
  const unavailableDoctors: { doctor: any; reason: string }[] = [];

  doctors.forEach((doc) => {
    const docId = doc.id || doc.doctor_id;
    if (excludeDoctorId && String(docId) === String(excludeDoctorId)) {
      unavailableDoctors.push({
        doctor: doc,
        reason: "Previously rejected this appointment.",
      });
      return;
    }

    const res = validateDoctorReassignment({
      doctorId: docId,
      targetClinicId,
      appointmentDate,
      appointmentTime,
      doctor: doc,
      existingAppointments,
      clinicDefaults,
    });

    if (res.isAvailable && res.matchedShift) {
      availableDoctors.push({ doctor: doc, matchedShift: res.matchedShift });
    } else {
      unavailableDoctors.push({ doctor: doc, reason: res.reason || "Unavailable" });
    }
  });

  return { availableDoctors, unavailableDoctors };
}

/* ── Organized Daily Queue Management Engine ──────────────────────── */

/**
 * Returns the calendar date key (YYYY-MM-DD) evaluated in the clinic's timezone (Asia/Manila, UTC+8).
 * Ensures daily queue numbering resets strictly at midnight Manila calendar day rather than rolling 24 hours.
 */
export function getManilaCalendarDate(dateInput?: Date | string | number | null): string {
  if (!dateInput) return "";
  try {
    if (typeof dateInput === "string") {
      const cleanStr = dateInput.split("·")[0].trim();

      // Check YYYY-MM-DD
      const matchYmd = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (matchYmd) {
        if (cleanStr.includes("T") || cleanStr.includes("Z")) {
          const d = new Date(cleanStr);
          if (!isNaN(d.getTime())) {
            const parts = new Intl.DateTimeFormat("en-US", {
              timeZone: "Asia/Manila",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(d);
            const lookup: Record<string, string> = {};
            for (const p of parts) {
              if (p.type !== "literal") lookup[p.type] = p.value;
            }
            return `${lookup.year}-${lookup.month}-${lookup.day}`;
          }
        }
        return `${matchYmd[1]}-${matchYmd[2]}-${matchYmd[3]}`;
      }

      // Check "Oct 13, 2026" or "October 13, 2026"
      const monthNames: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        january: "01", february: "02", march: "03", april: "04", june: "06",
        july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
      };
      const matchNamed = cleanStr.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (matchNamed) {
        const mKey = matchNamed[1].toLowerCase();
        if (monthNames[mKey]) {
          const y = matchNamed[3];
          const m = monthNames[mKey];
          const d = String(parseInt(matchNamed[2], 10)).padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
      }

      // Check "13 Oct 2026" or "13 October 2026"
      const matchDayFirst = cleanStr.match(/^(\d{1,2})\s+([a-zA-Z]+),?\s+(\d{4})/);
      if (matchDayFirst) {
        const mKey = matchDayFirst[2].toLowerCase();
        if (monthNames[mKey]) {
          const y = matchDayFirst[3];
          const m = monthNames[mKey];
          const d = String(parseInt(matchDayFirst[1], 10)).padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
      }
    }

    const d = typeof dateInput === "object" ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const lookup: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") lookup[p.type] = p.value;
    }
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  } catch {
    return String(dateInput).slice(0, 10);
  }
}

/**
 * Resolves current date & time parts in the clinic's timezone (Asia/Manila, UTC+8).
 */
export function getManilaNowParts(): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateKey: string;
  totalMinutes: number;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }

  const year = parseInt(lookup.year, 10) || now.getFullYear();
  const month = parseInt(lookup.month, 10) || now.getMonth() + 1;
  const day = parseInt(lookup.day, 10) || now.getDate();
  let hour = parseInt(lookup.hour, 10) || 0;
  if (hour === 24) hour = 0;
  const minute = parseInt(lookup.minute, 10) || 0;

  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const totalMinutes = hour * 60 + minute;

  return { year, month, day, hour, minute, dateKey, totalMinutes };
}

/**
 * Parses any time string ("16:00", "04:00 PM", "16:00 Batch") into total minutes from midnight (0..1439).
 * Returns -1 if no valid time can be parsed.
 */
export function parseAppointmentTimeMinutes(timeStr?: string | null): number {
  if (!timeStr || timeStr === "—" || timeStr === "Schedule pending") return -1;
  const clean = timeStr.trim().replace(/\s*batch\s*/i, "").trim();

  // 12-hour AM/PM: e.g. "04:00 PM", "4:30 am", "12:00 AM"
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = parseInt(ampmMatch[2], 10);
    const isPm = ampmMatch[3].toLowerCase() === "pm";
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return h * 60 + m;
  }

  // 24-hour: e.g. "16:00", "08:30:00"
  const h24Match = clean.match(/^(\d{1,2}):(\d{2})/);
  if (h24Match) {
    const h = parseInt(h24Match[1], 10);
    const m = parseInt(h24Match[2], 10);
    return h * 60 + m;
  }

  return -1;
}

/**
 * Checks whether an appointment's scheduled date and time has already passed
 * in the clinic's local timezone (Asia/Manila, UTC+8).
 * If the appointment slot is already in the past, it is no longer eligible for consultation.
 */
export function isAppointmentPastScheduled(appt?: {
  date?: string | null;
  rawDate?: string | null;
  time?: string | null;
  batch_time?: string | null;
  batchTime?: string | null;
} | null): boolean {
  if (!appt) return false;
  const targetDateRaw = appt.rawDate || appt.date;
  if (!targetDateRaw) return false;

  const apptDateKey = getManilaCalendarDate(targetDateRaw);
  if (!apptDateKey) return false;

  const manilaNow = getManilaNowParts();

  // 1. If appointment date is strictly before today's Manila calendar date, it has elapsed
  if (apptDateKey < manilaNow.dateKey) {
    return true;
  }

  // 2. If appointment date is in the future, it has not elapsed
  if (apptDateKey > manilaNow.dateKey) {
    return false;
  }

  // 3. Appointment date is TODAY in Manila.
  // Check the scheduled consultation time.
  const rawTime = appt.time || appt.batchTime || appt.batch_time;
  let apptMinutes = parseAppointmentTimeMinutes(rawTime);

  // If time could not be parsed from time/batchTime, check if rawDate has an ISO timestamp
  if (apptMinutes < 0 && typeof targetDateRaw === "string" && (targetDateRaw.includes("T") || targetDateRaw.includes("Z"))) {
    try {
      const d = new Date(targetDateRaw);
      if (!isNaN(d.getTime())) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Manila",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(d);
        const lkup: Record<string, string> = {};
        for (const p of parts) {
          if (p.type !== "literal") lkup[p.type] = p.value;
        }
        let h = parseInt(lkup.hour, 10) || 0;
        if (h === 24) h = 0;
        const m = parseInt(lkup.minute, 10) || 0;
        apptMinutes = h * 60 + m;
      }
    } catch { }
  }

  // If time still could not be parsed, check if today's standard operating hours have ended (after 9:00 PM)
  if (apptMinutes < 0) {
    return manilaNow.totalMinutes >= 21 * 60;
  }

  // Scheduled appointment time has arrived or passed
  return manilaNow.totalMinutes >= apptMinutes;
}

/**
 * Checks whether an appointment is excluded from active consultation triage/queues
 * (such as Incoming Consultation Queue, In Review, Needs Doctor, or New Patients).
 *
 * An appointment is excluded if:
 * 1. Already marked as No-Show (checkInStatus === 'no-show' or status === 'no-show')
 * 2. Already completed (status === 'completed' || checkInStatus === 'completed')
 * 3. Already cancelled or rejected (status === 'cancelled' || status === 'rejected')
 * 4. Scheduled date and time have already passed (isAppointmentPastScheduled)
 */
export function isAppointmentExcludedFromIncomingQueue(appt?: {
  status?: string | null;
  doctorStatus?: string | null;
  checkInStatus?: string | null;
  check_in_status?: string | null;
  date?: string | null;
  rawDate?: string | null;
  time?: string | null;
  batch_time?: string | null;
  batchTime?: string | null;
} | null): boolean {
  if (!appt) return true;

  // 1. Immediately exclude No-Show appointments
  const checkIn = String(appt.checkInStatus || appt.check_in_status || "").toLowerCase().trim();
  const st = String(appt.status || "").toLowerCase().trim();
  const docSt = String(appt.doctorStatus || "").toLowerCase().trim();
  if (checkIn === "no-show" || st === "no-show" || docSt === "no-show") return true;

  // 2. Immediately exclude Completed appointments
  if (st === "completed" || checkIn === "completed") return true;

  // 3. Immediately exclude Cancelled or Rejected appointments
  if (st === "cancelled" || st === "rejected") return true;

  // 4. Immediately exclude past appointments whose scheduled date and time have elapsed
  if (isAppointmentPastScheduled(appt)) return true;

  return false;
}

/**
 * Computes the next monotonic queue number for a doctor on a specific calendar day.
 * - Resets to #1 for each new calendar day.
 * - Scoped per doctor (or clinic unassigned triage queue).
 * - Never renumbers existing appointments when another is cancelled or rejected (preserves gaps/history).
 */
export function computeNextQueueNumber(
  existingAppointments: any[],
  doctorId?: string | null,
  targetDateStr?: string
): number {
  if (!Array.isArray(existingAppointments) || existingAppointments.length === 0) {
    return 1;
  }

  const targetDateKey = targetDateStr ? getManilaCalendarDate(targetDateStr) : "";

  const sameDayAppts = existingAppointments.filter((a) => {
    if (!a) return false;
    const aDateKey = getManilaCalendarDate(a.date);
    if (targetDateKey && aDateKey !== targetDateKey) return false;

    // Doctor scope: match assigned doctor or unassigned
    if (doctorId && a.assigned_doctor_id && String(a.assigned_doctor_id) !== String(doctorId)) {
      return false;
    }
    if (doctorId && a.assignedDoctorId && String(a.assignedDoctorId) !== String(doctorId)) {
      return false;
    }

    return true;
  });

  const maxQueue = sameDayAppts.reduce((max, a) => {
    const rawQ = a.queue_number ?? a.queueNumber ?? 0;
    const q = Number(rawQ);
    return !isNaN(q) && q > max ? q : max;
  }, 0);

  return maxQueue + 1;
}

/**
 * Checks if a specific appointment slot is already booked for a doctor on a calendar day.
 * Excludes cancelled and doctor-rejected appointments.
 */
export function isSlotBookedForDoctor(
  existingAppointments: any[],
  doctorId: string | undefined | null,
  targetDateStr: string,
  timeStr: string,
  excludeAppointmentId?: string
): boolean {
  if (!Array.isArray(existingAppointments) || !targetDateStr || !timeStr) return false;

  const targetDateKey = getManilaCalendarDate(targetDateStr);
  const targetTimeClean = timeStr.trim().slice(0, 5);

  return existingAppointments.some((appt) => {
    if (!appt) return false;
    if (excludeAppointmentId && (appt.id === excludeAppointmentId || appt.appointment_id === excludeAppointmentId)) {
      return false;
    }

    const st = String(appt.status || "").toLowerCase().trim();
    if (st === "cancelled" || st === "rejected" || st === "declined") return false;
    if (appt.doctor_status === "rejected" || appt.doctorStatus === "rejected") return false;

    // Check doctor match
    const docId = appt.assigned_doctor_id || appt.assignedDoctorId;
    if (doctorId && docId && String(docId) !== String(doctorId)) {
      return false;
    }

    const apptDateKey = getManilaCalendarDate(appt.date);
    if (apptDateKey !== targetDateKey) return false;

    const rawTime = String(appt.time || appt.batch_time || "").trim().slice(0, 5);
    return rawTime === targetTimeClean;
  });
}

/**
 * Formats a queue number for human-friendly presentation (e.g. "Queue #1", "Queue #14").
 */
export function formatQueueNumber(queueNum?: number | string | null): string {
  const n = Number(queueNum);
  if (!n || isNaN(n) || n <= 0) return "Queue #1";
  return `Queue #${n}`;
}

/**
 * Formats a queue badge reference code (e.g. "#Q-001", "#Q-014").
 */
export function formatQueueCode(queueNum?: number | string | null): string {
  const n = Number(queueNum);
  if (!n || isNaN(n) || n <= 0) return "#Q-001";
  return `#Q-${String(n).padStart(3, "0")}`;
}

/**
 * Sorts a list of appointments chronologically by scheduled time and queue number.
 */
export function sortAppointmentsByDailyQueue<T extends { date?: string; time?: string; queueNumber?: number; queue_number?: number }>(
  appointments: T[]
): T[] {
  return [...appointments].sort((a, b) => {
    const dateA = getManilaCalendarDate(a.date);
    const dateB = getManilaCalendarDate(b.date);
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const timeA = timeToMinutes(String(a.time || "00:00").slice(0, 5));
    const timeB = timeToMinutes(String(b.time || "00:00").slice(0, 5));
    if (timeA !== timeB) return timeA - timeB;

    const qA = Number(a.queueNumber ?? a.queue_number ?? 0);
    const qB = Number(b.queueNumber ?? b.queue_number ?? 0);
    return qA - qB;
  });
}

