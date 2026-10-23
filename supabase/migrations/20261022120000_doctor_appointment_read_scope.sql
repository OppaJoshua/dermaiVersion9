-- Restrictive policies combine with existing permissive policies using AND.
-- This prevents an existing USING (true) policy from bypassing doctor isolation.
begin;

alter table public.patient_appointment enable row level security;

drop policy if exists doctor_appointment_read_scope on public.patient_appointment;
create policy doctor_appointment_read_scope
on public.patient_appointment
as restrictive
for select
to public
using (
  auth.uid() is not null
  and (
    public.current_role_name() is distinct from 'doctor'
    or exists (
      select 1
      from public.clinic_doctor cd
      where cd.user_id = auth.uid()
        and lower(cd.status) = 'active'
        and cd.clinic_id = patient_appointment.clinic_id
        and (
          patient_appointment.assigned_doctor_id is null
          or patient_appointment.assigned_doctor_id = cd.doctor_id
          or patient_appointment.assigned_doctor_id = auth.uid()
        )
    )
  )
);

create index if not exists idx_clinic_doctor_active_user_clinic
  on public.clinic_doctor(user_id, clinic_id, doctor_id)
  where lower(status) = 'active';

commit;
