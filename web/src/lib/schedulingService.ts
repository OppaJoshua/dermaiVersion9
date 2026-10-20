// ============================================================================
// DermAI — Unified Scheduling Service & Source of Truth
// Standardized scheduling logic for Clinic Settings, Doctor Shifts, and Patient Booking
// ============================================================================

export interface DoctorShift {
  id?: string;                  // Unique shift ID within doctor (e.g. "shift-mon-1")
  shiftId?: string;             // Alternate property name for shift ID
  label?: string;               // e.g. "Morning Shift", "Afternoon Shift"
  shiftLabel?: string;          // Alternate property name for shift label
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

/**
 * Accurately parses clinic operating days strings (e.g. "Monday - Saturday", "Mon-Fri", "All Week", "Mon, Wed, Fri")
 * into a typed array of DayOfWeek without hardcoding.
 */
export function parseClinicOperatingDays(operatingDaysStr?: string | null): DayOfWeek[] {
  if (!operatingDaysStr || !operatingDaysStr.trim()) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  }

  const raw = operatingDaysStr.trim().toLowerCase();
  if (raw === "all week" || raw === "every day" || raw === "everyday" || raw === "daily" || raw === "7 days") {
    return [...ALL_DAYS_OF_WEEK];
  }

  const resultDays = new Set<DayOfWeek>();
  const segments = raw.split(/[,;/+]+/).map((s) => s.trim()).filter(Boolean);

  for (const seg of segments) {
    const rangeMatch = seg.match(/^([a-z]+)\s*(?:-|–|—|to)\s*([a-z]+)$/i);
    if (rangeMatch) {
      const startDay = normalizeDayName(rangeMatch[1]) as DayOfWeek;
      const endDay = normalizeDayName(rangeMatch[2]) as DayOfWeek;
      const startIdx = ALL_DAYS_OF_WEEK.indexOf(startDay);
      const endIdx = ALL_DAYS_OF_WEEK.indexOf(endDay);

      if (startIdx !== -1 && endIdx !== -1) {
        if (startIdx <= endIdx) {
          for (let i = startIdx; i <= endIdx; i++) {
            resultDays.add(ALL_DAYS_OF_WEEK[i]);
          }
        } else {
          for (let i = startIdx; i < ALL_DAYS_OF_WEEK.length; i++) {
            resultDays.add(ALL_DAYS_OF_WEEK[i]);
          }
          for (let i = 0; i <= endIdx; i++) {
            resultDays.add(ALL_DAYS_OF_WEEK[i]);
          }
        }
        continue;
      }
    }

    const norm = normalizeDayName(seg) as DayOfWeek;
    if (ALL_DAYS_OF_WEEK.includes(norm)) {
      resultDays.add(norm);
    }
  }

  if (resultDays.size === 0) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  }

  return ALL_DAYS_OF_WEEK.filter((d) => resultDays.has(d));
}

/**
 * Checks whether the clinic is configured to operate on the specified day of week.
 */
export function isClinicOpenOnDay(dayOfWeek: string, operatingDaysStr?: string | null): boolean {
  if (!dayOfWeek) return false;
  const norm = normalizeDayName(dayOfWeek) as DayOfWeek;
  const activeDays = parseClinicOperatingDays(operatingDaysStr);
  return activeDays.includes(norm);
}

/* ── Dynamic Time Options Bounded by Clinic Operating Hours ────────── */

/**
 * Generates selectable time options strictly bounded by the clinic's operating window.
 * For example, if clinic opens at 8:00 AM (08:00) and closes at 5:00 PM (17:00),
 * this yields ["08:00", "08:30", ..., "17:00"].
 */
