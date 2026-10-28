-- ============================================================================
-- Migration: 20261026_harden_appointment_rls.sql
-- Description: Hardens appointment Row-Level Security (RLS) policies, protects
--              against patient field tampering (clinic_id, doctor_status, user_id),
--              disables legacy simulated payment bypass, hardens clinic owner
--              authorization against whitespace/empty email spoofing, provides a
--              privacy-preserving occupied slots RPC with date horizon bounds,
--              and preserves verified PayMongo webhook processing and doctor/clinic
--              workflows.
-- ============================================================================

begin;

-- 1. Ensure RLS is active on patient_appointment
alter table public.patient_appointment enable row level security;

-- 2. Drop all legacy, unsafe, or overlapping policies on patient_appointment
drop policy if exists "appt_all_access" on public.patient_appointment;
drop policy if exists "appt_patient_read" on public.patient_appointment;
drop policy if exists "appt_patient_insert" on public.patient_appointment;
drop policy if exists "appt_patient_cancel" on public.patient_appointment;
drop policy if exists "appt_clinic_manage" on public.patient_appointment;
drop policy if exists "appt_doctor_manage" on public.patient_appointment;
drop policy if exists "appt_doctor_read" on public.patient_appointment;
drop policy if exists doctor_appointment_read_scope on public.patient_appointment;

-- Drop newly declared policies if they exist (idempotence)
drop policy if exists appt_patient_select on public.patient_appointment;
drop policy if exists appt_doctor_select on public.patient_appointment;
drop policy if exists appt_clinic_select on public.patient_appointment;
drop policy if exists appt_admin_select on public.patient_appointment;

drop policy if exists appt_patient_insert on public.patient_appointment;
drop policy if exists appt_clinic_insert on public.patient_appointment;
drop policy if exists appt_admin_insert on public.patient_appointment;

drop policy if exists appt_patient_update on public.patient_appointment;
drop policy if exists appt_doctor_update on public.patient_appointment;
drop policy if exists appt_clinic_update on public.patient_appointment;
drop policy if exists appt_admin_update on public.patient_appointment;

drop policy if exists appt_patient_delete on public.patient_appointment;
drop policy if exists appt_clinic_delete on public.patient_appointment;
drop policy if exists appt_admin_delete on public.patient_appointment;

-- ============================================================================
-- 3. Robust authorization helper functions
-- ============================================================================

-- 3a. Clinic Owner / Staff authorization helper:
-- Prefers explicit, verified ownership (owner_user_id).
-- Fallback to email matching ONLY when owner_user_id is not set, strictly
-- rejecting empty or whitespace-only clinic emails and unverified accounts.
create or replace function public.is_clinic_owner(target_clinic_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic c
    where c.clinic_id = target_clinic_id
      and (
        -- Primary: explicit verified owner relation
        c.owner_user_id = auth.uid()
        -- Fallback: only if owner_user_id is null, match active clinic user with verified non-empty email
        or (
          c.owner_user_id is null
          and nullif(trim(c.email), '') is not null
          and exists (
            select 1
            from public."user" u
            where u.user_id = auth.uid()
              and u.role = 'clinic'
              and u.account_status = 'active'
              and nullif(trim(u.email), '') is not null
              and lower(trim(u.email)) = lower(trim(c.email))
          )
        )
      )
  );
$$;

grant execute on function public.is_clinic_owner(uuid) to authenticated, anon, service_role;

-- 3b. Active Doctor appointment scope helper
create or replace function public.is_active_doctor_for_appointment(target_clinic_id uuid, target_doctor_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.clinic_doctor cd
    where cd.user_id = auth.uid()
      and lower(cd.status) = 'active'
      and cd.clinic_id = target_clinic_id
      and (
        target_doctor_id is null
        or target_doctor_id = cd.doctor_id
        or target_doctor_id = auth.uid()
      )
  );
$$;

grant execute on function public.is_active_doctor_for_appointment(uuid, uuid) to authenticated, anon, service_role;

-- ============================================================================
-- 4. Field Tampering & Payment Protection Trigger
-- ============================================================================

