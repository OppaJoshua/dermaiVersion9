import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fetchDoctorDutySchedule, parseAssignedDutySchedule } from '../src/lib/doctorDutySchedule.ts';

const assigned = {
  duty_days: ['Monday'],
  duty_schedule: { weeklyShifts: { Monday: [{ startTime: '08:00', endTime: '17:00' }] } },
};

test('missing, cleared, or unconfigured schedule never synthesizes registration hours', () => {
  for (const row of [null, {}, { duty_schedule: null, duty_days: ['Monday'], duty_start_time: '08:00', duty_end_time: '17:00' },
    { ...assigned, duty_schedule: {} }, { ...assigned, duty_schedule: { weeklyShifts: {} } },
    { ...assigned, duty_days: [] }, { ...assigned, duty_schedule: 'invalid JSON' }]) {
    assert.equal(parseAssignedDutySchedule(row), null);
  }
});

test('configured shifts remain branch-specific, including multiple shifts', () => {
  const result = parseAssignedDutySchedule(assigned);
  assert.equal(result.weeklyShifts.Monday[0].startTime, '08:00');
  assert.equal(result.weeklyShifts.Tuesday.length, 0);
  const split = parseAssignedDutySchedule({ duty_schedule: JSON.stringify({ Tuesday: [
    { startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '16:00' },
  ] }) });
  assert.equal(split.weeklyShifts.Tuesday.length, 2);
});

test('switch A to empty B to A uses both clinic and doctor filters and returns null for B', async () => {
  const urls = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(input);
      urls.push(url);
      return Response.json(url.searchParams.get('clinic_id') === 'eq.clinic-a' ? [assigned] : []);
    } },
  });
  assert.ok(await fetchDoctorDutySchedule(client, 'doctor-a', 'clinic-a', 'signed-in-user'));
  assert.equal(await fetchDoctorDutySchedule(client, 'doctor-b', 'clinic-b', 'signed-in-user'), null);
  assert.ok(await fetchDoctorDutySchedule(client, 'doctor-a', 'clinic-a', 'signed-in-user'));
  assert.equal(urls[1].searchParams.get('doctor_id'), 'eq.doctor-b');
  assert.equal(urls[1].searchParams.get('clinic_id'), 'eq.clinic-b');
  assert.equal(await fetchDoctorDutySchedule(client, '', 'clinic-a', 'signed-in-user'), null);
  assert.equal(await fetchDoctorDutySchedule(client, 'doctor-a', '', 'signed-in-user'), null);
  assert.equal(urls[1].searchParams.get('user_id'), 'eq.signed-in-user');
  assert.equal(await fetchDoctorDutySchedule(client, 'doctor-a', 'clinic-a', ''), null);
  assert.equal(urls.length, 3);
});
