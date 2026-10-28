-- ============================================================================
-- Test Suite: appointment_rls_security_test.sql
-- Description: Transaction-isolated SQL tests verifying RLS tenant isolation,
--              role boundaries, invariant protection, anti-tampering guards,
--              simulation bypass revocation, and PayMongo webhook fulfillment on
--              patient_appointment.
-- Execution: Always executed within BEGIN ... ROLLBACK. Zero persistent changes.
-- NOTE: \ir metacommand has been eliminated for universal SQL runner compatibility.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Apply Migration DDL Within Transaction
-- ============================================================================

-- Ensure RLS is enabled
alter table public.patient_appointment enable row level security;

-- Drop legacy/overlapping policies
drop policy if exists "appt_all_access" on public.patient_appointment;
drop policy if exists "appt_patient_read" on public.patient_appointment;
drop policy if exists "appt_patient_insert" on public.patient_appointment;
drop policy if exists "appt_patient_cancel" on public.patient_appointment;
drop policy if exists "appt_clinic_manage" on public.patient_appointment;
drop policy if exists "appt_doctor_manage" on public.patient_appointment;
drop policy if exists "appt_doctor_read" on public.patient_appointment;
drop policy if exists doctor_appointment_read_scope on public.patient_appointment;

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

-- Authorization Helpers
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
        c.owner_user_id = auth.uid()
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

-- Tamper & Payment Trigger
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
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');

  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  -- 1. IMMUTABLE FIELDS: clinic_id and user_id cannot be changed by anyone except administrators
  if TG_OP = 'UPDATE' then
    if NEW.clinic_id is distinct from OLD.clinic_id and not v_is_admin then
      raise exception 'ERR_FORBIDDEN: Modifying appointment clinic_id is prohibited.';
    end if;

    if NEW.user_id is distinct from OLD.user_id and not v_is_admin then
      raise exception 'ERR_FORBIDDEN: Modifying appointment user_id is prohibited.';
    end if;
  end if;

  -- 2. Allow trusted service_role execution (e.g. PayMongo webhook)
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

  -- 5. Scope internal payment context
  v_is_internal := current_setting('app.internal_payment_context', true);

  v_role := coalesce(public.current_role_name(), '');
  v_is_clinic_owner := public.is_clinic_owner(coalesce(OLD.clinic_id, NEW.clinic_id));
  v_is_doctor := public.is_active_doctor_for_appointment(
    coalesce(OLD.clinic_id, NEW.clinic_id),
    coalesce(OLD.assigned_doctor_id, NEW.assigned_doctor_id)
  );

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
    -- Overrides client-supplied values or column default with server-authoritative sequential number.
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

    if (v_role = 'patient' or not (v_is_clinic_owner or v_is_doctor)) then
      if NEW.doctor_status is not null and NEW.doctor_status <> 'pending-review' then
        raise exception 'ERR_FORBIDDEN: Patients cannot initialize doctor_status to %', NEW.doctor_status;
      end if;
      if NEW.status not in ('pending', 'scheduled') then
        raise exception 'ERR_FORBIDDEN: Patients cannot initialize appointment status to %', NEW.status;
      end if;
    end if;

  elsif TG_OP = 'UPDATE' then
    -- Direct transition to 'paid' requires verified service_role or admin
    if NEW.payment_status is distinct from OLD.payment_status then
      if NEW.payment_status = 'paid' then
        raise exception 'ERR_FORBIDDEN: Direct transition of payment_status to paid is prohibited.';
      end if;
      if OLD.payment_status = 'paid' and NEW.payment_status <> 'paid' then
        raise exception 'ERR_FORBIDDEN: Alteration of verified paid status is prohibited.';
      end if;
    end if;

    -- If an appointment hold transitions to paid and queue_number was null, assign it.
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

    -- Patient tampering safeguards
    if (v_role = 'patient' or not (v_is_clinic_owner or v_is_doctor)) then
      if NEW.doctor_status is distinct from OLD.doctor_status then
        if OLD.doctor_status = 'rejected' and NEW.doctor_status = 'pending-review' then
          null; -- Legitimate alternate-doctor selection
        else
          raise exception 'ERR_FORBIDDEN: Patients are not permitted to change doctor_status to %', NEW.doctor_status;
        end if;
      end if;

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

drop trigger if exists trg_appointment_protect_payment on public.patient_appointment;
drop trigger if exists trg_appointment_protect_fields on public.patient_appointment;

create trigger trg_appointment_protect_fields
before insert or update on public.patient_appointment
for each row
execute function public.trg_protect_appointment_fields();