create or replace function public.trg_protect_appointment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_internal text;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_role text;
  v_is_doctor boolean;
  v_is_clinic_owner boolean;
  v_cal_date date;
  v_lock_key bigint;
  v_next_q integer;
begin
  -- Resolve service_role and administrator privileges
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');

  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  -- 1. IMMUTABLE FIELDS: clinic_id and user_id cannot be altered on existing appointments
  -- Enforced across ALL callers (including internal context) except administrators
  if TG_OP = 'UPDATE' then
    if NEW.clinic_id is distinct from OLD.clinic_id and not v_is_admin then
      raise exception 'ERR_FORBIDDEN: Modifying appointment clinic_id is prohibited.';
    end if;

    if NEW.user_id is distinct from OLD.user_id and not v_is_admin then
      raise exception 'ERR_FORBIDDEN: Modifying appointment user_id is prohibited.';
    end if;
  end if;

  -- 2. Allow trusted service_role execution (e.g. PayMongo webhook, Supabase Admin)
  if v_is_service_role then
    return NEW;
  end if;

  -- 3. Allow internal superuser/maintenance operations
  if current_user in ('postgres', 'service_role') and nullif(current_setting('request.jwt.claim.sub', true), '') is null then
    return NEW;
  end if;

  -- 4. Allow administrators
  if v_is_admin is true then
    return NEW;
  end if;

  -- 5. Scope internal payment context:
  -- A caller-set custom setting 'app.internal_payment_context' is NOT treated as proof
  -- of trusted server identity for declaring payment success. It is only recognized
  -- for internal slot hold creation/cancellation where payment_status is NOT 'paid'.
  v_is_internal := current_setting('app.internal_payment_context', true);

  -- Resolve authenticated caller role and clinic/doctor affiliations
  v_role := coalesce(public.current_role_name(), '');
  v_is_clinic_owner := public.is_clinic_owner(coalesce(OLD.clinic_id, NEW.clinic_id));
  v_is_doctor := public.is_active_doctor_for_appointment(
    coalesce(OLD.clinic_id, NEW.clinic_id),
    coalesce(OLD.assigned_doctor_id, NEW.assigned_doctor_id)
  );

  -- 6. PAYMENT FIELD PROTECTION (Preserve existing invariants)
  if TG_OP = 'INSERT' then
    if NEW.payment_status = 'paid' then
      raise exception 'ERR_FORBIDDEN: Direct insertion of paid payment_status is prohibited.';
    end if;
    if NEW.paid_at is not null then
      raise exception 'ERR_FORBIDDEN: Direct assignment of paid_at is prohibited.';
    end if;
    if NEW.payment_reference is not null and NEW.payment_reference like 'SIM-%' and v_is_internal is distinct from 'true' then
      raise exception 'ERR_FORBIDDEN: Direct fabrication of payment_reference is prohibited.';
    end if;

    -- Authoritative queue number assignment for inserts:
    -- Prevents patients from choosing or spoofing queue_number while allowing normal inserts
    -- (accounting for column default 1 or client-supplied queue numbers).
    -- Unpaid temporary holds (pending_hold / failed) do NOT consume queue numbers.
    if NEW.payment_status is not null and NEW.payment_status in ('pending_hold', 'failed') then
      NEW.queue_number := null;
    else
      v_cal_date := (coalesce(NEW.date, now()) at time zone 'Asia/Manila')::date;
      v_lock_key := hashtext(concat(
        coalesce(NEW.clinic_id::text, ''),
        coalesce(NEW.assigned_doctor_id::text, 'unassigned'),
        v_cal_date::text
      ));
      perform pg_advisory_xact_lock(v_lock_key);

      select coalesce(max(queue_number), 0) + 1
      into v_next_q
      from public.patient_appointment
      where clinic_id = NEW.clinic_id
        and (assigned_doctor_id is not distinct from NEW.assigned_doctor_id)
        and ((date at time zone 'Asia/Manila')::date = v_cal_date)
        and queue_number is not null;

      NEW.queue_number := coalesce(v_next_q, 1);
    end if;

    -- Patient insert status & doctor_status restrictions
    if (v_role = 'patient' or not (v_is_clinic_owner or v_is_doctor)) then
      if NEW.doctor_status is not null and NEW.doctor_status <> 'pending-review' then
        raise exception 'ERR_FORBIDDEN: Patients cannot initialize doctor_status to %', NEW.doctor_status;
      end if;
      if NEW.status not in ('pending', 'scheduled') then
        raise exception 'ERR_FORBIDDEN: Patients cannot initialize appointment status to %', NEW.status;
      end if;
    end if;

  elsif TG_OP = 'UPDATE' then
    -- Protect payment-authoritative fields: 'paid' status can ONLY be set by service_role or admin!
    if NEW.payment_status is distinct from OLD.payment_status then
      if NEW.payment_status = 'paid' then
        raise exception 'ERR_FORBIDDEN: Direct transition of payment_status to paid is prohibited.';
      end if;
      if OLD.payment_status = 'paid' and NEW.payment_status <> 'paid' then
        raise exception 'ERR_FORBIDDEN: Alteration of verified paid status is prohibited.';
      end if;
    end if;

    -- Queue Number Protection & Hold Payment Transition Assignment:
    -- If an appointment hold transitions to paid and queue_number was null, authoritatively assign it.
    if (OLD.queue_number is null and (NEW.queue_number is null or NEW.queue_number <= 0) and (NEW.payment_status is null or NEW.payment_status in ('paid', 'exempt'))) then
      v_cal_date := (coalesce(NEW.date, OLD.date, now()) at time zone 'Asia/Manila')::date;
      v_lock_key := hashtext(concat(
        coalesce(NEW.clinic_id::text, ''),
        coalesce(NEW.assigned_doctor_id::text, 'unassigned'),
        v_cal_date::text
      ));
      perform pg_advisory_xact_lock(v_lock_key);

      select coalesce(max(queue_number), 0) + 1
      into v_next_q
      from public.patient_appointment
      where clinic_id = NEW.clinic_id
        and (assigned_doctor_id is not distinct from NEW.assigned_doctor_id)
        and ((date at time zone 'Asia/Manila')::date = v_cal_date)
        and queue_number is not null;

      NEW.queue_number := coalesce(v_next_q, 1);
    elsif NEW.queue_number is distinct from OLD.queue_number then
      raise exception 'ERR_FORBIDDEN: Direct modification of queue_number is prohibited.';
    end if;

    if NEW.paid_at is distinct from OLD.paid_at then
      raise exception 'ERR_FORBIDDEN: Direct modification of paid_at is prohibited.';
    end if;

    if NEW.payment_reference is distinct from OLD.payment_reference then
      raise exception 'ERR_FORBIDDEN: Direct modification of payment_reference is prohibited.';
    end if;

    if NEW.payment_amount is distinct from OLD.payment_amount then
      raise exception 'ERR_FORBIDDEN: Direct modification of payment_amount is prohibited.';
    end if;

    if NEW.payment_hold_expires_at is distinct from OLD.payment_hold_expires_at and v_is_internal is distinct from 'true' then
      raise exception 'ERR_FORBIDDEN: Direct modification of payment_hold_expires_at is prohibited.';
    end if;

    -- 7. PATIENT APPOINTMENT FIELD TAMPERING SAFEGUARDS
    if (v_role = 'patient' or not (v_is_clinic_owner or v_is_doctor)) then
      if NEW.doctor_status is distinct from OLD.doctor_status then
        -- Allow legitimate alternate-doctor selection workflow: transition from 'rejected' to 'pending-review'
        if OLD.doctor_status = 'rejected' and NEW.doctor_status = 'pending-review' then
          null;
        else
          raise exception 'ERR_FORBIDDEN: Patients are not permitted to change doctor_status to %', NEW.doctor_status;
        end if;
      end if;

      -- Prevent patients from self-approving or self-confirming appointment status
      if NEW.status is distinct from OLD.status then
        if NEW.status not in ('pending', 'cancelled') then
          raise exception 'ERR_FORBIDDEN: Patients cannot transition appointment status to %', NEW.status;
        end if;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

