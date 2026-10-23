begin;
alter table public.clinic_doctor enable row level security;

-- doctor_id identifies a clinic's roster entry; user_id links it to auth.users.
-- This restriction also applies when callers omit the user_id query filter.
drop policy if exists doctor_own_affiliation_reads on public.clinic_doctor;
create policy doctor_own_affiliation_reads on public.clinic_doctor
as restrictive for select to public
using (
  public.current_role_name() is distinct from 'doctor'
  or user_id = auth.uid()
);
commit;
