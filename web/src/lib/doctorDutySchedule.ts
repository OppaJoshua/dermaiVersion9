import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_DAYS_OF_WEEK,
  formatTime12h,
  getEffectiveShiftSettings,
  getManilaCalendarDate,
  getManilaNowParts,
  isAppointmentHoldOrReservationActive,
  normalizeDayName,
  parseAppointmentTimeMinutes,
  parseAssignedDoctorSchedule,
  serializeDoctorSchedule,
  timeToMinutes,
  validateDoctorShifts,
  type DoctorShift,
  type DoctorWeeklySchedule,
} from "./schedulingService.ts";
import {
  findCrossClinicDutyConflicts,
  type DoctorDutyAssignment,
} from "./doctorScheduleConflicts.ts";

export interface ClinicScheduleDefaults {
  defaultSlotIntervalMinutes?: number;
  defaultMaxPatientsPerShift?: number;
  openTime?: string;
  closeTime?: string;
  operatingDays?: string;
}

export const parseAssignedDutySchedule = parseAssignedDoctorSchedule;

export async function fetchDoctorDutySchedule(
  client: SupabaseClient,
  doctorId: string,
  clinicId: string,
  userId: string
) {
  if (!doctorId || !clinicId || !userId) return null;
  const { data, error } = await client
    .from("clinic_doctor")
    .select("duty_days, duty_schedule, duty_start_time, duty_end_time")
    .eq("doctor_id", doctorId)
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return parseAssignedDutySchedule(data);
}

/**
 * Fetches all other active clinic branch schedule rows for the same doctor
 * so multi-clinic conflict detection can run before and during schedule editing.
 */
export async function fetchDoctorOtherBranchSchedules(
  client: SupabaseClient,
  currentDoctorId: string,
  currentClinicId: string,
  userId?: string | null
): Promise<DoctorDutyAssignment[]> {
  if (!currentDoctorId || !currentClinicId) return [];

  // Primary path: authorized cross-clinic RPC
  try {
    const { data, error } = await client.rpc("get_owned_doctor_other_shifts", {
      target_doctor_id: currentDoctorId,
    });
    if (!error && Array.isArray(data)) {
      return data as DoctorDutyAssignment[];
    }
  } catch {
    // Fall back to direct user_id-scoped query if RPC is unavailable
  }

  if (!userId) return [];

  const { data, error } = await client
    .from("clinic_doctor")
    .select("doctor_id, clinic_id, duty_days, duty_schedule, duty_start_time, duty_end_time, status, clinic:clinic_id ( name )")
    .eq("user_id", userId)
    .neq("clinic_id", currentClinicId);

  if (error || !Array.isArray(data)) return [];

  return data
    .filter((row: any) => String(row.status || "Active").toLowerCase() !== "inactive")
    .map((row: any) => ({
      doctor_id: String(row.doctor_id),
      clinic_id: String(row.clinic_id),
      duty_days: row.duty_days,
      duty_schedule: row.duty_schedule,
      duty_start_time: row.duty_start_time,
      duty_end_time: row.duty_end_time,
      clinic: Array.isArray(row.clinic) ? row.clinic[0] : row.clinic,
    }));
}

export interface AppointmentScheduleConflict {
  appointmentId: string;
  date: string;
  dayOfWeek: string;
  time: string;
  formattedTime: string;
  durationMinutes: number;
  patientName?: string;
  status: string;
  message: string;
}

/**
 * Checks whether a proposed weekly schedule would leave any active upcoming appointment
 * or unexpired payment hold outside the doctor's new duty hours (including full appointment duration).
 * Never cancels, deletes, or reschedules existing appointments.
 */