-- Replace existing payment trigger with comprehensive integrity & tampering trigger
drop trigger if exists trg_appointment_protect_payment on public.patient_appointment;
drop trigger if exists trg_appointment_protect_fields on public.patient_appointment;

create trigger trg_appointment_protect_fields
before insert or update on public.patient_appointment
for each row
execute function public.trg_protect_appointment_fields();

-- Also keep trg_protect_appointment_payment_fields as an alias to preserve any external calls
create or replace function public.trg_protect_appointment_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.trg_protect_appointment_fields();
end;
$$;

-- ============================================================================
-- 5. Revoke Legacy Simulated Payment RPC Privileges & Install Defense-in-Depth
-- ============================================================================

-- A. Dynamically revoke all execution privileges from public, anon, and authenticated
-- on any existing overload of process_simulated_appointment_payment found in pg_proc:
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as func_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'process_simulated_appointment_payment'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.func_signature);
  end loop;
end;
$$;

-- B. Override function body to permanently block unverified simulated payment
create or replace function public.process_simulated_appointment_payment(
  p_appointment_id uuid,
  p_simulated_outcome varchar default 'success',
  p_simulated_method varchar default 'Simulated Card'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'ERR_FORBIDDEN: Simulated appointment payment is disabled in production.';
  end if;

  return jsonb_build_object(
    'success', false,
    'code', 'ERR_SIMULATION_DISABLED',
    'error', 'ERR_SIMULATION_DISABLED',
    'message', 'Simulated appointment payment is permanently disabled. Payments must be processed through PayMongo.'
  );
end;
$$;

-- C. Explicitly revoke from public, anon, authenticated and grant strictly to service_role
revoke all on function public.process_simulated_appointment_payment(uuid, varchar, varchar) from public, anon, authenticated;
grant execute on function public.process_simulated_appointment_payment(uuid, varchar, varchar) to service_role;

-- ============================================================================
-- 6. Booked-Slot Visibility RPC (Zero Patient Data Exposure & Bounded Horizon)
-- ============================================================================

create or replace function public.get_occupied_appointment_slots(
  p_clinic_id uuid,
  p_date date,
  p_doctor_id uuid default null
)
returns table (
  slot_time varchar,
  slot_date date,
  assigned_doctor_id uuid,
  clinic_id uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- Parameter validation
  if p_clinic_id is null then
    raise exception 'p_clinic_id is required';
  end if;

  if p_date is null then
    raise exception 'p_date is required';
  end if;

  -- Verify target clinic exists
  if not exists (select 1 from public.clinic c where c.clinic_id = p_clinic_id) then
    raise exception 'ERR_NOT_FOUND: Clinic % does not exist.', p_clinic_id;
  end if;

  -- Validate scheduling horizon: between yesterday (UTC+8 timezone buffer) and 90 days out
  if p_date < (current_date - interval '1 day')::date or p_date > (current_date + interval '90 days')::date then
    raise exception 'ERR_INVALID_DATE_RANGE: Date must be within the 90-day booking horizon.';
  end if;

  return query
  select distinct
    left(trim(coalesce(pa.time, pa.batch_time, '08:00')), 5)::varchar as slot_time,
    (pa.date at time zone 'Asia/Manila')::date as slot_date,
    pa.assigned_doctor_id,
    pa.clinic_id
  from public.patient_appointment pa
  where pa.clinic_id = p_clinic_id
    and ((pa.date at time zone 'Asia/Manila')::date = p_date)
    and (p_doctor_id is null or pa.assigned_doctor_id = p_doctor_id)
    and pa.status not in ('cancelled', 'rejected')
    and (pa.doctor_status is null or pa.doctor_status <> 'rejected')
    -- Exclude expired, cancelled, or failed payment holds
    and not (
      pa.payment_status is not null
      and pa.payment_status in ('expired', 'cancelled', 'failed')
    )
    and not (
      pa.payment_status is not null
      and pa.payment_status = 'pending_hold'
      and pa.payment_hold_expires_at is not null
      and pa.payment_hold_expires_at <= now()
    );
end;
$$;

revoke all on function public.get_occupied_appointment_slots(uuid, date, uuid) from public;
grant execute on function public.get_occupied_appointment_slots(uuid, date, uuid) to authenticated, anon, service_role;

-- ============================================================================
-- 7. SELECT POLICIES
-- ============================================================================

-- 7a. Patients can read only their own appointments
create policy appt_patient_select
on public.patient_appointment
for select
to authenticated
using (
  auth.uid() is not null
  and auth.uid() = user_id
);

-- 7b. Doctors can read appointments in active affiliated clinics assigned to them or unassigned
create policy appt_doctor_select
on public.patient_appointment
for select
to authenticated
using (
  auth.uid() is not null
  and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id)
);

-- 7c. Clinic staff can read all appointments belonging to their clinic
create policy appt_clinic_select
on public.patient_appointment
for select
to authenticated
using (
  auth.uid() is not null
  and public.is_clinic_owner(clinic_id)
);

-- 7d. Administrators have global read access
create policy appt_admin_select
on public.patient_appointment
for select
to authenticated
using (
  auth.uid() is not null
  and public.is_admin()
);

-- ============================================================================
-- 8. INSERT POLICIES
-- ============================================================================

-- 8a. Patients can insert appointments only for their own user_id
create policy appt_patient_insert
on public.patient_appointment
for insert
to authenticated
with check (
  auth.uid() is not null
  and auth.uid() = user_id
  and (
    public.current_role_name() is distinct from 'patient'
    or (
      status in ('pending', 'scheduled')
      and (doctor_status is null or doctor_status = 'pending-review')
    )
  )
);

-- 8b. Clinic staff can insert appointments (e.g. walk-ins) for their clinic
create policy appt_clinic_insert
on public.patient_appointment
for insert
to authenticated
with check (
  auth.uid() is not null
  and public.is_clinic_owner(clinic_id)
);

-- 8c. Administrators can insert appointments
create policy appt_admin_insert
on public.patient_appointment
for insert
to authenticated
with check (
  auth.uid() is not null
  and public.is_admin()
);

-- ============================================================================
-- 9. UPDATE POLICIES
-- ============================================================================

-- 9a. Patients can update only their own appointments
create policy appt_patient_update
on public.patient_appointment
for update
to authenticated
using (
  auth.uid() is not null
  and auth.uid() = user_id
)
with check (
  auth.uid() is not null
  and auth.uid() = user_id
  and (
    public.current_role_name() is distinct from 'patient'
    or (
      status in ('pending', 'cancelled')
      and (doctor_status is null or doctor_status in ('pending-review', 'rejected'))
    )
  )
);

-- 9b. Doctors can update appointments assigned to them or unassigned in their clinic
create policy appt_doctor_update
on public.patient_appointment
for update
to authenticated
using (
  auth.uid() is not null
  and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id)
)
with check (
  auth.uid() is not null
  and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id)
);

