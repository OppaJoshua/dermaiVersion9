begin;
alter table public.clinic_doctor enable row level security;

-- Restrictive so the existing permissive clinic_doctor_all policy cannot bypass it.
-- Other portal roles retain their existing reads (including doctor Master View).
drop policy if exists clinic_owner_roster_reads on public.clinic_doctor;
create policy clinic_owner_roster_reads on public.clinic_doctor
as restrictive for select to public
using (
  public.current_role_name() is distinct from 'clinic'
  or public.is_clinic_owner(clinic_id)
);

-- Clinic owners may check scheduling conflicts for a doctor on their own roster.
-- Only shift metadata is returned, never another clinic's full doctor profile.
create or replace function public.get_owned_doctor_other_shifts(target_doctor_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare target_user_id uuid; target_clinic_id uuid;
begin
  select cd.user_id, cd.clinic_id into target_user_id, target_clinic_id
  from public.clinic_doctor cd
  join public.clinic c on c.clinic_id = cd.clinic_id
  where cd.doctor_id = target_doctor_id and c.owner_user_id = auth.uid();
  if not found then
    raise exception 'Doctor is not affiliated with a clinic you own' using errcode = '42501';
  end if;
  if target_user_id is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'clinic_id', cd.clinic_id, 'doctor_id', cd.doctor_id,
      'duty_days', cd.duty_days, 'duty_start_time', cd.duty_start_time,
      'duty_end_time', cd.duty_end_time, 'duty_schedule', cd.duty_schedule,
      'clinic', jsonb_build_object('name', c.name)
    )) from public.clinic_doctor cd
    join public.clinic c on c.clinic_id = cd.clinic_id
    where cd.user_id = target_user_id and cd.clinic_id <> target_clinic_id
      and lower(cd.status) = 'active'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_owned_doctor_other_shifts(uuid) from public, anon;
grant execute on function public.get_owned_doctor_other_shifts(uuid) to authenticated;
commit;