export function generateTimeOptionsForClinicHours(
  openTime = "08:00",
  closeTime = "17:00",
  stepMinutes = 30
): { value: string; label: string }[] {
  const openM = timeToMinutes(openTime);
  let closeM = timeToMinutes(closeTime);
  if (closeM <= openM) {
    closeM = Math.min(24 * 60, openM + 8 * 60);
  }

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

/**
 * Generates clinic opening time options (e.g. from 06:00 to 22:30 in 30-minute intervals).
 */
export function generateClinicOpenTimeOptions(
  stepMinutes = 30,
  minTime = "06:00",
  maxTime = "22:30"
): { value: string; label: string }[] {
  const minM = timeToMinutes(minTime);
  const maxM = timeToMinutes(maxTime);
  const options: { value: string; label: string }[] = [];
  for (let m = minM; m <= maxM; m += stepMinutes) {
    const timeStr = minutesToTime(m);
    const label = timeStr === "12:00" ? "12:00 PM (Noon)" : formatTime12h(timeStr);
    options.push({ value: timeStr, label });
  }
  return options;
}

/**
 * Generates clinic closing time options strictly later than the selected opening time.
 * If opening time is 08:00, options begin at 08:30 and continue up to maxTime ("23:00").
 */
export function generateClinicCloseTimeOptions(
  openTime = "08:00",
  stepMinutes = 30,
  maxTime = "23:00"
): { value: string; label: string }[] {
  const openM = timeToMinutes(openTime);
  const maxM = timeToMinutes(maxTime);
  const options: { value: string; label: string }[] = [];
  const startM = Math.max(openM + stepMinutes, Math.ceil((openM + 1) / stepMinutes) * stepMinutes);
  for (let m = startM; m <= maxM; m += stepMinutes) {
    const timeStr = minutesToTime(m);
    const label = timeStr === "12:00" ? "12:00 PM (Noon)" : formatTime12h(timeStr);
    options.push({ value: timeStr, label });
  }
  return options;
}

export interface ClinicOperatingHoursValidation {
  isValid: boolean;
  error?: string;
}

/**
 * Validates clinic operating hours.
 * Enforces that opening and closing times are specified and that closing time is strictly later than opening time.
 */
export function validateClinicOperatingHours(
  openTime?: string,
  closeTime?: string
): ClinicOperatingHoursValidation {
  if (!openTime || !openTime.trim()) {
    return {
      isValid: false,
      error: "Please select a clinic opening time.",
    };
  }
  if (!closeTime || !closeTime.trim()) {
    return {
      isValid: false,
      error: "Please select a clinic closing time.",
    };
  }
  const openM = timeToMinutes(openTime);
  const closeM = timeToMinutes(closeTime);
  if (closeM <= openM) {
    return {
      isValid: false,
      error: `Closing time (${formatTime12h(closeTime)}) must be later than opening time (${formatTime12h(openTime)}). Please select a valid closing time before saving.`,
    };
  }
  return { isValid: true };
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
              breaks: Array.isArray(s.breaks) ? s.breaks : undefined,
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
              breaks: Array.isArray(s.breaks) ? s.breaks : undefined,
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
                breaks: Array.isArray(dayVal.breaks) ? dayVal.breaks : undefined,
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

export interface ScheduleConflict {
  doctorId: string;
  doctorName: string;
  day: string;
  shiftId: string;
  shiftLabel: string;
  shiftStart: string;
  shiftEnd: string;
  clinicOpenTime: string;
  clinicCloseTime: string;
  clinicOperatingDays?: string;
  reason: "outside_hours" | "closed_day" | "invalid_times";
  message: string;
}

/**
 * Validates shifts for a doctor:
 * 1. Start time must be earlier than End time.
 * 2. Shift must fit strictly within clinic operating hours.
 * 3. Day must be an operating day for the clinic (if operatingDays provided).
 * 4. Shifts on the same day cannot overlap.
 */
export function validateDoctorShifts(
  shifts: DoctorShift[],
  day: string,
  clinicOpenTime = "08:00",
  clinicCloseTime = "17:00",
  clinicOperatingDays?: string
): ShiftValidationError[] {
  const errors: ShiftValidationError[] = [];
  const rawOpenM = timeToMinutes(clinicOpenTime);
  const rawCloseM = timeToMinutes(clinicCloseTime);

  // Check if clinic is open on this day
  if (clinicOperatingDays && !isClinicOpenOnDay(day, clinicOperatingDays)) {
    errors.push({
      day,
      shiftIndex: 0,
      message: `On ${day}, the clinic is closed (${clinicOperatingDays}). Doctors cannot be scheduled on non-operating days.`,
    });
    return errors;
  }

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

    if (startM < rawOpenM || endM > rawCloseM) {
      errors.push({
        day,
        shiftIndex: idx,
        message: `On ${day}, ${shift.label || `Shift ${idx + 1}`} (${formatTime12h(shift.startTime)} – ${formatTime12h(shift.endTime)}) must fit within clinic hours (${formatTime12h(clinicOpenTime)} – ${formatTime12h(clinicCloseTime)}).`,
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
          message: `On ${day}, ${s1.label || `Shift ${i + 1}`} (${formatTime12h(s1.startTime)} – ${formatTime12h(s1.endTime)}) overlaps with ${s2.label || `Shift ${j + 1}`} (${formatTime12h(s2.startTime)} – ${formatTime12h(s2.endTime)}). Same doctor shifts cannot overlap.`,
        });
      }
    }
  }

  return errors;
}