-- 9c. Clinic staff can update appointments within their clinic
create policy appt_clinic_update
on public.patient_appointment
for update
to authenticated
using (
  auth.uid() is not null
  and public.is_clinic_owner(clinic_id)
)
with check (
  auth.uid() is not null
  and public.is_clinic_owner(clinic_id)
);

-- 9d. Administrators can update any appointment
create policy appt_admin_update
on public.patient_appointment
for update
to authenticated
using (
  auth.uid() is not null
  and public.is_admin()
)
with check (
  auth.uid() is not null
  and public.is_admin()
);

-- ============================================================================
-- 10. DELETE POLICIES
-- ============================================================================

-- 10a. Patients can delete only their own appointments (e.g. collision rollback)
create policy appt_patient_delete
on public.patient_appointment
for delete
to authenticated
using (
  auth.uid() is not null
  and auth.uid() = user_id
);

-- 10b. Clinic staff can delete appointments in their clinic
create policy appt_clinic_delete
on public.patient_appointment
for delete
to authenticated
using (
  auth.uid() is not null
  and public.is_clinic_owner(clinic_id)
);

-- 10c. Administrators can delete any appointment
create policy appt_admin_delete
on public.patient_appointment
for delete
to authenticated
using (
  auth.uid() is not null
  and public.is_admin()
);

commit;