-- Simulation RPC override & dynamic privilege revocation
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

revoke all on function public.process_simulated_appointment_payment(uuid, varchar, varchar) from public, anon, authenticated;
grant execute on function public.process_simulated_appointment_payment(uuid, varchar, varchar) to service_role;

-- Booked-Slot Visibility RPC
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
  if p_clinic_id is null then
    raise exception 'p_clinic_id is required';
  end if;
  if p_date is null then
    raise exception 'p_date is required';
  end if;

  if not exists (select 1 from public.clinic c where c.clinic_id = p_clinic_id) then
    raise exception 'ERR_NOT_FOUND: Clinic % does not exist.', p_clinic_id;
  end if;

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

-- RLS Policies
create policy appt_patient_select on public.patient_appointment for select to authenticated using (auth.uid() is not null and auth.uid() = user_id);
create policy appt_doctor_select on public.patient_appointment for select to authenticated using (auth.uid() is not null and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id));
create policy appt_clinic_select on public.patient_appointment for select to authenticated using (auth.uid() is not null and public.is_clinic_owner(clinic_id));
create policy appt_admin_select on public.patient_appointment for select to authenticated using (auth.uid() is not null and public.is_admin());

create policy appt_patient_insert on public.patient_appointment for insert to authenticated with check (auth.uid() is not null and auth.uid() = user_id and (public.current_role_name() is distinct from 'patient' or (status in ('pending', 'scheduled') and (doctor_status is null or doctor_status = 'pending-review'))));
create policy appt_clinic_insert on public.patient_appointment for insert to authenticated with check (auth.uid() is not null and public.is_clinic_owner(clinic_id));
create policy appt_admin_insert on public.patient_appointment for insert to authenticated with check (auth.uid() is not null and public.is_admin());

create policy appt_patient_update on public.patient_appointment for update to authenticated using (auth.uid() is not null and auth.uid() = user_id) with check (auth.uid() is not null and auth.uid() = user_id and (public.current_role_name() is distinct from 'patient' or (status in ('pending', 'cancelled') and (doctor_status is null or doctor_status in ('pending-review', 'rejected')))));
create policy appt_doctor_update on public.patient_appointment for update to authenticated using (auth.uid() is not null and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id)) with check (auth.uid() is not null and public.is_active_doctor_for_appointment(clinic_id, assigned_doctor_id));
create policy appt_clinic_update on public.patient_appointment for update to authenticated using (auth.uid() is not null and public.is_clinic_owner(clinic_id)) with check (auth.uid() is not null and public.is_clinic_owner(clinic_id));
create policy appt_admin_update on public.patient_appointment for update to authenticated using (auth.uid() is not null and public.is_admin()) with check (auth.uid() is not null and public.is_admin());

create policy appt_patient_delete on public.patient_appointment for delete to authenticated using (auth.uid() is not null and auth.uid() = user_id);
create policy appt_clinic_delete on public.patient_appointment for delete to authenticated using (auth.uid() is not null and public.is_clinic_owner(clinic_id));
create policy appt_admin_delete on public.patient_appointment for delete to authenticated using (auth.uid() is not null and public.is_admin());

-- ============================================================================
-- 2. Populate Test Identities & Data
-- ============================================================================

create temporary table test_identities (name text primary key, id uuid not null) on commit drop;
insert into test_identities values
  ('patient_a',    'a1111111-1111-1111-1111-111111111111'::uuid),
  ('patient_b',    'b2222222-2222-2222-2222-222222222222'::uuid),
  ('clinic_a_user','c3333333-3333-3333-3333-333333333333'::uuid),
  ('clinic_b_user','c4444444-4444-4444-4444-444444444444'::uuid),
  ('doctor_a_user','d5555555-5555-5555-5555-555555555555'::uuid),
  ('doctor_b_user','d7777777-7777-7777-7777-777777777777'::uuid),
  ('admin_user',   'e6666666-6666-6666-6666-666666666666'::uuid);

insert into public."user" (user_id, full_name, email, role, account_status)
values
  ('a1111111-1111-1111-1111-111111111111', 'Patient Alpha', 'patient.a@test.dermai.internal', 'patient', 'active'),
  ('b2222222-2222-2222-2222-222222222222', 'Patient Beta',  'patient.b@test.dermai.internal', 'patient', 'active'),
  ('c3333333-3333-3333-3333-333333333333', 'Clinic A Owner', 'clinic.a@test.dermai.internal', 'clinic', 'active'),
  ('c4444444-4444-4444-4444-444444444444', 'Clinic B Owner', 'clinic.b@test.dermai.internal', 'clinic', 'active'),
  ('d5555555-5555-5555-5555-555555555555', 'Dr. Alpha Skin', 'doctor.a@test.dermai.internal', 'doctor', 'active'),
  ('d7777777-7777-7777-7777-777777777777', 'Dr. Beta Skin',  'doctor.b@test.dermai.internal', 'doctor', 'active'),
  ('e6666666-6666-6666-6666-666666666666', 'Sys Admin',      'admin@test.dermai.internal',    'admin', 'active');

