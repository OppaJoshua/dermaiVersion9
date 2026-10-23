begin;
create temporary table branch_read_fixtures on commit drop as
select u.user_id,
  array(select cd.doctor_id from public.clinic_doctor cd where cd.user_id = u.user_id) as owned_rows,
  array(select distinct cd.clinic_id from public.clinic_doctor cd where cd.user_id = u.user_id and lower(cd.status) = 'active') as active_branches
from public."user" u where u.role = 'doctor';
grant select on branch_read_fixtures to authenticated;
do $$ begin
  if not exists (select 1 from branch_read_fixtures) then raise exception 'No doctor accounts to validate'; end if;
end $$;
set local role authenticated;
do $$
declare fixture record; visible_rows uuid[]; branches uuid[];
begin
  for fixture in select * from branch_read_fixtures loop
    perform set_config('request.jwt.claim.sub', fixture.user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', fixture.user_id, 'role', 'authenticated')::text, true);
    select coalesce(array_agg(doctor_id), '{}'::uuid[]) into visible_rows from public.clinic_doctor;
    if not (visible_rows @> fixture.owned_rows and visible_rows <@ fixture.owned_rows) then
      raise exception 'Doctor can read another account affiliation or cannot read own affiliation';
    end if;
    select coalesce(array_agg(distinct cd.clinic_id), '{}'::uuid[]) into branches
      from public.clinic_doctor cd join public.clinic c on c.clinic_id = cd.clinic_id
      where cd.user_id = fixture.user_id and lower(cd.status) = 'active';
    if not (branches @> fixture.active_branches and branches <@ fixture.active_branches) then
      raise exception 'Branch dropdown does not match active assignments';
    end if;
  end loop;
end $$;
reset role;
rollback;
select 'PASS: own doctor affiliations, active branch counts, and clinic metadata joins' as result;