export function findConflictingAppointmentsForDoctorSchedule(
  appointments: any[],
  proposed: {
    dutyDays: string[];
    weeklyShifts: Record<string, DoctorShift[]>;
    slotIntervalMinutes?: number | null;
  },
  clinicDefaults?: ClinicScheduleDefaults,
  referenceNowMs: number = Date.now()
): AppointmentScheduleConflict[] {
  if (!Array.isArray(appointments) || appointments.length === 0) return [];

  const activeDutyDays = proposed.dutyDays.map(normalizeDayName).filter(Boolean);
  const refDate = new Date(referenceNowMs);
  const todayManila = getManilaCalendarDate(refDate) || getManilaNowParts().dateKey;
  const manilaHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(refDate);
  const nowMinutes = parseAppointmentTimeMinutes(manilaHm);
  const conflicts: AppointmentScheduleConflict[] = [];

  const proposedSchedule: DoctorWeeklySchedule = {
    weeklyShifts: proposed.weeklyShifts,
    slotIntervalMinutes: proposed.slotIntervalMinutes ?? undefined,
    isCustomSchedule: activeDutyDays.length > 0,
  };

  for (const appt of appointments) {
    if (!appt) continue;
    if (!isAppointmentHoldOrReservationActive(appt, referenceNowMs)) continue;

    const st = String(appt.status || "pending").toLowerCase().trim();
    if (st === "completed") continue;
    const docSt = String(appt.doctor_status || appt.doctorStatus || "").toLowerCase().trim();
    if (docSt === "completed") continue;

    const apptDateYmd = getManilaCalendarDate(appt.date);
    if (!apptDateYmd || apptDateYmd < todayManila) continue;

    const rawTimeStr = String(appt.time || appt.batch_time || appt.batchTime || "").trim();
    let apptStartMin = parseAppointmentTimeMinutes(rawTimeStr);
    if (apptStartMin < 0 && appt.date) {
      try {
        const dt = new Date(appt.date);
        if (!isNaN(dt.getTime())) {
          const hm = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(dt);
          apptStartMin = parseAppointmentTimeMinutes(hm);
        }
      } catch {
        apptStartMin = -1;
      }
    }
    if (apptStartMin < 0) continue;

    // Ignore appointments earlier today that have already started/passed
    if (apptDateYmd === todayManila && apptStartMin < nowMinutes) continue;

    const [y, m, d] = apptDateYmd.split("-").map(Number);
    const utcNoon = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    const dayOfWeek = normalizeDayName(
      new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Manila" }).format(utcNoon)
    );

    const dayShifts = activeDutyDays.includes(dayOfWeek)
      ? proposed.weeklyShifts[dayOfWeek] || []
      : [];

    const fallbackInterval =
      (proposed.slotIntervalMinutes && proposed.slotIntervalMinutes > 0
        ? proposed.slotIntervalMinutes
        : undefined) ||
      (clinicDefaults?.defaultSlotIntervalMinutes && clinicDefaults.defaultSlotIntervalMinutes > 0
        ? clinicDefaults.defaultSlotIntervalMinutes
        : 30);

    const fitsInSomeShift = dayShifts.some((shift) => {
      const sStart = timeToMinutes(shift.startTime);
      const sEnd = timeToMinutes(shift.endTime);
      const eff = getEffectiveShiftSettings(shift, proposedSchedule, clinicDefaults);
      const duration = eff.interval > 0 ? eff.interval : fallbackInterval;
      return apptStartMin >= sStart && apptStartMin + duration <= sEnd;
    });

    if (!fitsInSomeShift) {
      const h = Math.floor(apptStartMin / 60);
      const min = apptStartMin % 60;
      const hhmm = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      const formattedTime = formatTime12h(hhmm);
      conflicts.push({
        appointmentId: String(appt.appointment_id || appt.id || ""),
        date: apptDateYmd,
        dayOfWeek,
        time: hhmm,
        formattedTime,
        durationMinutes: fallbackInterval,
        patientName: appt.patient_name || appt.patientName || undefined,
        status: st,
        message: `Cannot save schedule because an existing appointment or active reservation on ${dayOfWeek} (${apptDateYmd}) at ${formattedTime} would fall outside your updated duty hours.`,
      });
    }
  }

  return conflicts;
}

export interface SaveAuthorizedDoctorDutyScheduleParams {
  client: SupabaseClient;
  doctorId: string;
  clinicId: string;
  clinicName?: string;
  doctorName?: string;
  userId?: string | null;
  actorRole?: "doctor" | "clinic";
  dutyDays: string[];
  weeklyShifts: Record<string, DoctorShift[]>;
  slotIntervalMinutes?: number | null;
  maxPatientsPerShift?: number;
  clinicOpenTime?: string;
  clinicCloseTime?: string;
  clinicOperatingDays?: string;
  clinicDefaultInterval?: number | null;
}

export interface SaveAuthorizedDoctorDutyScheduleResult {
  dutyDays: string[];
  dutySchedule: Record<string, any>;
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  weeklySchedule: DoctorWeeklySchedule;
  isOffDuty: boolean;
}

/**
 * Validates and persists a doctor's duty schedule for a specific clinic branch
 * through `save_authorized_doctor_duty_schedule` (with pre-save cross-clinic,
 * clinic operating hours, intra-day overlap, and active appointment checks),
 * and synchronizes local caches + window events across Doctor Portal, Clinic Portal, and Public Booking.
 */
