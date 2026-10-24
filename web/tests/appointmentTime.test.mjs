import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAppointmentTime, resolveAppointmentTime } from '../src/lib/appointmentTime.ts';

test('formats both stored 24-hour and legacy 12-hour times', () => {
  for (const [input, expected] of [['09:00', '9:00 AM'], ['09:00:00', '9:00 AM'], ['9:00 AM', '9:00 AM'], [' 9:30 pm ', '9:30 PM'], ['00:00', '12:00 AM'], ['12:00', '12:00 PM'], ['23:59:59.123', '11:59 PM']]) {
    assert.equal(formatAppointmentTime(input), expected);
  }
});
test('invalid and missing times produce a fallback instead of NaN', () => {
  for (const input of [undefined, null, '', 'NaN', '9', '09:NaN', '24:00', '12:60', '09:00:60', '13:00 PM', '00:00 AM']) {
    assert.equal(formatAppointmentTime(input), 'Not scheduled');
  }
});

test('uses saved time or batch time before falling back to Manila schedule time', () => {
  assert.equal(resolveAppointmentTime('09:30:00', '10:00', '2026-10-27T03:00:00Z'), '09:30');
  assert.equal(resolveAppointmentTime('invalid', '10:00', '2026-10-27T03:00:00Z'), '10:00');
  assert.equal(resolveAppointmentTime('invalid', null, '2026-10-27T03:00:00Z'), '11:00');
  assert.equal(resolveAppointmentTime(null, null, '2026-10-27T09:30:00'), '09:30');
  assert.equal(resolveAppointmentTime(null, null, '2026-10-27'), '');
  assert.equal(resolveAppointmentTime('09:30:00+08:00', null, null), '09:30');
});