insert into public.clinic (clinic_id, name, email, owner_user_id, status, verified)
values
  ('ca000000-0000-0000-0000-000000000001', 'Derma Alpha Clinic', 'clinic.a@test.dermai.internal', 'c3333333-3333-3333-3333-333333333333', 'approved', true),
  ('cb000000-0000-0000-0000-000000000002', 'Derma Beta Clinic',  'clinic.b@test.dermai.internal', 'c4444444-4444-4444-4444-444444444444', 'approved', true),
  ('cc000000-0000-0000-0000-000000000003', 'Whitespace Clinic',  '   ',                          null,                                 'approved', true);

insert into public.clinic_doctor (doctor_id, clinic_id, user_id, doctor_name, email, prc_license, status)
values
  ('da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'd5555555-5555-5555-5555-555555555555', 'Dr. Alpha Skin', 'doctor.a@test.dermai.internal', 'PRC-123456', 'Active'),
  ('db000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', 'd7777777-7777-7777-7777-777777777777', 'Dr. Beta Skin',  'doctor.b@test.dermai.internal', 'PRC-654321', 'Active');

insert into public.patient_appointment (
  appointment_id, user_id, clinic_id, assigned_doctor_id, date, time, status, doctor_status, check_in_status, payment_status
) values
  ('aa000000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', now() + interval '1 day', '09:00:00', 'pending', 'pending-review', 'scheduled', 'pending_hold'),
  ('bb000000-0000-0000-0000-000000000002', 'b2222222-2222-2222-2222-222222222222', 'cb000000-0000-0000-0000-000000000002', null, now() + interval '1 day', '10:00:00', 'pending', 'pending-review', 'scheduled', 'pending_hold'),
  ('fa000000-0000-0000-0000-000000000003', 'b2222222-2222-2222-2222-222222222222', 'ca000000-0000-0000-0000-000000000001', null, now() + interval '2 days', '11:00:00', 'pending', 'pending-review', 'scheduled', 'pending_hold'),
  ('ea000000-0000-0000-0000-000000000004', 'a1111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', now() + interval '5 days', '14:00:00', 'rejected', 'rejected', 'scheduled', 'pending_hold');

grant select on test_identities to authenticated;

-- ============================================================================
-- 3. Execute Verification Scenarios
-- ============================================================================
set local role authenticated;

do $$
declare
  v_count integer;
  v_appt_id uuid;
  v_patient_a uuid := 'a1111111-1111-1111-1111-111111111111';
  v_patient_b uuid := 'b2222222-2222-2222-2222-222222222222';
  v_clinic_a_user uuid := 'c3333333-3333-3333-3333-333333333333';
  v_clinic_b_user uuid := 'c4444444-4444-4444-4444-444444444444';
  v_doctor_a_user uuid := 'd5555555-5555-5555-5555-555555555555';
  v_admin_user    uuid := 'e6666666-6666-6666-6666-666666666666';

  v_clinic_a uuid := 'ca000000-0000-0000-0000-000000000001';
  v_clinic_b uuid := 'cb000000-0000-0000-0000-000000000002';
  v_clinic_whitespace uuid := 'cc000000-0000-0000-0000-000000000003';
  v_fake_clinic uuid := 'cf000000-0000-0000-0000-000000000099';
  v_doctor_a uuid := 'da000000-0000-0000-0000-000000000001';
  v_doctor_b uuid := 'db000000-0000-0000-0000-000000000002';

  v_appt_a uuid := 'aa000000-0000-0000-0000-000000000001';
  v_appt_b uuid := 'bb000000-0000-0000-0000-000000000002';
  v_appt_unassigned uuid := 'fa000000-0000-0000-0000-000000000003';
  v_appt_rejected uuid := 'ea000000-0000-0000-0000-000000000004';
  v_caught boolean;
  v_slot_rec record;
begin
  -- --------------------------------------------------------------------------
  -- TEST 1: Patient A can read their own appointment
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_patient_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_a;
  if v_count <> 1 then
    raise exception 'Test 1 Failed: Patient A cannot read own appointment';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 2: Patient A cannot read Patient B's appointment
  -- --------------------------------------------------------------------------
  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_b;
  if v_count <> 0 then
    raise exception 'Test 2 Failed: Patient A was able to read Patient B appointment';
  end if;

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_unassigned;
  if v_count <> 0 then
    raise exception 'Test 2b Failed: Patient A was able to read unassigned appointment of Patient B';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 3: Patient A cannot insert an appointment attributed to Patient B
  -- --------------------------------------------------------------------------
  v_caught := false;
  begin
    insert into public.patient_appointment (
      user_id, clinic_id, date, time, status, doctor_status
    ) values (
      v_patient_b, v_clinic_a, now() + interval '3 days', '14:00:00', 'pending', 'pending-review'
    );
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 3 Failed: Patient A was able to insert an appointment with Patient B user_id';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 4: Patient A cannot update or delete Patient B's appointment
  -- --------------------------------------------------------------------------
  update public.patient_appointment set clinic_note = 'Tampered' where appointment_id = v_appt_b;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise exception 'Test 4 Failed: Patient A was able to update Patient B appointment';
  end if;

  delete from public.patient_appointment where appointment_id = v_appt_b;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise exception 'Test 4b Failed: Patient A was able to delete Patient B appointment';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 5: Doctor A accesses only authorized appointments in active clinic
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_doctor_a_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor_a_user, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_a;
  if v_count <> 1 then
    raise exception 'Test 5a Failed: Doctor A cannot read assigned appointment in Clinic A';
  end if;

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_unassigned;
  if v_count <> 1 then
    raise exception 'Test 5b Failed: Doctor A cannot read unassigned appointment in Clinic A';
  end if;

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_b;
  if v_count <> 0 then
    raise exception 'Test 5c Failed: Doctor A was able to read appointment in unaffiliated Clinic B';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 6: Clinic A staff can access all Clinic A appointments
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_clinic_a_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinic_a_user, 'role', 'authenticated', 'email', 'clinic.a@test.dermai.internal')::text, true);

  select count(*) into v_count from public.patient_appointment where clinic_id = v_clinic_a;
  if v_count < 2 then
    raise exception 'Test 6 Failed: Clinic A staff cannot read Clinic A appointments';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 7: Unauthorized clinic cannot access or modify another clinic's appointments
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_clinic_b_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinic_b_user, 'role', 'authenticated', 'email', 'clinic.b@test.dermai.internal')::text, true);

  select count(*) into v_count from public.patient_appointment where appointment_id = v_appt_a;
  if v_count <> 0 then
    raise exception 'Test 7a Failed: Clinic B was able to read Clinic A appointment';
  end if;

  update public.patient_appointment set clinic_note = 'Interfered' where appointment_id = v_appt_a;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise exception 'Test 7b Failed: Clinic B was able to update Clinic A appointment';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 8: Legitimate administrators retain intended global access
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.patient_appointment;
  if v_count < 4 then
    raise exception 'Test 8 Failed: Admin cannot see all appointments (expected >= 4, got %)', v_count;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 9: Legitimate appointment booking and doctor review
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_patient_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);

  insert into public.patient_appointment (
    user_id, clinic_id, date, time, status, doctor_status
  ) values (
    v_patient_a, v_clinic_a, now() + interval '4 days', '15:00:00', 'pending', 'pending-review'
  ) returning appointment_id into v_appt_id;

  if v_appt_id is null then
    raise exception 'Test 9a Failed: Patient A valid booking insert failed';
  end if;

  perform set_config('request.jwt.claim.sub', v_doctor_a_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor_a_user, 'role', 'authenticated')::text, true);

  update public.patient_appointment
  set doctor_status = 'approved', status = 'scheduled', assigned_doctor_id = v_doctor_a
  where appointment_id = v_appt_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Test 9b Failed: Doctor A review approval failed';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 10: Patient Field Tampering Safeguards
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_patient_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);

  -- 10a. Patient cannot alter appointment clinic_id
  v_caught := false;
  begin
    update public.patient_appointment
    set clinic_id = v_clinic_b
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10a Failed: Patient A was able to modify appointment clinic_id';
  end if;

  -- 10b. Patient cannot alter appointment user_id
  v_caught := false;
  begin
    update public.patient_appointment
    set user_id = v_patient_b
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10b Failed: Patient A was able to alter appointment user_id';
  end if;

  -- 10c. Patient cannot self-approve doctor_status
  v_caught := false;
  begin
    update public.patient_appointment
    set doctor_status = 'approved'
    where appointment_id = v_appt_a;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10c Failed: Patient A was able to self-approve doctor_status';
  end if;

  -- 10d. Patient cannot self-reject doctor_status
  v_caught := false;
  begin
    update public.patient_appointment
    set doctor_status = 'rejected'
    where appointment_id = v_appt_a;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10d Failed: Patient A was able to self-reject doctor_status';
  end if;

  -- 10e. Legitimate alternate-doctor workflow: transition from 'rejected' to 'pending-review'
  update public.patient_appointment
  set doctor_status = 'pending-review',
      status = 'pending',
      assigned_doctor_id = v_doctor_b,
      date = now() + interval '6 days',
      time = '16:00:00'
  where appointment_id = v_appt_rejected;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Test 10e Failed: Alternate doctor selection workflow was improperly blocked';
  end if;

  -- 10f. Untrusted client cannot directly transition payment_status to paid
  v_caught := false;
  begin
    update public.patient_appointment
    set payment_status = 'paid'
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10f Failed: Untrusted direct payment_status update was not blocked';
  end if;

  -- 10g. Client cannot tamper with paid_at or payment_reference
  v_caught := false;
  begin
    update public.patient_appointment
    set paid_at = now(), payment_reference = 'FAKE-REF-123'
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10g Failed: Untrusted direct paid_at/payment_reference update was not blocked';
  end if;

  -- 10h. Even with app.internal_payment_context set by caller, patient CANNOT declare paid or tamper clinic/user
  perform set_config('app.internal_payment_context', 'true', true);
  v_caught := false;
  begin
    update public.patient_appointment
    set payment_status = 'paid'
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10h Failed: Setting app.internal_payment_context bypassed payment_status protection';
  end if;

  v_caught := false;
  begin
    update public.patient_appointment
    set clinic_id = v_clinic_b
    where appointment_id = v_appt_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 10h-2 Failed: Setting app.internal_payment_context bypassed clinic_id immutability';
  end if;
  perform set_config('app.internal_payment_context', '', true);

  -- --------------------------------------------------------------------------
  -- TEST 11: Calling legacy process_simulated_appointment_payment is blocked
  -- --------------------------------------------------------------------------
  v_caught := false;
  begin
    perform public.process_simulated_appointment_payment(v_appt_id, 'success', 'Simulated Card');
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 11 Failed: process_simulated_appointment_payment was not blocked for authenticated patient';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 12: Privacy-Preserving Slot Visibility RPC
  -- --------------------------------------------------------------------------
  -- 12a. Valid clinic & date within horizon returns occupied slot without exposing patient information
  select * into v_slot_rec
  from public.get_occupied_appointment_slots(v_clinic_a, (now() + interval '1 day')::date, v_doctor_a)
  limit 1;

  if v_slot_rec.slot_time is null then
    raise exception 'Test 12a Failed: get_occupied_appointment_slots did not return occupied slot';
  end if;

  -- 12b. Querying for non-existent clinic raises exception
  v_caught := false;
  begin
    perform * from public.get_occupied_appointment_slots(v_fake_clinic, (now() + interval '1 day')::date);
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 12b Failed: Non-existent clinic was not rejected by slot RPC';
  end if;

  -- 12c. Querying for date outside 90-day booking horizon raises exception
  v_caught := false;
  begin
    perform * from public.get_occupied_appointment_slots(v_clinic_a, (now() + interval '100 days')::date);
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 12c Failed: Date outside 90-day horizon was not rejected by slot RPC';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 13: Clinic Authorization Hardening (Whitespace / Empty Email Rejection)
  -- --------------------------------------------------------------------------
  if public.is_clinic_owner(v_clinic_whitespace) is true then
    raise exception 'Test 13 Failed: is_clinic_owner allowed access via whitespace-only clinic email';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 14: Trusted Service-Role Payment Fulfillment
  -- --------------------------------------------------------------------------
  -- Reset to service_role context (simulating PayMongo webhook edge function)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'service_role')::text, true);
  execute 'set local role service_role';

  update public.patient_appointment
  set payment_status = 'paid',
      payment_reference = 'pay_test_webhook_ref_123',
      paid_at = now(),
      check_in_status = 'scheduled'
  where appointment_id = v_appt_id;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Test 14 Failed: Trusted service_role payment fulfillment update was improperly blocked';
  end if;

end $$;

reset role;
rollback;

select 'PASS: All 14 Appointment RLS & Tampering Safeguard Scenarios Verified' as test_result;
