import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { scopeDoctorAppointments, compareDoctorAppointments } from '../src/lib/doctorAppointmentScope.ts';

const clinics = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const doctors = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];

function clientWithRequests() {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url) => {
      requests.push(new URL(url));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, requests };
}

for (const selection of ['ALL', 'all', '', null, undefined]) {
  test(`invalid or missing clinic (${selection}) never issues a request`, () => {
    const { client, requests } = clientWithRequests();
    const query = client.from('patient_appointment').select('*');
    assert.equal(scopeDoctorAppointments(query, selection, clinics, doctors), false);
    assert.equal(requests.length, 0);
  });
}

test('single branch has an exact database filter', async () => {
  const { client, requests } = clientWithRequests();
  const query = client.from('patient_appointment').select('*');
  assert.equal(scopeDoctorAppointments(query, clinics[1], clinics, doctors), true);
  await query;
  assert.equal(requests[0].searchParams.get('clinic_id'), `eq.${clinics[1]}`);
  assert.match(requests[0].searchParams.get('or'), /assigned_doctor_id\.is\.null/);
});

test('missing affiliations, missing doctor IDs and unauthorized branches fail closed', () => {
  const { client, requests } = clientWithRequests();
  for (const [selection, clinicIds, doctorIds] of [['ALL', [], doctors], ['ALL', clinics, []], ['unauthorized', clinics, doctors]]) {
    assert.equal(scopeDoctorAppointments(client.from('patient_appointment').select('*'), selection, clinicIds, doctorIds), false);
  }
  assert.equal(requests.length, 0);
});

test('appointment sorting handles different dates, noon, midnight and AM/PM display values', () => {
  const make = (id, date, time) => ({ id, date, time, createdAt: '2026-10-20T00:00:00Z' });
  const sorted = [make('late', '2026-10-23', '08:00'), make('pm', '2026-10-22', '1:00 PM'),
    make('noon', '2026-10-22', '12:00 PM'), make('morning', '2026-10-22', '09:00:00'),
    make('midnight', '2026-10-22', '12:00 AM')].sort(compareDoctorAppointments);
  assert.deepEqual(sorted.map(a => a.id), ['midnight', 'morning', 'noon', 'pm', 'late']);
});
