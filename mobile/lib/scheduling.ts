/**
 * Mobile Scheduling Service
 * Pure TypeScript scheduling and slot calculation functions shared with Web.
 * Guarantees schedule parity, interval calculation, shift bounds, and occupancy evaluation.
 */

export interface DoctorShift {
  id?: string;
  shiftId?: string;
  label?: string;
  shiftLabel?: string;
  startTime: string; // "08:00" (HH:mm)
  endTime: string;   // "12:00" (HH:mm)
  slotIntervalMinutes?: number;
  maxPatientsPerShift?: number;
  breaks?: { startTime: string; endTime: string }[];
}

export interface DoctorWeeklySchedule {
  slotIntervalMinutes?: number;
  maxPatientsPerShift?: number;
  weeklyShifts: Record<string, DoctorShift[]>;
  isCustomSchedule?: boolean;
}

export interface ClinicOperatingSchedule {
  openTime: string;
  closeTime: string;
  operatingDays: string;
  defaultSlotIntervalMinutes: number;
  defaultMaxPatientsPerShift: number;
}

export interface ConsultationSlot {
  shiftId: string;
  shiftLabel: string;
  slotIndex: number;
  slotTime: string;       // "08:00"
  endTime: string;        // "08:30"
  timeRange: string;      // "8:00 AM – 8:30 AM"
  label: string;          // "8:00 AM"
  durationMinutes: number;// 30
  isBooked: boolean;
  isReserved?: boolean;   // Active temporary checkout hold
  isOccupied?: boolean;   // Booked or reserved
  occupancyType?: "available" | "reserved" | "booked" | "unavailable";
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
  effectiveCapacity: number;
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

export function isClinicOpenOnDay(dayOfWeek: string, operatingDaysStr?: string | null): boolean {
  if (!dayOfWeek) return false;
  const norm = normalizeDayName(dayOfWeek) as DayOfWeek;
  const activeDays = parseClinicOperatingDays(operatingDaysStr);
  return activeDays.includes(norm);
}

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

  let capacity: number;
  let capacitySource: "shift" | "doctor" | "clinic" = "shift";
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