export async function saveAuthorizedDoctorDutySchedule(
  params: SaveAuthorizedDoctorDutyScheduleParams
): Promise<SaveAuthorizedDoctorDutyScheduleResult> {
  const {
    client,
    doctorId,
    clinicId,
    clinicName = "Clinic",
    doctorName = "Doctor",
    userId,
    actorRole = "doctor",
    dutyDays,
    weeklyShifts,
    slotIntervalMinutes,
    maxPatientsPerShift,
    clinicOpenTime = "08:00",
    clinicCloseTime = "21:00",
    clinicOperatingDays,
    clinicDefaultInterval,
  } = params;

  if (!doctorId || !clinicId) {
    throw new Error("Doctor affiliation and clinic branch are required.");
  }

  const normalizedWeeklyShifts: Record<string, DoctorShift[]> = {};
  ALL_DAYS_OF_WEEK.forEach((d) => {
    normalizedWeeklyShifts[d] = [];
  });

  const requestedDays = ALL_DAYS_OF_WEEK.filter((day) =>
    dutyDays.some((d) => normalizeDayName(d) === day)
  );

  const isScheduleEmpty =
    requestedDays.length === 0 ||
    requestedDays.every((day) => !weeklyShifts[day] || weeklyShifts[day].length === 0);

  const finalDutyDays: string[] = isScheduleEmpty ? [] : requestedDays;

  if (!isScheduleEmpty) {
    for (const day of finalDutyDays) {
      const shifts = weeklyShifts[day] || [];
      if (shifts.length === 0) {
        throw new Error(`Please add at least one shift for ${day} or remove that duty day.`);
      }
      const shiftErrors = validateDoctorShifts(
        shifts,
        day,
        clinicOpenTime,
        clinicCloseTime,
        clinicOperatingDays
      );
      if (shiftErrors.length > 0) {
        throw new Error(shiftErrors[0].message);
      }
      normalizedWeeklyShifts[day] = shifts;
    }

    // Cross-clinic conflict check
    const otherBranches = await fetchDoctorOtherBranchSchedules(
      client,
      doctorId,
      clinicId,
      userId
    );
    const crossConflicts = findCrossClinicDutyConflicts(otherBranches, {
      doctorId,
      clinicId,
      doctorName,
      days: finalDutyDays,
      weeklyShifts: normalizedWeeklyShifts,
      perspective: actorRole === "doctor" ? "doctor" : "clinic",
    });
    if (crossConflicts.length > 0) {
      throw new Error(crossConflicts[0].message);
    }
  }

  // Active appointment & unexpired payment hold protection check
  try {
    const todayManila = getManilaNowParts().dateKey;
    const { data: appts, error: apptErr } = await client
      .from("patient_appointment")
      .select(
        "appointment_id, date, time, batch_time, status, doctor_status, payment_status, payment_hold_expires_at, payment_reference, patient_name"
      )
      .eq("clinic_id", clinicId)
      .eq("assigned_doctor_id", doctorId)
      .gte("date", `${todayManila}T00:00:00+08:00`)
      .neq("status", "cancelled")
      .neq("status", "rejected");

    if (!apptErr && Array.isArray(appts) && appts.length > 0) {
      const apptConflicts = findConflictingAppointmentsForDoctorSchedule(
        appts,
        {
          dutyDays: finalDutyDays,
          weeklyShifts: normalizedWeeklyShifts,
          slotIntervalMinutes: slotIntervalMinutes ?? clinicDefaultInterval ?? 30,
        },
        {
          defaultSlotIntervalMinutes: clinicDefaultInterval ?? 30,
          openTime: clinicOpenTime,
          closeTime: clinicCloseTime,
          operatingDays: clinicOperatingDays,
        }
      );
      if (apptConflicts.length > 0) {
        throw new Error(apptConflicts[0].message);
      }
    }
  } catch (err: any) {
    if (
      err instanceof Error &&
      (err.message.includes("Cannot save schedule because an existing appointment") ||
        err.message.includes("ERR_APPOINTMENT_CONFLICT"))
    ) {
      throw err;
    }
  }

  const effectiveInterval =
    (slotIntervalMinutes && Number(slotIntervalMinutes) > 0
      ? Number(slotIntervalMinutes)
      : undefined) ||
    (clinicDefaultInterval && Number(clinicDefaultInterval) > 0
      ? Number(clinicDefaultInterval)
      : 30);

  const serializedSchedule = serializeDoctorSchedule(
    {
      weeklyShifts: normalizedWeeklyShifts,
      slotIntervalMinutes: effectiveInterval,
      maxPatientsPerShift,
      isCustomSchedule: !isScheduleEmpty,
    },
    finalDutyDays,
    clinicDefaultInterval || undefined
  );

  const firstActiveDay = finalDutyDays[0];
  const firstShifts = firstActiveDay ? normalizedWeeklyShifts[firstActiveDay] || [] : [];
  const primaryStart = isScheduleEmpty
    ? null
    : firstShifts[0]?.startTime || clinicOpenTime || "08:00";
  const primaryEnd = isScheduleEmpty
    ? null
    : firstShifts[firstShifts.length - 1]?.endTime || clinicCloseTime || "17:00";

  // Execute database-enforced RPC
  const { data: rpcData, error: rpcError } = await client.rpc(
    "save_authorized_doctor_duty_schedule",
    {
      p_doctor_id: doctorId,
      p_clinic_id: clinicId,
      p_duty_days: finalDutyDays,
      p_duty_schedule: serializedSchedule,
      p_duty_start_time: primaryStart,
      p_duty_end_time: primaryEnd,
    }
  );

  if (rpcError) {
    const rawMsg = rpcError.message || "";
    const isMissingRpc =
      rawMsg.includes("Could not find the function") ||
      rawMsg.includes("function public.save_authorized_doctor_duty_schedule") ||
      rpcError.code === "PGRST202";

    if (!isMissingRpc) {
      const cleaned = rawMsg.replace(/^ERROR:\s*/i, "").replace(/^ERR_[A-Z0-9_]+:\s*/i, "");
      throw new Error(cleaned || "Failed to save duty schedule.");
    }

    // Fallback for environments where the migration has not yet been applied
    const { data: fallbackRow, error: fallbackError } = await client
      .from("clinic_doctor")
      .update({
        duty_days: finalDutyDays,
        duty_schedule: serializedSchedule,
        duty_start_time: primaryStart,
        duty_end_time: primaryEnd,
      })
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId)
      .select("doctor_id")
      .maybeSingle();

    if (fallbackError) {
      const cleaned = (fallbackError.message || "").replace(/^ERR_[A-Z0-9_]+:\s*/i, "");
      throw new Error(cleaned || "Failed to save duty schedule.");
    }
    if (!fallbackRow) {
      throw new Error("The clinic affiliation schedule could not be updated.");
    }
  } else if (rpcData && typeof rpcData === "object" && (rpcData as any).success === false) {
    throw new Error((rpcData as any).message || "Failed to save duty schedule.");
  }

  // Synchronize local storage caches if present so same-browser tabs reflect immediately
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("dermai_clinic_doctors")) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          let changed = false;
          const updated = parsed.map((doc: any) => {
            if (String(doc.id || doc.doctor_id) !== String(doctorId)) return doc;
            changed = true;
            return {
              ...doc,
              dutyDays: finalDutyDays,
              duty_days: finalDutyDays,
              dutyStartTime: primaryStart || "",
              duty_start_time: primaryStart,
              dutyEndTime: primaryEnd || "",
              duty_end_time: primaryEnd,
              dutySchedule: serializedSchedule,
              duty_schedule: serializedSchedule,
              slotIntervalMinutes: effectiveInterval,
            };
          });
          if (changed) {
            localStorage.setItem(key, JSON.stringify(updated));
          }
        }
      }
    } catch {
      // Ignore storage synchronization errors
    }

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(
      new CustomEvent("dermai_doctor_profile_updated", {
        detail: { doctorId, clinicId, dutyDays: finalDutyDays },
      })
    );
    window.dispatchEvent(
      new CustomEvent("dermai_doctors_updated", {
        detail: { doctorId, clinicId, dutyDays: finalDutyDays },
      })
    );
  }

  const totalShifts = Object.values(normalizedWeeklyShifts).flat().length;
  const cleanDocName = doctorName.replace(/^Dr\.?\s*/i, "").trim() || "Doctor";
  try {
    await client.from("system_audit_log").insert({
      user_id: userId || null,
      actor_type: actorRole,
      category: actorRole === "doctor" ? "doctor" : "clinic",
      action: "Doctor Schedule Updated",
      target: `Dr. ${cleanDocName} (${clinicName})`,
      details: isScheduleEmpty
        ? `Updated duty schedule for Dr. ${cleanDocName} at ${clinicName}: Off Duty (0 duty days, 0 shifts).`
        : `Updated duty schedule for Dr. ${cleanDocName} at ${clinicName}: ${finalDutyDays.join(", ")} (${totalShifts} shift${totalShifts === 1 ? "" : "s"}).`,
      metadata: {
        doctorId,
        clinicId,
        clinicName,
        doctorName: cleanDocName,
        dutyDays: finalDutyDays,
        shiftsCount: totalShifts,
        isOffDuty: isScheduleEmpty,
      },
    });
  } catch {
    // Non-blocking audit log
  }

  return {
    dutyDays: finalDutyDays,
    dutySchedule: serializedSchedule,
    dutyStartTime: primaryStart,
    dutyEndTime: primaryEnd,
    weeklySchedule: {
      weeklyShifts: normalizedWeeklyShifts,
      slotIntervalMinutes: effectiveInterval,
      maxPatientsPerShift,
      isCustomSchedule: !isScheduleEmpty,
    },
    isOffDuty: isScheduleEmpty,
  };
}
