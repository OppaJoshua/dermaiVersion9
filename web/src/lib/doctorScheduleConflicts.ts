import { parseAssignedDutySchedule } from "./doctorDutySchedule.ts";
import { dutyTimesOverlap, formatTime12h, type DoctorShift } from "./schedulingService.ts";

export interface ScheduleConflict {
  doctorName: string;
  otherClinicName: string;
  day: string;
  otherStartTime: string;
  otherEndTime: string;
  newStartTime: string;
  newEndTime: string;
  message: string;
}

export interface DoctorDutyAssignment {
  doctor_id: string;
  clinic_id: string;
  duty_schedule?: unknown;
  duty_days?: unknown;
  clinic?: { name?: string } | null;
}

// These rows must come from get_owned_doctor_other_shifts, which authorizes the
// current affiliation and restricts results to the same doctor's user_id.
// Cross-clinic validation is intentional here; ordinary shift validation stays
// within the single doctor's submitted clinic/day schedule.
export function findCrossClinicDutyConflicts(
  assignments: DoctorDutyAssignment[],
  current: { doctorId: string; clinicId: string; doctorName: string; days: string[]; weeklyShifts: Record<string, DoctorShift[]> },
): ScheduleConflict[] {
  if (!current.doctorId || !current.clinicId || !current.days.length) return [];
  const conflicts: ScheduleConflict[] = [];
  for (const row of assignments) {
    // doctor_id is the affiliation's primary key in this schema. Exclude the
    // record being updated, even if a server response accidentally includes it.
    if (!row.doctor_id || !row.clinic_id || row.doctor_id === current.doctorId || row.clinic_id === current.clinicId) continue;
    const schedule = parseAssignedDutySchedule(row);
    if (!schedule) continue;
    const clinicName = row.clinic?.name || "Another Clinic";
    for (const day of current.days) {
      for (const proposed of current.weeklyShifts[day] || []) {
        for (const existing of schedule.weeklyShifts[day] || []) {
          if (!dutyTimesOverlap(existing.startTime, existing.endTime, proposed.startTime, proposed.endTime)) continue;
          conflicts.push({
            doctorName: current.doctorName, otherClinicName: clinicName, day,
            otherStartTime: formatTime12h(existing.startTime), otherEndTime: formatTime12h(existing.endTime),
            newStartTime: formatTime12h(proposed.startTime), newEndTime: formatTime12h(proposed.endTime),
            message: `${current.doctorName} is already on duty at ${clinicName} on ${day} from ${formatTime12h(existing.startTime)} to ${formatTime12h(existing.endTime)}.`,
          });
        }
      }
    }
  }
  return conflicts;
}