  return {
    interval,
    intervalSource,
    capacity,
    capacitySource,
    possibleSlots,
    effectiveCapacity: capacity,
  };
}

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
      ALL_DAYS_OF_WEEK.forEach((day) => {
        const dayVal = scheduleObj[day];
        if (dayVal) {
          if (Array.isArray(dayVal)) {
            weeklyShifts[day] = dayVal.filter((s: any) => s && typeof s === "object").map((s: any, idx: number) => ({
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

  if (Array.isArray(rawDutyDays) && rawDutyDays.length === 0) {
    ALL_DAYS_OF_WEEK.forEach((day) => {
      weeklyShifts[day] = [];
    });
  } else if (dutyDays.length > 0) {
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

  if (clinicSchedule?.operatingDays && !isClinicOpenOnDay(target, clinicSchedule.operatingDays)) {
    return false;
  }

  const dutyDays = doc.dutyDays || doc.duty_days;
  if (Array.isArray(dutyDays)) {
    if (dutyDays.length === 0) return false;
    const isDayIncluded = dutyDays.some((d: string) => normalizeDayName(d) === target);
    if (!isDayIncluded) return false;
  }

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

export function isAppointmentHoldOrReservationActive(
  appt?: {
    status?: string | null;
    doctor_status?: string | null;
    doctorStatus?: string | null;
    payment_status?: string | null;
    paymentStatus?: string | null;
    occupancy_type?: string | null;
    occupancyType?: string | null;
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

  const occType = String(appt.occupancy_type || appt.occupancyType || "").toLowerCase().trim();
  if (occType === "reserved" || occType === "booked") {
    const rawExp = appt.payment_hold_expires_at || appt.paymentHoldExpiresAt;
    if (rawExp) {
      const expTime = new Date(rawExp).getTime();
      if (!isNaN(expTime)) {
        const nowMs = currentTimeMs ?? Date.now();
        if (expTime <= nowMs) {
          return false;
        }
      }
    }
    return true;
  }

  if (paySt === "pending_hold") {
    const rawExp = appt.payment_hold_expires_at || appt.paymentHoldExpiresAt;
    if (rawExp) {
      const expTime = new Date(rawExp).getTime();
      if (!isNaN(expTime)) {
        const nowMs = currentTimeMs ?? Date.now();
        if (expTime <= nowMs) {
          return false;
        }
      }
    }
    return true;
  }

  return true;
}

export function generateSlotsForShift({
  shift,
  doctorSchedule,
  clinicDefaults,
  doctorId,
  activeAppointments = [],
  isToday = false,
  currentMinutesNow = 0,
}: {
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
}): {
  slots: ConsultationSlot[];
  totalBookedInShift: number;
  totalReservedInSlots: number;
  totalConfirmedBooked: number;
  totalOccupiedInSlots: number;
  remainingShiftCapacity: number;
  isShiftCapacityReached: boolean;
  effectiveSettings: EffectiveShiftSettings;
} {
  const effectiveSettings = getEffectiveShiftSettings(shift, doctorSchedule, clinicDefaults);
  const { interval, capacity } = effectiveSettings;

  let startMin = timeToMinutes(shift.startTime);
  let endMin = timeToMinutes(shift.endTime);

  if (clinicDefaults?.openTime) {
    const clinicOpenM = timeToMinutes(clinicDefaults.openTime);
    startMin = Math.max(startMin, clinicOpenM);
  }
  if (clinicDefaults?.closeTime) {
    const clinicCloseM = timeToMinutes(clinicDefaults.closeTime);
    endMin = Math.min(endMin, clinicCloseM);
  }

  const activeBookingsInShift = activeAppointments.filter((appt) => {
    if (!isAppointmentHoldOrReservationActive(appt)) return false;

    if (doctorId && appt.assigned_doctor_id) {
      const cleanDoc = String(doctorId).trim().toLowerCase();
      const cleanApptDoc = String(appt.assigned_doctor_id).trim().toLowerCase();
      if (cleanDoc !== cleanApptDoc) return false;
    }

    const rawTime = (appt.time || appt.batch_time || appt.slot_time || "").slice(0, 5);
    const apptMin = timeToMinutes(rawTime);
    return apptMin >= startMin && apptMin < endMin;
  });

  const distinctShiftSlotTimes = new Set(
    activeBookingsInShift.map((appt) => (appt.time || appt.batch_time || appt.slot_time || "").slice(0, 5))
  );
  const totalBookedInShift = distinctShiftSlotTimes.size;
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

    const matchingBookings = activeBookingsInShift.filter((appt) => {
      const bTime = (appt.time || appt.batch_time || appt.slot_time || "").slice(0, 5);
      return bTime === slotTimeStr;
    });

    const isOccupied = matchingBookings.length > 0;
    let isReserved = false;
    let isBooked = isOccupied;

    if (isOccupied) {
      const hasConfirmedBooking = matchingBookings.some((b) => {
        const paySt = String(b.payment_status || b.paymentStatus || "").toLowerCase().trim();
        const occType = String(b.occupancy_type || b.occupancyType || "").toLowerCase().trim();
        if (occType === "booked" || paySt === "paid") return true;
        if (occType === "reserved" || paySt === "pending_hold") return false;
        const rawExp = b.payment_hold_expires_at || b.paymentHoldExpiresAt || b.db_hold_expires_at;
        if (rawExp) {
          const expMs = new Date(rawExp).getTime();
          if (!isNaN(expMs) && expMs > Date.now()) {
            return false;
          }
        }
        return true;
      });
      isReserved = !hasConfirmedBooking;
    }

    const isCapacityFull = isShiftCapacityReached;
    const isAvailable = !isOccupied && !isPast && !isCapacityFull;
    const occupancyType: "available" | "reserved" | "booked" | "unavailable" = isAvailable
      ? "available"
      : isReserved
      ? "reserved"
      : isBooked
      ? "booked"
      : "unavailable";

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
      isReserved,
      isOccupied,
      occupancyType,
      isPast,
      isCapacityFull,
      isAvailable,
    });

    currentMin += interval;
    slotIndex++;
  }

  const totalOccupiedInSlots = slots.filter((s) => s.isOccupied).length;
  const totalReservedInSlots = slots.filter((s) => s.isReserved).length;
  const totalConfirmedBooked = slots.filter((s) => s.isBooked && !s.isReserved).length;
  const totalAvailableInSlots = slots.filter((s) => s.isAvailable).length;

  const effectiveBooked = Math.max(totalBookedInShift, totalOccupiedInSlots);
  const effectiveRemaining = Math.max(0, Math.min(capacity - effectiveBooked, totalAvailableInSlots));
  const effectiveCapacityReached = effectiveRemaining <= 0 || effectiveBooked >= capacity;

  return {
    slots,
    totalBookedInShift: effectiveBooked,
    totalReservedInSlots,
    totalConfirmedBooked,
    totalOccupiedInSlots,
    remainingShiftCapacity: effectiveRemaining,
    isShiftCapacityReached: effectiveCapacityReached,
    effectiveSettings,
  };
}

export interface DayShiftSlotsGroup {
  shift: DoctorShift;
  effectiveSettings: EffectiveShiftSettings;
  totalBooked: number;
  totalReserved: number;
  totalConfirmedBooked: number;
  totalOccupied: number;
  remainingCapacity: number;
  isCapacityReached: boolean;
  slots: ConsultationSlot[];
}

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

  if (clinicDefaults?.operatingDays && !isClinicOpenOnDay(normDay, clinicDefaults.operatingDays)) {
    return [];
  }

  const shiftsForDay = doctorSchedule.weeklyShifts[normDay] || [];
  if (shiftsForDay.length === 0) {
    return [];
  }

  const clinicOpenM = clinicDefaults?.openTime ? timeToMinutes(clinicDefaults.openTime) : 0;
  const clinicCloseM = clinicDefaults?.closeTime ? timeToMinutes(clinicDefaults.closeTime) : 24 * 60;

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
      totalReserved: res.totalReservedInSlots,
      totalConfirmedBooked: res.totalConfirmedBooked,
      totalOccupied: res.totalOccupiedInSlots,
      remainingCapacity: res.remainingShiftCapacity,
      isCapacityReached: res.isShiftCapacityReached,
      slots: res.slots,
    };
  });
}

export function getManilaCalendarDate(dateInput?: Date | string | number | null): string {
  if (!dateInput) return "";
  try {
    if (typeof dateInput === "string") {
      const cleanStr = dateInput.split("·")[0].trim();
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