/**
 * Revalidates existing doctor schedules against new or existing clinic operating hours and days.
 * Identifies affected doctors, days, assigned shifts, and clinic hours.
 */
export function findConflictingDoctorSchedules(
  optionsOrDoctors:
    | {
        doctors: any[];
        clinicOpenTime?: string;
        clinicCloseTime?: string;
        clinicOperatingDays?: string;
      }
    | any[],
  argClinicOpenTime?: string,
  argClinicCloseTime?: string,
  argClinicOperatingDays?: string
): ScheduleConflict[] {
  let doctors: any[] = [];
  let clinicOpenTime = "08:00";
  let clinicCloseTime = "17:00";
  let clinicOperatingDays: string | undefined;

  if (Array.isArray(optionsOrDoctors)) {
    doctors = optionsOrDoctors;
    if (argClinicOpenTime) clinicOpenTime = argClinicOpenTime;
    if (argClinicCloseTime) clinicCloseTime = argClinicCloseTime;
    if (argClinicOperatingDays) clinicOperatingDays = argClinicOperatingDays;
  } else if (optionsOrDoctors && typeof optionsOrDoctors === "object") {
    doctors = optionsOrDoctors.doctors || [];
    if (optionsOrDoctors.clinicOpenTime) clinicOpenTime = optionsOrDoctors.clinicOpenTime;
    if (optionsOrDoctors.clinicCloseTime) clinicCloseTime = optionsOrDoctors.clinicCloseTime;
    if (optionsOrDoctors.clinicOperatingDays) clinicOperatingDays = optionsOrDoctors.clinicOperatingDays;
  }

  const conflicts: ScheduleConflict[] = [];
  const openM = timeToMinutes(clinicOpenTime);
  const closeM = timeToMinutes(clinicCloseTime);
  const activeClinicDays = parseClinicOperatingDays(clinicOperatingDays);

  if (!Array.isArray(doctors)) return conflicts;

  doctors.forEach((doc) => {
    if (!doc) return;
    const docStatus = String(doc.status || "Active").toLowerCase();
    if (docStatus === "inactive") return;

    const docId = String(doc.id || doc.doctor_id || "");
    const docName = String(doc.name || doc.doctor_name || "Doctor");

    const schedule: DoctorWeeklySchedule =
      doc.weeklySchedule ||
      parseDoctorSchedule(
        doc.dutySchedule || doc.duty_schedule,
        doc.dutyDays || doc.duty_days,
        doc.dutyStartTime || doc.duty_start_time || clinicOpenTime,
        doc.dutyEndTime || doc.duty_end_time || clinicCloseTime
      );

    ALL_DAYS_OF_WEEK.forEach((day) => {
      const shifts = schedule.weeklyShifts[day] || [];
      if (shifts.length === 0) return;

      // 1. Is clinic closed on this day?
      if (!activeClinicDays.includes(day)) {
        shifts.forEach((s) => {
          conflicts.push({
            doctorId: docId,
            doctorName: docName,
            day,
            shiftId: s.id || s.shiftId || "",
            shiftLabel: s.label || s.shiftLabel || "Shift",
            shiftStart: s.startTime,
            shiftEnd: s.endTime,
            clinicOpenTime,
            clinicCloseTime,
            clinicOperatingDays,
            reason: "closed_day",
            message: `Dr. ${docName.replace(/^Dr\.\s*/i, "")} is scheduled on ${day} (${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}), but the clinic is closed on ${day}s (${clinicOperatingDays || "Operating days"}).`,
          });
        });
        return;
      }

      // 2. Are shifts within clinic operating hours?
      shifts.forEach((s) => {
        const sStartM = timeToMinutes(s.startTime);
        const sEndM = timeToMinutes(s.endTime);

        if (sEndM <= sStartM) {
          conflicts.push({
            doctorId: docId,
            doctorName: docName,
            day,
            shiftId: s.id || s.shiftId || "",
            shiftLabel: s.label || s.shiftLabel || "Shift",
            shiftStart: s.startTime,
            shiftEnd: s.endTime,
            clinicOpenTime,
            clinicCloseTime,
            clinicOperatingDays,
            reason: "invalid_times",
            message: `Dr. ${docName.replace(/^Dr\.\s*/i, "")} has an invalid shift on ${day}: end time (${formatTime12h(s.endTime)}) must be later than start time (${formatTime12h(s.startTime)}).`,
          });
          return;
        }

        if (sStartM < openM || sEndM > closeM) {
          conflicts.push({
            doctorId: docId,
            doctorName: docName,
            day,
            shiftId: s.id || s.shiftId || "",
            shiftLabel: s.label || s.shiftLabel || "Shift",
            shiftStart: s.startTime,
            shiftEnd: s.endTime,
            clinicOpenTime,
            clinicCloseTime,
            clinicOperatingDays,
            reason: "outside_hours",
            message: `Dr. ${docName.replace(/^Dr\.\s*/i, "")}'s shift on ${day} (${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}) conflicts with clinic hours (${formatTime12h(clinicOpenTime)} – ${formatTime12h(clinicCloseTime)}).`,
          });
        }
      });
    });
  });

  return conflicts;
}

