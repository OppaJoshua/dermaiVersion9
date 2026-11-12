import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPatientHistory, filterPatientHistory, historyStatus, historyStatusLabel, isNoShowAppointment } from '../src/lib/patientHistory.ts';
const visit = (id, userId, status, date, extra = {}) => ({ id, userId, status, date, time: '09:00', createdAt: '2026-01-01T00:00:00Z', patientName: 'Same Name', clinicName: 'Clinic', notes: '', ...extra });

test('groups by identity, deduplicates visits, and sorts newest schedule first without mutating input', () => {
  const old = visit('old', 'a', 'completed', '2026-01-01');
  const latest = visit('new', 'a', 'pending', '2026-10-27');
  const input = [old, visit('other', 'b', 'confirmed', '2026-05-01'), latest, old];
  const patients = groupPatientHistory(input);
  assert.equal(patients.length, 2);
  assert.equal(patients[0].latest.id, 'new');
  assert.deepEqual(patients[0].appointments.map(a => a.id), ['new', 'old']);
  assert.equal(input[0], old);
});

test('status and search filters count unique patients but retain their full history', () => {
  const patients = groupPatientHistory([
    visit('1', 'a', 'completed', '2026-01-01', { doctorDiagnosis: 'Acne' }),
    visit('2', 'a', 'pending', '2026-02-01'),
    visit('3', 'a', 'completed', '2026-03-01'),
    visit('4', 'b', 'confirmed', '2026-04-01'),
  ]);
  const filtered = filterPatientHistory(patients, 'completed', 'acne');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].appointments.length, 3);
  assert.equal(filterPatientHistory(patients, 'pending').length, 1);
  assert.equal(filterPatientHistory(patients, 'approved').length, 1);
  assert.equal(filterPatientHistory(patients, 'approved', 'acne').length, 0);
});

test('missing identity does not merge unrelated walk-ins and patient IDs are supported', () => {
  assert.equal(groupPatientHistory([visit('1', undefined, 'pending', ''), visit('2', undefined, 'pending', '')]).length, 2);
  assert.equal(groupPatientHistory([visit('1', undefined, 'pending', '', { patientId: 'p' }), visit('2', undefined, 'pending', '', { patientId: 'p' })]).length, 1);
});

test('terminal statuses take precedence over stale approval, and createdAt is a schedule fallback', () => {
  assert.equal(historyStatus(visit('1', 'a', 'cancelled', '', { doctorStatus: 'approved' })), 'rejected');
  assert.equal(historyStatus(visit('2', 'a', 'pending', '', { doctorDone: true })), 'completed');
  assert.equal(historyStatus(visit('3', 'a', 'pending', '', { doctorStatus: 'rejected' })), 'rejected');
  const result = groupPatientHistory([visit('1', 'a', 'pending', '', { createdAt: '2026-02-01T00:00:00Z' }), visit('2', 'a', 'pending', '2026-01-01')]);
  assert.equal(result[0].latest.id, '1');
});

test('No-Show visits are prioritized over completed/confirmed and clearly distinguished', () => {
  // 1. Explicit No-Show marker with status confirmed
  const noShowAppt = visit('ns1', 'u1', 'confirmed', '2026-03-01', { checkInStatus: 'no-show' });
  assert.equal(isNoShowAppointment(noShowAppt), true);
  assert.equal(historyStatus(noShowAppt), 'no-show');
  assert.equal(historyStatusLabel(noShowAppt), 'No-Show');

  // 2. Explicit No-Show marker takes precedence over stale doctorDone
  const staleDoneAppt = visit('ns2', 'u1', 'confirmed', '2026-03-02', { checkInStatus: 'no-show', doctorDone: true });
  assert.equal(historyStatus(staleDoneAppt), 'no-show');

  // 3. Genuine Completed consultation
  const completedAppt = visit('c1', 'u1', 'completed', '2026-03-03', { doctorDone: true });
  assert.equal(isNoShowAppointment(completedAppt), false);
  assert.equal(historyStatus(completedAppt), 'completed');
  assert.equal(historyStatusLabel(completedAppt), 'Completed');

  // 4. Genuine Cancelled appointment
  const cancelledAppt = visit('cx1', 'u1', 'cancelled', '2026-03-04');
  assert.equal(isNoShowAppointment(cancelledAppt), false);
  assert.equal(historyStatus(cancelledAppt), 'rejected');
  assert.equal(historyStatusLabel(cancelledAppt), 'Cancelled');
});

test('patient grouping with mixed Completed and No-Show visits isolates tab counts and latest record', () => {
  const v1 = visit('v1', 'patientA', 'completed', '2026-01-10', { doctorDone: true });
  const v2 = visit('v2', 'patientA', 'completed', '2026-02-15', { doctorDone: true });
  const v3 = visit('v3', 'patientA', 'confirmed', '2026-03-20', { checkInStatus: 'no-show' });

  const allHistory = [v1, v2, v3];

  // Completed list only
  const completedList = allHistory.filter(a => !isNoShowAppointment(a) && (a.status === 'completed' || a.doctorDone));
  const completedGroups = groupPatientHistory(completedList);
  assert.equal(completedGroups.length, 1);
  assert.equal(completedGroups[0].appointments.length, 2);
  assert.equal(completedGroups[0].latest.id, 'v2');
  assert.equal(historyStatusLabel(completedGroups[0].latest), 'Completed');

  // No-Show list only
  const noShowList = allHistory.filter(a => isNoShowAppointment(a));
  const noShowGroups = groupPatientHistory(noShowList);
  assert.equal(noShowGroups.length, 1);
  assert.equal(noShowGroups[0].appointments.length, 1);
  assert.equal(noShowGroups[0].latest.id, 'v3');
  assert.equal(historyStatusLabel(noShowGroups[0].latest), 'No-Show');

  // All history
  const allGroups = groupPatientHistory(allHistory);
  assert.equal(allGroups.length, 1);
  assert.equal(allGroups[0].appointments.length, 3);
  assert.equal(allGroups[0].latest.id, 'v3');
});
