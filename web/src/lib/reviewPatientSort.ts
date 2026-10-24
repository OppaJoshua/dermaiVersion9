type ReviewRecord = {
  id: string;
  requestedAt?: string;
  createdAt: string;
  doctorReviewedAt?: string;
  updatedAt?: string;
  appointmentHistory?: { action: string; timestamp: string }[];
};

function timestamp(value?: string): number | undefined {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : undefined;
}

function reviewTimestamp(record: ReviewRecord): number {
  const reviewed = timestamp(record.doctorReviewedAt);
  if (reviewed !== undefined) return reviewed;
  const decisions = (record.appointmentHistory || [])
    .filter(event => ['doctor_reviewed', 'doctor_approved', 'doctor_rejected', 'completed', 'cancelled'].includes(event.action))
    .map(event => timestamp(event.timestamp))
    .filter((value): value is number => value !== undefined);
  return decisions.length ? Math.max(...decisions) : timestamp(record.updatedAt) ?? timestamp(record.createdAt) ?? -Infinity;
}

export function compareReviewPatients(a: ReviewRecord, b: ReviewRecord, tab: 'pending' | 'reviewed'): number {
  const dateOf = tab === 'reviewed' ? reviewTimestamp : (record: ReviewRecord) =>
    timestamp(record.requestedAt) ?? timestamp(record.createdAt) ?? -Infinity;
  const first = dateOf(a);
  const second = dateOf(b);
  return first === second ? a.id.localeCompare(b.id) : first > second ? -1 : 1;
}
