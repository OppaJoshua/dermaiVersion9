// Read-only live probe. Never prints credentials or patient data.
// Run: node --env-file=.env scripts/check-doctor-appointment-access.mjs
// An optional SUPABASE_DOCTOR_ACCESS_TOKEN enables the authenticated checks.
import { createClient } from '@supabase/supabase-js';
import { scopeDoctorAppointments } from '../src/lib/doctorAppointmentScope.ts';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Supabase URL and public key are required.');
const token = process.env.SUPABASE_DOCTOR_ACCESS_TOKEN;
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
});
if (!token) {
  const { count, error, status } = await client.from('patient_appointment')
    .select('appointment_id', { head: true, count: 'exact' });
  if (error) throw new Error(`Anonymous access probe failed (HTTP ${status}, code ${error.code || 'unknown'}).`);
  console.log(JSON.stringify({ anonymousCanReadAppointmentRows: (count || 0) > 0, authenticatedDoctorChecks: 'Skipped: no doctor session token available' }));
} else {
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error('The doctor session is invalid.');
  const { data: affiliations, error } = await client.from('clinic_doctor')
    .select('doctor_id, clinic_id').eq('user_id', auth.user.id).ilike('status', 'active');
  if (error) throw new Error(`Affiliation query failed (${error.code}).`);
  const clinics = [...new Set((affiliations || []).map(row => row.clinic_id))];
  const doctors = [auth.user.id, ...(affiliations || []).map(row => row.doctor_id)];
  if (!clinics.length) throw new Error('No active doctor affiliations are available to test.');
  for (const selection of clinics) {
    const query = client.from('patient_appointment').select('appointment_id', { head: true, count: 'exact' });
    if (!scopeDoctorAppointments(query, selection, clinics, doctors)) throw new Error('Scope could not be resolved.');
    const { error } = await query;
    if (error) throw new Error(`Scoped query failed (${error.code}).`);
  }
  // Deliberately omit branch filters to verify the database itself blocks other clinics.
  const { count: outsideCount, error: outsideError } = await client.from('patient_appointment')
    .select('appointment_id', { head: true, count: 'exact' })
    .not('clinic_id', 'in', `(${clinics.join(',')})`);
  if (outsideError || outsideCount !== 0) throw new Error('Database isolation check failed for clinics outside the doctor affiliations.');
  console.log(JSON.stringify({ authenticatedDoctorChecks: 'Passed', branchCount: clinics.length, singleClinicQueries: true, outsideClinicRows: 0 }));
}
