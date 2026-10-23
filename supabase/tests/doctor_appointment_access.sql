-- Uses existing rows only. Session claims and temporary fixtures are rolled back.
-- Run through an authorized SQL administrator; no patient values are returned.
begin;
create temporary table doctor_scope_fixtures on commit drop as
select u.user_id,
  array(select distinct cd.clinic_id from public.clinic_doctor cd
    where cd.user_id = u.user_id and lower(cd.status) = 'active') as clinics,
  array(select pa.appointment_id from public.patient_appointment pa
    where exists (select 1 from public.clinic_doctor cd
      where cd.user_id = u.user_id and lower(cd.status) = 'active'
        and cd.clinic_id = pa.clinic_id
        and (pa.assigned_doctor_id is null or pa.assigned_doctor_id = cd.doctor_id
          or pa.assigned_doctor_id = u.user_id))) as expected_appointments
from public."user" u where u.role = 'doctor';
grant select on doctor_scope_fixtures to authenticated;

do $$ begin
  if not exists (select 1 from doctor_scope_fixtures where cardinality(clinics) > 1) then
    raise exception 'No multi-clinic doctor available: cannot validate branch switching';
  end if;
end $$;

set local role authenticated;
do $$
declare fixture record; visible_ids uuid[];
begin
  for fixture in select * from doctor_scope_fixtures loop
    perform set_config('request.jwt.claim.sub', fixture.user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', fixture.user_id, 'role', 'authenticated')::text, true);
    select coalesce(array_agg(appointment_id), '{}'::uuid[]) into visible_ids
      from public.patient_appointment;
    if not (visible_ids @> fixture.expected_appointments and visible_ids <@ fixture.expected_appointments) then
      raise exception 'Doctor RLS does not match authorized roster appointments';
    end if;
    if exists (select 1 from public.patient_appointment where not (clinic_id = any(fixture.clinics))) then
      raise exception 'Doctor can read appointments outside active affiliations';
    end if;
  end loop;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{}', true);
do $$ begin
  if exists (select 1 from public.patient_appointment) then
    raise exception 'Anonymous callers can read appointments';
  end if;
end $$;
reset role;
rollback;
select 'PASS: doctor RLS, branch isolation, and anonymous denial' as result;
