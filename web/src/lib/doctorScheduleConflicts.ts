import {
  dutyTimesOverlap,
  formatTime12h,
  parseAssignedDoctorSchedule,
  type DoctorShift,
} from "./schedulingService.ts";

export interface ScheduleConflict {
  doctorName: string;
  otherClinicName: string;
  day: string;
  otherStartTime: string;
  otherEndTime: string;
  newStartTime: string;
  newEndTime: string;
  message: string;
  doctorPerspectiveMessage: string;
}

export interface DoctorDutyAssignment {
  doctor_id: string;
  clinic_id: string;
  duty_schedule?: unknown;
  duty_days?: unknown;
  duty_start_time?: string | null;
  duty_end_time?: string | null;
  clinic?: { name?: string } | null;
}

// These rows must come from get_owned_doctor_other_shifts or the doctor's own affiliated branches,
// which authorize the current affiliation and restrict results to the same doctor's user_id.
// Cross-clinic validation is intentional here; ordinary shift validation stays
// within the single doctor's submitted clinic/day schedule.
export function findCrossClinicDutyConflicts(
  assignments: DoctorDutyAssignment[],
  current: {
    doctorId: string;
    clinicId: string;
    doctorName: string;
    days: string[];
    weeklyShifts: Record<string, DoctorShift[]>;
    perspective?: "doctor" | "clinic";
  }
): ScheduleConflict[] {
  if (!current.doctorId || !current.clinicId || !current.days.length) return [];
  const conflicts: ScheduleConflict[] = [];
  const perspective = current.perspective || "clinic";

  for (const row of assignments) {
    // doctor_id is the affiliation's primary key in this schema. Exclude the
    // record being updated, even if a server response accidentally includes it.
    if (
      !row.doctor_id ||
      !row.clinic_id ||
      row.doctor_id === current.doctorId ||
      row.clinic_id === current.clinicId
    ) {
      continue;
    }
    const schedule = parseAssignedDoctorSchedule(row);
    if (!schedule) continue;
    const clinicName = row.clinic?.name || "Another Clinic";
    for (const day of current.days) {
      for (const proposed of current.weeklyShifts[day] || []) {
        for (const existing of schedule.weeklyShifts[day] || []) {
          if (!dutyTimesOverlap(existing.startTime, existing.endTime, proposed.startTime, proposed.endTime)) {
            continue;
          }
          const otherStartFormatted = formatTime12h(existing.startTime);
          const otherEndFormatted = formatTime12h(existing.endTime);
          const newStartFormatted = formatTime12h(proposed.startTime);
          const newEndFormatted = formatTime12h(proposed.endTime);
          const doctorPerspectiveMessage = `Schedule Conflict: You already have a duty schedule at ${clinicName} from ${otherStartFormatted} to ${otherEndFormatted} on ${day}.`;
          const clinicPerspectiveMessage = `${current.doctorName} is already on duty at ${clinicName} on ${day} from ${otherStartFormatted} to ${otherEndFormatted}.`;

          conflicts.push({
            doctorName: current.doctorName,
            otherClinicName: clinicName,
            day,
            otherStartTime: otherStartFormatted,
            otherEndTime: otherEndFormatted,
            newStartTime: newStartFormatted,
            newEndTime: newEndFormatted,
            doctorPerspectiveMessage,
            message: perspective === "doctor" ? doctorPerspectiveMessage : clinicPerspectiveMessage,
          });
        }
      }
    }
  }
  return conflicts;
}
