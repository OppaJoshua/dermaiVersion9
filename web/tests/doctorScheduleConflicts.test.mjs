import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCrossClinicDutyConflicts } from '../src/lib/doctorScheduleConflicts.ts';
import { dutyTimesOverlap, findConflictingDoctorSchedules, validateDoctorShifts } from '../src/lib/schedulingService.ts';

const shift = { id: 'current-shift', startTime: '09:00', endTime: '12:00' };
const current = { doctorId: 'affiliation-a', clinicId: 'clinic-a', doctorName: 'Doctor from session', days: ['Monday'], weeklyShifts: { Monday: [shift] } };
// Fixtures stand for rows returned by the same-user, owner-authorized RPC.
const other = {
  doctor_id: 'affiliation-b', clinic_id: 'clinic-b', clinic: { name: 'Other branch' },
  duty_days: ['Monday'], duty_schedule: { weeklyShifts: { Monday: [{ startTime: '10:00', endTime: '13:00' }] } },
};

test('empty assignments and registration defaults never create a conflict', () => {
  assert.deepEqual(findCrossClinicDutyConflicts([], current), []);
  for (const duty_schedule of [null, undefined, {}, '', 'invalid JSON', { weeklyShifts: {} }]) {
    assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, duty_schedule, duty_start_time: '08:00', duty_end_time: '17:00' }], current), []);
  }
  assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, duty_days: [] }], current), []);
  assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, duty_days: '[]' }], current), []);
});

test('only submitted shifts on assigned matching days are compared', () => {
  assert.equal(findCrossClinicDutyConflicts([other], current).length, 1);
  assert.deepEqual(findCrossClinicDutyConflicts([other], { ...current, weeklyShifts: {} }), []);
  assert.deepEqual(findCrossClinicDutyConflicts([other], { ...current, days: ['Tuesday'] }), []);
  assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, duty_days: ['Tuesday'] }], current), []);
});

test('current affiliation is excluded on updates and same-clinic rows are ignored', () => {
  assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, doctor_id: current.doctorId }], current), []);
  assert.deepEqual(findCrossClinicDutyConflicts([{ ...other, clinic_id: current.clinicId }], current), []);
  assert.deepEqual(findCrossClinicDutyConflicts([other], { ...current, clinicId: '' }), []);
});

test('null, empty, malformed, reversed and out-of-range times never overlap', () => {
  for (const time of [null, undefined, '', ' ', 'garbage', '25:00', '09:60', '9:1', '09:00:60']) {
    assert.equal(dutyTimesOverlap(time, '12:00', '09:00', '10:00'), false);
    assert.equal(dutyTimesOverlap('09:00', time, '09:00', '10:00'), false);
    assert.equal(dutyTimesOverlap('09:00', '12:00', time, '10:00'), false);
    assert.equal(dutyTimesOverlap('09:00', '12:00', '09:00', time), false);
  }
  assert.equal(dutyTimesOverlap('12:00', '09:00', '10:00', '11:00'), false);
});

test('strict overlap allows adjacent shifts and compares normalized time values', () => {
  assert.equal(dutyTimesOverlap('08:00', '09:00', '09:00', '12:00'), false);
  assert.equal(dutyTimesOverlap('12:00', '14:00', '09:00', '12:00'), false);
  assert.equal(dutyTimesOverlap('9:00', '12:00:00', '10:00', '11:00'), true);
  assert.equal(dutyTimesOverlap('08:00', '17:00', '10:00', '11:00'), true);
});

test('within-day validation bypasses empty days, excludes self, and catches real overlaps', () => {
  assert.deepEqual(validateDoctorShifts([], 'Sunday', '08:00', '17:00', 'Monday - Friday'), []);
  assert.deepEqual(validateDoctorShifts([shift, { ...shift }], 'Monday'), []);
  assert.equal(validateDoctorShifts([shift, { id: 'second', startTime: '11:00', endTime: '13:00' }], 'Monday').length, 1);
  assert.match(validateDoctorShifts([{ ...shift, startTime: '' }], 'Monday')[0].message, /valid start and end/);
});

test('clinic-hour changes ignore unassigned doctors and retain actual conflicts', () => {
  const options = { clinicOpenTime: '10:00', clinicCloseTime: '16:00', clinicOperatingDays: 'Monday - Friday' };
  assert.deepEqual(findConflictingDoctorSchedules({ ...options, doctors: [{ doctor_id: 'unassigned', duty_days: ['Monday'], duty_start_time: '08:00', duty_end_time: '17:00', duty_schedule: null }] }), []);
  const conflicts = findConflictingDoctorSchedules({ ...options, doctors: [other] });
  assert.equal(conflicts.length, 0);
  assert.equal(findConflictingDoctorSchedules({ ...options, clinicOpenTime: '11:00', doctors: [other] }).length, 1);
});
