import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fetchDoctorBranches, resolveDoctorBranch } from '../src/lib/doctorBranches.ts';

const branch = (id, name = id) => ({ doctor_id: `doctor-${id}`, clinic_id: id, doctor_name: 'Doctor', clinic: { clinic_id: id, name, address: 'Branch address', status: 'approved' } });

test('zero branches has no active selection', () => {
  assert.equal(resolveDoctorBranch('ALL', []), '');
  assert.equal(resolveDoctorBranch('stale-clinic', []), '');
});
test('one branch always defaults to its own ID', () => {
  assert.equal(resolveDoctorBranch('ALL', [branch('a')]), 'a');
  assert.equal(resolveDoctorBranch('another-account-clinic', [branch('a')]), 'a');
});
test('multiple branches preserve a valid selection and reject removed branches', () => {
  const branches = [branch('a'), branch('b')];
  assert.equal(resolveDoctorBranch('b', branches), 'b');
  assert.equal(resolveDoctorBranch('all', branches), 'all');
  assert.equal(resolveDoctorBranch('', branches), 'all');
  assert.equal(resolveDoctorBranch('ALL', branches), 'all');
  assert.equal(resolveDoctorBranch('removed', branches), 'all');
  assert.equal(resolveDoctorBranch('b', [branch('a')]), 'a');
});
test('fetch is authenticated-user scoped, active-only, deduplicated, and joins branch metadata', async () => {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      requests.push(new URL(input));
      return Response.json([branch('b', 'Skin Clinic'), branch('a', 'DERMCARE'), branch('b', 'duplicate'), { ...branch('deleted'), clinic: null }]);
    } },
  });
  assert.deepEqual(await fetchDoctorBranches(client), []);
  assert.equal(requests.length, 0);
  const result = await fetchDoctorBranches(client, 'authenticated-doctor');
  assert.deepEqual(result.map(row => row.clinic_id), ['b', 'a']);
  assert.equal(result[0].clinic.address, 'Branch address');
  assert.equal(result[0].clinic.status, 'approved');
  assert.equal(requests[0].searchParams.get('user_id'), 'eq.authenticated-doctor');
  assert.equal(requests[0].searchParams.get('status'), 'ilike.active');
  assert.match(requests[0].searchParams.get('select'), /clinic:clinic_id\(clinic_id,name,address,status,logo_url\)/);
});

test('clinic logos use saved URLs or resolve paths through the configured storage client', async () => {
  const logos = ['https://images.example.com/clinic.jpg', 'logos/clinic.jpg', 'clinic-photos/logos/clinic.jpg', null, '   '];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => Response.json(logos.map((logo_url, i) => {
      const row = branch(String(i));
      row.photo_url = 'https://images.example.com/doctor.jpg';
      row.clinic.logo_url = logo_url;
      return row;
    })) },
  });
  const result = await fetchDoctorBranches(client, 'doctor');
  assert.deepEqual(result.map(row => row.clinic.logo_url), [
    logos[0],
    'https://example.supabase.co/storage/v1/object/public/clinic-photos/logos/clinic.jpg',
    'https://example.supabase.co/storage/v1/object/public/clinic-photos/logos/clinic.jpg',
    null,
    null,
  ]);
  assert.equal(result[0].photo_url, 'https://images.example.com/doctor.jpg');
});
test('database errors are reported rather than using cached assignments', async () => {
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => Response.json({ message: 'Denied', code: '42501' }, { status: 403 }) },
  });
  await assert.rejects(fetchDoctorBranches(client, 'doctor'));
});
