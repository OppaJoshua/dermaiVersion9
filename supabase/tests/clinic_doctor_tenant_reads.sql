-- Validate existing clinics under their owners' authenticated claims.
-- Temporary fixtures only; no permanent data or account changes.
begin;
create temporary table clinic_roster_fixtures on commit drop as
select c.clinic_id, c.owner_user_id,
  array(select d.doctor_id from public.clinic_doctor d where d.clinic_id = c.clinic_id) as expected_doctors,
  array(select d.doctor_id from public.clinic_doctor d join public.clinic owned on owned.clinic_id = d.clinic_id
    where owned.owner_user_id = c.owner_user_id) as all_owned_doctors,
  (select d.doctor_id from public.clinic_doctor d join public.clinic other on other.clinic_id = d.clinic_id
    where other.owner_user_id is distinct from c.owner_user_id limit 1) as foreign_doctor
from public.clinic c join public."user" u on u.user_id = c.owner_user_id and u.role = 'clinic';
create temporary table clinic_shift_fixtures on commit drop as
select d.doctor_id, c.owner_user_id,
  (select count(*) from public.clinic_doctor other where other.user_id = d.user_id
    and other.clinic_id <> d.clinic_id and lower(other.status) = 'active') as expected_shifts
from public.clinic_doctor d join public.clinic c on c.clinic_id = d.clinic_id
join public."user" u on u.user_id = c.owner_user_id and u.role = 'clinic';
grant select on clinic_roster_fixtures, clinic_shift_fixtures to authenticated;
do $$ begin
  if not exists (select 1 from clinic_roster_fixtures) then raise exception 'No clinic owners to test'; end if;
  -- Empty rosters are checked when present; do not require production data to
  -- contain one. The local query tests always cover an empty newly owned clinic.
end $$;
set local role authenticated;
do $$
declare f record; ids uuid[]; shifts jsonb; item jsonb;
begin
  for f in select * from clinic_roster_fixtures loop
    perform set_config('request.jwt.claim.sub', f.owner_user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', f.owner_user_id, 'role', 'authenticated')::text, true);
    select coalesce(array_agg(doctor_id), '{}'::uuid[]) into ids from public.clinic_doctor;
    if not (ids @> f.all_owned_doctors and ids <@ f.all_owned_doctors) then
      raise exception 'Unfiltered clinic roster read leaks or omits affiliations';
    end if;
    select coalesce(array_agg(doctor_id), '{}'::uuid[]) into ids from public.clinic_doctor where clinic_id = f.clinic_id;
    if not (ids @> f.expected_doctors and ids <@ f.expected_doctors) then
      raise exception 'Scoped roster or count does not match the active clinic';
    end if;
    if f.foreign_doctor is not null then
      begin
        perform public.get_owned_doctor_other_shifts(f.foreign_doctor);
        raise exception 'Shift RPC accepted an unaffiliated doctor';
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
  for f in select * from clinic_shift_fixtures loop
    perform set_config('request.jwt.claim.sub', f.owner_user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', f.owner_user_id, 'role', 'authenticated')::text, true);
    shifts := public.get_owned_doctor_other_shifts(f.doctor_id);
    if jsonb_array_length(shifts) <> f.expected_shifts then
      raise exception 'Cross-clinic duty conflict lookup regressed';
    end if;
    for item in select value from jsonb_array_elements(shifts) loop
      if item ?| array['email', 'prc_license', 'contact_number', 'photo_url', 'doctor_name'] then
        raise exception 'Shift RPC exposes private profile fields';
      end if;
    end loop;
  end loop;
end $$;
reset role;
rollback;
select 'PASS: clinic isolation/counts, own roster, and scoped conflict checks' as result;
