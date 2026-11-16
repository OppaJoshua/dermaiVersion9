import type { DoctorAppointmentRecord } from '../hooks/useDoctorAppointments';

export type HistoryTab = 'all' | 'completed' | 'approved' | 'pending' | 'rejected' | 'no-show';
export type PatientHistory = {
  id: string;
  latest: DoctorAppointmentRecord;
  appointments: DoctorAppointmentRecord[];
};

export function isNoShowAppointment(a?: Partial<DoctorAppointmentRecord> | { status?: string | null; check_in_status?: string | null; checkInStatus?: string | null } | null): boolean {
  if (!a) return false;
  const s = String(a.status || "").toLowerCase().replace(/_/g, "-");
  const c = String((a as any)?.checkInStatus || (a as any)?.check_in_status || "").toLowerCase().replace(/_/g, "-");
  return s === "no-show" || c === "no-show";
}

export function isPastHistoryRecord(
  appt?: Partial<DoctorAppointmentRecord> | { status?: string | null; doctorStatus?: string | null; doctor_status?: string | null; doctorDone?: boolean; checkInStatus?: string | null; check_in_status?: string | null } | null
): boolean {
  if (!appt) return false;
  if (isNoShowAppointment(appt)) return true;
  const s = String(appt.status || '').trim().toLowerCase();
  const ds = String((appt as any).doctorStatus || (appt as any).doctor_status || '').trim().toLowerCase();
  return (
    s === 'completed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'rejected' ||
    ds === 'rejected' ||
    Boolean(appt.doctorDone)
  );
}

export function historyStatus(a: DoctorAppointmentRecord): Exclude<HistoryTab, 'all'> {
  if (isNoShowAppointment(a)) return 'no-show';
  const s = String(a.status || '').trim().toLowerCase();
  const c = String(a.checkInStatus || '').trim().toLowerCase();
  const ds = String(a.doctorStatus || '').trim().toLowerCase();
  if (s === 'completed' || a.doctorDone || c === 'completed') return 'completed';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || ds === 'rejected') return 'rejected';
  if (ds === 'approved' || s === 'confirmed' || s === 'scheduled') return 'approved';
  return 'pending';
}

export function historyStatusLabel(a: DoctorAppointmentRecord): string {
  if (isNoShowAppointment(a)) return 'No-Show';
  const s = String(a.status || '').trim().toLowerCase();
  const c = String(a.checkInStatus || '').trim().toLowerCase();
  const ds = String(a.doctorStatus || '').trim().toLowerCase();
  if (c === 'arrived' || s === 'arrived') return 'Arrived';
  if ((s === 'cancelled' || s === 'canceled') && ds !== 'rejected' && historyStatus(a) === 'rejected') return 'Cancelled';
  return { completed: 'Completed', approved: 'Approved', pending: 'Pending Review', rejected: 'Declined', 'no-show': 'No-Show' }[historyStatus(a)] || 'Reviewed';
}

function visitTimestamp(a: DoctorAppointmentRecord): number {
  const schedule = a.date ? Date.parse(`${a.date.split('T')[0]}T${a.time || '00:00:00'}+08:00`) : NaN;
  return Number.isFinite(schedule) ? schedule : Date.parse(a.createdAt) || 0;
}

export function groupPatientHistory(records: DoctorAppointmentRecord[]): PatientHistory[] {
  const groups = new Map<string, Map<string, DoctorAppointmentRecord>>();
  for (const record of records) {
    // Unidentified walk-ins stay separate; names are not reliable patient identifiers.
    const id = record.patientId ? `patient:${record.patientId}` : record.userId ? `user:${record.userId}` : `appointment:${record.id}`;
    if (!groups.has(id)) groups.set(id, new Map());
    groups.get(id)!.set(record.id, record);
  }
  return Array.from(groups, ([id, visits]) => {
    const appointments = Array.from(visits.values()).sort((a, b) =>
      visitTimestamp(b) - visitTimestamp(a) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
    return { id, latest: appointments[0], appointments };
  }).sort((a, b) => visitTimestamp(b.latest) - visitTimestamp(a.latest) || a.id.localeCompare(b.id));
}

export function filterPatientHistory(patients: PatientHistory[], tab: HistoryTab, search = ''): PatientHistory[] {
  const query = search.trim().toLowerCase();
  return patients.filter(patient => patient.appointments.some(a =>
    (tab === 'all' || historyStatus(a) === tab) &&
    (!query || [a.patientName, a.patientEmail, a.doctorDiagnosis, a.conditionName, a.clinicName, a.notes, a.doctorNote]
      .some(value => value?.toLowerCase().includes(query)))));
}