/**
 * Evaluates whether the clinic is currently open right now according to its
 * configured operating days, opening/closing hours, and timezone (Asia/Manila, UTC+8).
 */
export function isClinicCurrentlyOpen({
  openTime = "08:00",
  closeTime = "17:00",
  operatingDays = "Monday - Saturday",
  timezone = "Asia/Manila",
  currentTimeMs,
  referenceDate,
}: {
  openTime?: string;
  closeTime?: string;
  operatingDays?: string;
  timezone?: string;
  currentTimeMs?: number;
  referenceDate?: Date;
}): {
  isOpen: boolean;
  dayOfWeek: string;
  currentMinutes: number;
  openMinutes: number;
  closeMinutes: number;
  reason?: string;
} {
  const targetDate = referenceDate ? referenceDate : (currentTimeMs ? new Date(currentTimeMs) : new Date());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Manila",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(targetDate);

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }

  const dayOfWeek = normalizeDayName(lookup.weekday || "");
  let hour = parseInt(lookup.hour, 10) || 0;
  if (hour === 24) hour = 0;
  const minute = parseInt(lookup.minute, 10) || 0;
  const currentMinutes = hour * 60 + minute;

  const openMinutes = timeToMinutes(openTime || "08:00");
  const closeMinutes = timeToMinutes(closeTime || "17:00");

  // 1. Is clinic open on this day of week?
  if (!isClinicOpenOnDay(dayOfWeek, operatingDays)) {
    return {
      isOpen: false,
      dayOfWeek,
      currentMinutes,
      openMinutes,
      closeMinutes,
      reason: `Clinic is closed on ${dayOfWeek}s (${operatingDays || "Operating days"}).`,
    };
  }

  // 2. Is current time within opening and closing hours?
  let withinHours = false;
  if (closeMinutes > openMinutes) {
    withinHours = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  } else if (closeMinutes < openMinutes) {
    // Overnight clinic
    withinHours = currentMinutes >= openMinutes || currentMinutes < closeMinutes;
  }

  if (!withinHours) {
    const statusText = currentMinutes < openMinutes ? "not open yet" : "already closed";
    return {
      isOpen: false,
      dayOfWeek,
      currentMinutes,
      openMinutes,
      closeMinutes,
      reason: `Clinic is ${statusText} (hours: ${formatTime12h(openTime)} – ${formatTime12h(closeTime)}).`,
    };
  }

  return {
    isOpen: true,
    dayOfWeek,
    currentMinutes,
    openMinutes,
    closeMinutes,
  };
}

/**
 * Authoritative evaluation of a doctor's "On Duty" status.
 *
 * A doctor may be displayed as "On Duty" ONLY when all 4 conditions are met:
 * 1. The clinic is currently open according to its configured hours and operating days.
 * 2. The current local time (in clinic timezone, Asia/Manila) falls within the doctor's assigned duty interval.
 * 3. The doctor's shift is valid against the applicable clinic operating hours.
 * 4. The doctor is active and not on a scheduled break or otherwise unavailable.
 */
