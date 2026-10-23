import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fetchClinicDoctorRows } from '../src/lib/clinicDoctorRoster.ts';

function fixture({ owned = true, doctors = [], fail = false } = {}) {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith('/clinic')) {
        return Response.json(owned ? [{ clinic_id: 'clinic-a' }] : []);
      }
      if (fail) return Response.json({ message: 'Unavailable', code: 'TEST_ERROR' }, { status: 500 });
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 500);
      return Response.json(doctors.slice(offset, offset + limit));
    } },
  });
  return { client, requests };
}

test('unresolved clinic or signed-out session never queries the roster', async () => {
  const { client, requests } = fixture();
  assert.deepEqual(await fetchClinicDoctorRows(client, null, 'owner', '*'), []);
  assert.deepEqual(await fetchClinicDoctorRows(client, 'clinic-a', undefined, '*'), []);
  assert.equal(requests.length, 0);
});

test('cached clinic from a different owner is rejected before roster fetch', async () => {
  const { client, requests } = fixture({ owned: false });
  assert.deepEqual(await fetchClinicDoctorRows(client, 'clinic-a', 'owner-b', '*'), []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('owner_user_id'), 'eq.owner-b');
  assert.equal(requests[0].searchParams.get('clinic_id'), 'eq.clinic-a');
});

test('new clinic returns an empty list and zero count', async () => {
  const { client, requests } = fixture();
  const rows = await fetchClinicDoctorRows(client, 'clinic-a', 'owner', '*');
  assert.equal(rows.length, 0);
  assert.equal(requests[1].searchParams.get('clinic_id'), 'eq.clinic-a');
});

test('existing clinic loads its roster with the requested profile joins', async () => {
  const { client, requests } = fixture({ doctors: [{ doctor_id: 'own-doctor' }] });
  const rows = await fetchClinicDoctorRows(client, 'clinic-a', 'owner', 'doctor_id, doctor_specializations(specializations(id,name))');
  assert.deepEqual(rows.map(row => row.doctor_id), ['own-doctor']);
  assert.equal(requests[1].searchParams.get('clinic_id'), 'eq.clinic-a');
  assert.match(requests[1].searchParams.get('select'), /doctor_specializations/);
});

test('fetch errors propagate instead of restoring another clinic from cache', async () => {
  const { client } = fixture({ fail: true });
  await assert.rejects(fetchClinicDoctorRows(client, 'clinic-a', 'owner', '*'));
});

test('pagination keeps the clinic filter and counts every affiliated doctor', async () => {
  const doctors = Array.from({ length: 501 }, (_, index) => ({ doctor_id: String(index) }));
  const { client, requests } = fixture({ doctors });
  const rows = await fetchClinicDoctorRows(client, 'clinic-a', 'owner', '*');
  assert.equal(rows.length, 501);
  assert.equal(requests.length, 3);
  for (const url of requests.slice(1)) assert.equal(url.searchParams.get('clinic_id'), 'eq.clinic-a');
});
