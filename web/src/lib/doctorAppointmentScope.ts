interface ScopeQuery {
  eq(column: string, value: string): unknown;
  or(filters: string): unknown;
}

// IDs must come from the authenticated doctor's active database affiliations.
// Mutate the PostgREST builder; callers must not execute it if this returns false.
export function scopeDoctorAppointments(
  query: ScopeQuery, selectedClinicId: string | null | undefined, clinicIds: string[], doctorIds: string[],
): boolean {
  if (!selectedClinicId || !clinicIds.includes(selectedClinicId) || !doctorIds.length) return false;
  query.eq("clinic_id", selectedClinicId);
  query.or(`assigned_doctor_id.is.null,assigned_doctor_id.in.(${doctorIds.join(",")})`);
  return true;
}

type DatedAppointment = { id: string; date: string; time: string; createdAt: string };

function minutes(time: string): number {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return 24 * 60;
  let hour = Number(match[1]);
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

export function compareDoctorAppointments(a: DatedAppointment, b: DatedAppointment): number {
  return (a.date || a.createdAt.slice(0, 10) || "9999").localeCompare(b.date || b.createdAt.slice(0, 10) || "9999")
    || minutes(a.time) - minutes(b.time)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}