export function isDoctorCurrentlyOnDuty({
  doctor,
  clinicSchedule,
  timezone = "Asia/Manila",
  currentTimeMs,
  referenceDate,
}: {
  doctor: any;
  clinicSchedule?: {
    openTime?: string;
    closeTime?: string;
    operatingDays?: string;
  } | null;
  timezone?: string;
  currentTimeMs?: number;
  referenceDate?: Date;
}): {
  isOnDuty: boolean;
  activeShift?: DoctorShift;
  reason?: string;
} {
  if (!doctor) {
    return { isOnDuty: false, reason: "No doctor provided." };
  }

  const docStatus = String(doctor.status || "Active").toLowerCase().trim();
  if (docStatus === "inactive") {
    return { isOnDuty: false, reason: "Doctor is marked as Inactive." };
  }

  const openTime = clinicSchedule?.openTime || "08:00";
  const closeTime = clinicSchedule?.closeTime || "17:00";
  const operatingDays = clinicSchedule?.operatingDays || "Monday - Saturday";

  // Condition 1: The clinic is currently open according to its configured hours and days
  const clinicStatus = isClinicCurrentlyOpen({
    openTime,
    closeTime,
    operatingDays,
    timezone,
    currentTimeMs,
    referenceDate,
  });

  if (!clinicStatus.isOpen) {
    return {
      isOnDuty: false,
      reason: clinicStatus.reason || "Clinic is currently closed.",
    };
  }

  const todayDayName = clinicStatus.dayOfWeek;
  const currentMinutes = clinicStatus.currentMinutes;
  const clinicOpenM = clinicStatus.openMinutes;
  const clinicCloseM = clinicStatus.closeMinutes;

  // Resolve doctor schedule
  const docSched: DoctorWeeklySchedule =
    doctor.weeklySchedule ||
    parseDoctorSchedule(
      doctor.dutySchedule || doctor.duty_schedule,
      doctor.dutyDays || doctor.duty_days,
      doctor.dutyStartTime || doctor.duty_start_time || openTime,
      doctor.dutyEndTime || doctor.duty_end_time || closeTime
    );

  const shiftsForToday = docSched.weeklyShifts[todayDayName] || [];
  if (shiftsForToday.length === 0) {
    return {
      isOnDuty: false,
      reason: `Doctor has no shifts scheduled on ${todayDayName}.`,
    };
  }

  // Condition 3: Doctor's shift must be valid against clinic operating hours
  // Condition 2: Current local time must fall within doctor's assigned duty interval
  // Condition 4: Doctor must not be on a scheduled break
  for (const shift of shiftsForToday) {
    const sStartM = timeToMinutes(shift.startTime);
    const sEndM = timeToMinutes(shift.endTime);

    if (sEndM <= sStartM) continue;

    // Conflicting shift: shift exceeds clinic hours
    if (sStartM < clinicOpenM || sEndM > clinicCloseM) {
      continue;
    }

    // Check if current time falls within this valid shift: [sStartM, sEndM)
    if (currentMinutes >= sStartM && currentMinutes < sEndM) {
      // Check breaks
      if (Array.isArray(shift.breaks)) {
        const onBreak = shift.breaks.some((brk) => {
          const bStart = timeToMinutes(brk.startTime);
          const bEnd = timeToMinutes(brk.endTime);
          return currentMinutes >= bStart && currentMinutes < bEnd;
        });
        if (onBreak) {
          return { isOnDuty: false, reason: "Doctor is currently on a scheduled break." };
        }
      }

      return { isOnDuty: true, activeShift: shift };
    }
  }

  return {
    isOnDuty: false,
    reason: "Current time is outside the doctor's scheduled shift hours.",
  };
}

/**
 * Evaluates whether a doctor is scheduled and valid to work on a specific day of the week,
 * strictly verifying clinic operating days, doctor duty days, and overlap with clinic hours.
 */
