import type { DoctorAppointmentRecord } from '../hooks/useDoctorAppointments';

export type HistoryTab = 'all' | 'completed' | 'approved' | 'pending' | 'rejected';
export type PatientHistory = {
  id: string;
  latest: DoctorAppointmentRecord;
  appointments: DoctorAppointmentRecord[];
};

export function historyStatus(a: DoctorAppointmentRecord): Exclude<HistoryTab, 'all'> {
  if (a.status === 'completed' || a.doctorDone) return 'completed';
  if (a.status === 'rejected' || a.status === 'cancelled' || a.doctorStatus === 'rejected') return 'rejected';
  if (a.doctorStatus === 'approved' || a.status === 'confirmed' || a.status === 'scheduled') return 'approved';
  return 'pending';
}

export function historyStatusLabel(a: DoctorAppointmentRecord): string {
  if (a.status === 'cancelled' && historyStatus(a) === 'rejected') return 'Cancelled';
  return { completed: 'Completed', approved: 'Approved', pending: 'Pending Review', rejected: 'Declined' }[historyStatus(a)];
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