export function isDoctorOnDutyOnDay(
  doc: any | null | undefined,
  dayOfWeek: string,
  clinicSchedule?: { openTime?: string; closeTime?: string; operatingDays?: string } | null
): boolean {
  if (!doc) return false;
  const status = String(doc.status || "Active").toLowerCase().trim();
  if (status === "inactive") return false;
  const target = normalizeDayName(dayOfWeek);
  if (!target) return false;

  // Strict check: if clinic operating days are known, verify clinic is open on this day
  if (clinicSchedule?.operatingDays && !isClinicOpenOnDay(target, clinicSchedule.operatingDays)) {
    return false;
  }

  // Strict check: If doc.dutyDays is defined and has days, target day must be in dutyDays
  const dutyDays = doc.dutyDays || doc.duty_days;
  if (Array.isArray(dutyDays) && dutyDays.length > 0) {
    const isDayIncluded = dutyDays.some((d: string) => normalizeDayName(d) === target);
    if (!isDayIncluded) return false;
  }

  // Resolve shifts for this day
  const docSched: DoctorWeeklySchedule =
    doc.weeklySchedule ||
    parseDoctorSchedule(
      doc.dutySchedule || doc.duty_schedule,
      dutyDays,
      doc.dutyStartTime || doc.duty_start_time || clinicSchedule?.openTime || "08:00",
      doc.dutyEndTime || doc.duty_end_time || clinicSchedule?.closeTime || "17:00"
    );

  const shifts = docSched.weeklyShifts[target] || [];
  if (shifts.length === 0) return false;

  // If clinic hours are specified, verify doctor has at least one shift that overlaps clinic hours
  if (clinicSchedule?.openTime && clinicSchedule?.closeTime) {
    const openM = timeToMinutes(clinicSchedule.openTime);
    const closeM = timeToMinutes(clinicSchedule.closeTime);
    const hasValidShift = shifts.some((s) => {
      const sStart = timeToMinutes(s.startTime);
      const sEnd = timeToMinutes(s.endTime);
      return sEnd > sStart && sStart < closeM && sEnd > openM;
    });
    return hasValidShift;
  }

  return true;
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
 * Checks whether an appointment reservation or hold is currently active and occupying a slot.
 * - 'paid', 'exempt', or legacy records (payment_status is null/undefined) are active reservations (unless cancelled/rejected).
 * - 'pending_hold' is active ONLY IF payment_hold_expires_at is in the future.
 * - 'expired', 'failed', 'cancelled' holds do NOT occupy slots.
 */
export function isAppointmentHoldOrReservationActive(
  appt?: {
    status?: string | null;
    doctor_status?: string | null;
    doctorStatus?: string | null;
    payment_status?: string | null;
    paymentStatus?: string | null;
    payment_hold_expires_at?: string | null;
    paymentHoldExpiresAt?: string | null;
  } | null,
  currentTimeMs?: number
): boolean {
  if (!appt) return false;
  const st = String(appt.status || "").toLowerCase().trim();
  if (st === "cancelled" || st === "rejected" || st === "declined") return false;
  const docSt = String(appt.doctor_status || appt.doctorStatus || "").toLowerCase().trim();
  if (docSt === "rejected" || docSt === "declined") return false;

  const paySt = String(appt.payment_status || appt.paymentStatus || "").toLowerCase().trim();
  if (paySt === "expired" || paySt === "cancelled" || paySt === "failed") {
    return false;
  }

  if (paySt === "pending_hold") {
    const rawExp = appt.payment_hold_expires_at || appt.paymentHoldExpiresAt;
    if (!rawExp) return false;
    const expTime = new Date(rawExp).getTime();
    if (isNaN(expTime)) return false;
    const nowMs = currentTimeMs ?? Date.now();
    if (expTime <= nowMs) {
      return false;
    }
  }

  return true;
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
    if (!isAppointmentHoldOrReservationActive(appt)) return false;

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
      shiftId: shift.id || shift.shiftId || `shift-${slotIndex}`,
      shiftLabel: shift.label || shift.shiftLabel || "Consultation",
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
    operatingDays?: string;
  } | null;
  existingAppointments?: any[];
  isToday?: boolean;
  currentMinutesNow?: number;
}): DayShiftSlotsGroup[] {
  const normDay = normalizeDayName(dayOfWeek);

  // If clinic operating days are configured and clinic is closed on this day, no slots!
  if (clinicDefaults?.operatingDays && !isClinicOpenOnDay(normDay, clinicDefaults.operatingDays)) {
    return [];
  }

  const shiftsForDay = doctorSchedule.weeklyShifts[normDay] || [];
  if (shiftsForDay.length === 0) {
    return [];
  }

  const clinicOpenM = clinicDefaults?.openTime ? timeToMinutes(clinicDefaults.openTime) : 0;
  const clinicCloseM = clinicDefaults?.closeTime ? timeToMinutes(clinicDefaults.closeTime) : 24 * 60;

  // Filter out shifts completely outside clinic hours
  const eligibleShifts = shiftsForDay.filter((shift) => {
    const sStart = timeToMinutes(shift.startTime);
    const sEnd = timeToMinutes(shift.endTime);
    if (sEnd <= sStart) return false;
    return sStart < clinicCloseM && sEnd > clinicOpenM;
  });

  if (eligibleShifts.length === 0) {
    return [];
  }

  return eligibleShifts.map((shift) => {
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
    operatingDays?: string;
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

  // Check clinic operating days
  if (clinicDefaults?.operatingDays && !isClinicOpenOnDay(normDay, clinicDefaults.operatingDays)) {
    return {
      isAvailable: false,
      reason: `Clinic is closed on ${normDay}s (${clinicDefaults.operatingDays}).`,
    };
  }

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

  // Check clinic operating hours
  const clinicOpenM = clinicDefaults?.openTime ? timeToMinutes(clinicDefaults.openTime) : 0;
  const clinicCloseM = clinicDefaults?.closeTime ? timeToMinutes(clinicDefaults.closeTime) : 24 * 60;
  if (apptMinutes < clinicOpenM || apptMinutes >= clinicCloseM) {
    return {
      isAvailable: false,
      reason: `Time (${formatTime12h(cleanTime)}) is outside clinic hours (${formatTime12h(clinicDefaults?.openTime || "08:00")} – ${formatTime12h(clinicDefaults?.closeTime || "17:00")}).`,
    };
  }

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
    if (!isAppointmentHoldOrReservationActive(appt)) {
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
  payment_status?: string | null;
  paymentStatus?: string | null;
} | null): boolean {
  if (!appt) return true;

  // 1. Immediately exclude unpaid temporary holds or expired holds
  const paySt = String(appt.payment_status || (appt as any).paymentStatus || "").toLowerCase().trim();
  if (paySt === "pending_hold" || paySt === "expired" || paySt === "failed" || paySt === "cancelled") {
    return true;
  }

  // 2. Immediately exclude No-Show appointments
  const checkIn = String(appt.checkInStatus || appt.check_in_status || "").toLowerCase().trim();
  const st = String(appt.status || "").toLowerCase().trim();
  const docSt = String(appt.doctorStatus || "").toLowerCase().trim();
  if (checkIn === "no-show" || st === "no-show" || docSt === "no-show") return true;

  // 3. Immediately exclude Completed appointments
  if (st === "completed" || checkIn === "completed") return true;

  // 4. Immediately exclude Cancelled or Rejected appointments
  if (st === "cancelled" || st === "rejected") return true;

  // 5. Exclude appointments whose scheduled date and time have elapsed
  // Keep pending review requests visible throughout today's operating hours so doctors and clinics can review and act
  const isPendingReview = (st === "pending" || docSt === "pending-review") && st !== "cancelled" && st !== "rejected";
  if (isPendingReview) {
    const targetDateRaw = appt.rawDate || appt.date;
    if (targetDateRaw) {
      const apptDateKey = getManilaCalendarDate(targetDateRaw);
      const manilaNow = getManilaNowParts();
      if (apptDateKey && apptDateKey < manilaNow.dateKey) {
        return true; // strictly past calendar date
      }
      if (apptDateKey === manilaNow.dateKey && manilaNow.totalMinutes >= 21 * 60) {
        return true; // past end of clinic operating day (9:00 PM)
      }
      return false; // keep visible today and on upcoming dates
    }
  }

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
    const paySt = String(a.payment_status || a.paymentStatus || "").toLowerCase().trim();
    if (paySt === "pending_hold" || paySt === "expired" || paySt === "failed" || paySt === "cancelled") {
      return false;
    }
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

    if (!isAppointmentHoldOrReservationActive(appt)) return false;

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

