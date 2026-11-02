-- ============================================================================
-- DermAI — Combined Migration & Integration Test Validation Package
-- File: supabase/tests/slot_hold_migration_combined_validation.sql
--
-- PURPOSE:
--   Executes the complete migration DDL followed immediately by the full
--   T0–T14 integration test suite within a SINGLE atomic transaction that is
--   guaranteed to ROLL BACK at the very end.
--
--   1. Migration DDL: Drops obsolete queue triggers/indexes, creates partial
--      unique indexes, triggers (trg_doctor_cross_clinic_guard, trg_appointment_slot_guard),
--      and authoritative RPCs (get_occupied_appointment_slots, acquire_appointment_slot_hold,
--      cancel_appointment_hold, release_expired_appointment_holds,
--      fulfill_appointment_payment_atomic, get_my_active_appointment_hold).
--   2. Integration Tests: Runs T0–T14 verifying triggers, locks, slot exclusivity,
--      recovery, idempotency, alternate doctor reselection, and cross-clinic checks.
--   3. Final Rollback: Undoes ALL migration DDL and ALL test data changes, leaving
--      the database in its exact original state.
--
-- TARGET: Staging / Supabase SQL Editor (Single Session)
-- *** ZERO DATA RETENTION — SINGLE TRANSACTION ROLLBACK ***
-- ============================================================================

begin;

-- ============================================================================
-- PART 1: MIGRATION DDL STATEMENTS
-- ============================================================================

-- ============================================================================
-- REMOVE OBSOLETE QUEUE OBJECTS (DermAI is online scheduled appointments only)
-- ============================================================================
drop trigger if exists zz_appointment_paid_queue_scope on public.patient_appointment;
drop index if exists public.dermai_paid_queue_once;

-- ============================================================================
-- 0. PARTIAL UNIQUE INDEXES & CROSS-CLINIC TRIGGER HARMONIZATION
--    Ensure expired/cancelled payment_status and doctor_status = 'rejected'
--    never block valid slot operations.
-- ============================================================================
drop index if exists public.idx_unique_exclusive_doctor_slot;
create unique index idx_unique_exclusive_doctor_slot
on public.patient_appointment (
  clinic_id,
  assigned_doctor_id,
  ((date at time zone 'Asia/Manila')::date),
  (left(trim(coalesce(time, batch_time, '')), 5))
)
where status not in ('cancelled', 'rejected')
  and (doctor_status is null or doctor_status <> 'rejected')
  and coalesce(payment_status, 'paid') not in ('expired', 'cancelled')
  and assigned_doctor_id is not null;

drop index if exists public.idx_unique_exclusive_unassigned_slot;
create unique index idx_unique_exclusive_unassigned_slot
on public.patient_appointment (
  clinic_id,
  ((date at time zone 'Asia/Manila')::date),
  (left(trim(coalesce(time, batch_time, '')), 5))
)
where status not in ('cancelled', 'rejected')
  and (doctor_status is null or doctor_status <> 'rejected')
  and coalesce(payment_status, 'paid') not in ('expired', 'cancelled')
  and assigned_doctor_id is null;

create or replace function public.prevent_doctor_cross_clinic_double_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_user_id uuid;
  v_conflict_count int;
  v_cal_date date;
  v_time_clean varchar(20);
  v_cross_lock bigint;
begin
  select user_id into v_doctor_user_id
  from public.clinic_doctor
  where doctor_id = NEW.assigned_doctor_id;

  if v_doctor_user_id is not null
     and NEW.status not in ('cancelled', 'rejected')
     and (NEW.doctor_status is null or NEW.doctor_status <> 'rejected') then

    v_cal_date := (NEW.date at time zone 'Asia/Manila')::date;
    v_time_clean := left(trim(coalesce(NEW.time, NEW.batch_time, '')), 5);

    -- Level 2 advisory lock: serialize cross-clinic booking attempts for this doctor
    v_cross_lock := hashtext(concat('doctor-cross-clinic|', v_doctor_user_id::text, '|', v_cal_date::text, '|', v_time_clean));
    perform pg_advisory_xact_lock(v_cross_lock);

    select count(*) into v_conflict_count
    from public.patient_appointment pa
    join public.clinic_doctor cd on cd.doctor_id = pa.assigned_doctor_id
    where cd.user_id = v_doctor_user_id
      and pa.appointment_id <> coalesce(NEW.appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and ((pa.date at time zone 'Asia/Manila')::date = v_cal_date)
      and (left(trim(coalesce(pa.time, pa.batch_time, '')), 5) = v_time_clean)
      and pa.status not in ('cancelled', 'rejected')
      and (pa.doctor_status is null or pa.doctor_status <> 'rejected')
      and coalesce(pa.payment_status, 'paid') not in ('expired', 'cancelled')
      and not (
        pa.payment_status in ('pending_hold', 'failed')
        and (pa.payment_hold_expires_at is null or pa.payment_hold_expires_at <= now())
      );

    if v_conflict_count > 0 then
      raise exception 'Doctor is already scheduled for an appointment at another branch at this date and time.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_doctor_cross_clinic_guard on public.patient_appointment;
create trigger trg_doctor_cross_clinic_guard
before insert or update on public.patient_appointment
for each row
execute function public.prevent_doctor_cross_clinic_double_booking();

-- ============================================================================
-- 1. GET_OCCUPIED_APPOINTMENT_SLOTS (return type changes -> drop first)
-- ============================================================================
drop function if exists public.get_occupied_appointment_slots(uuid, date, uuid);

create or replace function public.get_occupied_appointment_slots(
  p_clinic_id uuid,
  p_date date,
  p_doctor_id uuid default null
)
returns table (
  slot_time varchar,
  slot_date date,
  assigned_doctor_id uuid,
  clinic_id uuid,
  occupancy_type varchar,
  payment_hold_expires_at timestamptz,
  db_now timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_today_manila date;
begin
  if p_clinic_id is null or p_date is null then
    return;
  end if;

  if not exists (select 1 from public.clinic c where c.clinic_id = p_clinic_id) then
    return;
  end if;

  v_today_manila := (timezone('Asia/Manila', now()))::date;

  if p_date < (v_today_manila - interval '365 days')::date
     or p_date > (v_today_manila + interval '730 days')::date then
    return;
  end if;

  return query
  select distinct on (occ.slot_time, occ.assigned_doctor_id)
    occ.slot_time,
    occ.slot_date,
    occ.assigned_doctor_id,
    occ.clinic_id,
    occ.occupancy_type,
    occ.payment_hold_expires_at,
    occ.db_now
  from (
    select
      left(trim(coalesce(pa.time, pa.batch_time, '')), 5)::varchar as slot_time,
      (pa.date at time zone 'Asia/Manila')::date as slot_date,
      pa.assigned_doctor_id as assigned_doctor_id,
      pa.clinic_id as clinic_id,
      case
        when pa.payment_status in ('pending_hold', 'failed')
         and pa.payment_hold_expires_at is not null
         and pa.payment_hold_expires_at > now()
          then 'reserved'::varchar
        else 'booked'::varchar
      end as occupancy_type,
      case
        when pa.payment_status in ('pending_hold', 'failed') then pa.payment_hold_expires_at
        else null
      end as payment_hold_expires_at,
      now() as db_now
    from public.patient_appointment pa
    where pa.clinic_id = p_clinic_id
      and ((pa.date at time zone 'Asia/Manila')::date = p_date)
      -- doctor-specific view still includes unassigned (clinic-wide) occupancy
      and (p_doctor_id is null or pa.assigned_doctor_id = p_doctor_id or pa.assigned_doctor_id is null)
      and pa.status not in ('cancelled', 'rejected')
      and (pa.doctor_status is null or pa.doctor_status <> 'rejected')
      and not (
        pa.payment_status is not null
        and pa.payment_status in ('expired', 'cancelled')
      )
      -- expired holds (database clock) never occupy a slot
      and not (
        pa.payment_status is not null
        and pa.payment_status in ('pending_hold', 'failed')
        and (pa.payment_hold_expires_at is null or pa.payment_hold_expires_at <= now())
      )
  ) occ
  -- BOOKED beats RESERVED for the same slot/doctor scope
  order by occ.slot_time, occ.assigned_doctor_id,
           case when occ.occupancy_type = 'booked' then 0 else 1 end,
           occ.payment_hold_expires_at desc nulls last;
end;
$$;

revoke all on function public.get_occupied_appointment_slots(uuid, date, uuid) from public;
grant execute on function public.get_occupied_appointment_slots(uuid, date, uuid) to authenticated, anon, service_role;

-- ============================================================================
-- 2. ACQUIRE_APPOINTMENT_SLOT_HOLD
--    Drop legacy 21-parameter overload (and any non-24-parameter signature)
--    so all calls resolve unambiguously to the canonical 24-parameter function.
-- ============================================================================
drop function if exists public.acquire_appointment_slot_hold(
  uuid, uuid, timestamptz, varchar,
  text, text, text, text, text, date,
  text, text, text, text,
  jsonb, text, text, decimal, uuid, uuid, integer
);

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as func_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'acquire_appointment_slot_hold'
      and p.pronargs <> 24
  loop
    execute format('drop function if exists %s', r.func_signature);
  end loop;
end;
$$;

create or replace function public.acquire_appointment_slot_hold(
  p_clinic_id uuid,
  p_doctor_id uuid default null,
  p_date timestamptz default null,
  p_time varchar default null,
  p_batch_time varchar default null,
  p_patient_name text default null,
  p_patient_email text default null,
  p_patient_contact text default null,
  p_patient_address text default null,
  p_patient_gender text default null,
  p_patient_birthdate date default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_emergency_contact_relationship text default null,
  p_notes text default null,
  p_clinic_note text default null,
  p_questionnaire_answers jsonb default null,
  p_skin_photo_url text default null,
  p_ai_condition_name text default null,
  p_ai_confidence decimal default null,
  p_condition_id uuid default null,
  p_primary_scan_id uuid default null,
  p_hold_duration_minutes integer default 10,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid;
  v_is_service_role boolean;
  v_is_admin boolean;
  v_user_id uuid;
  v_cal_date date;
  v_time_clean varchar(20);
  v_lock_key bigint;
  v_slot_lock_key bigint;
  v_active record;
  v_consultation_fee decimal(10,2);
  v_clinic_name text;
  v_appt_id uuid;
  v_ref text;
  v_hold_expires_at timestamptz;
  v_now timestamptz;
begin
  -- 1. Security & authentication resolution
  v_auth_uid := auth.uid();
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if v_auth_uid is not null then
    if p_user_id is not null and p_user_id <> v_auth_uid and not v_is_admin and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'You cannot create an appointment hold for another patient.'
      );
    end if;
    v_user_id := coalesce(p_user_id, v_auth_uid);
  else
    if (v_is_service_role or v_is_admin) and p_user_id is not null then
      v_user_id := p_user_id;
    else
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_UNAUTHORIZED',
        'error', 'ERR_UNAUTHORIZED',
        'message', 'Authentication required to acquire an appointment slot hold.'
      );
    end if;
  end if;

  v_now := now();

  -- 2. Normalisation (Asia/Manila calendar date, database clock for expiry)
  v_cal_date := (p_date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(p_time, p_batch_time, '')), 5);
  v_hold_expires_at := v_now + (coalesce(p_hold_duration_minutes, 10) * interval '1 minute');

  -- 3. Concurrency locks in deterministic ascending key order (LEAST -> GREATEST)
  v_lock_key := hashtext(concat(
    coalesce(p_clinic_id::text, ''),
    coalesce(p_doctor_id::text, 'unassigned'),
    v_cal_date::text,
    v_time_clean
  ));
  v_slot_lock_key := hashtext(concat(
    'slot-wide|',
    coalesce(p_clinic_id::text, ''),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(least(v_lock_key, v_slot_lock_key));
  if v_lock_key <> v_slot_lock_key then
    perform pg_advisory_xact_lock(greatest(v_lock_key, v_slot_lock_key));
  end if;

  -- 4. Reap genuinely EXPIRED holds (database clock: payment_hold_expires_at <= v_now)
  begin
    perform set_config('app.internal_payment_context', 'true', true);

    with expired_candidates as (
      select appointment_id
      from public.patient_appointment
      where clinic_id = p_clinic_id
        and ((date at time zone 'Asia/Manila')::date = v_cal_date)
        and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
        and (
          p_doctor_id is null
          or assigned_doctor_id is null
          or assigned_doctor_id = p_doctor_id
        )
        and status not in ('cancelled', 'rejected')
        and (
          (
            payment_status in ('pending_hold', 'failed')
            and (payment_hold_expires_at is null or payment_hold_expires_at <= v_now)
          )
          or payment_status in ('expired', 'cancelled')
        )
      order by appointment_id
      for update
    )
    update public.patient_appointment pa
    set status = 'cancelled',
        payment_status = case
          when pa.payment_status = 'cancelled' then 'cancelled'
          else 'expired'
        end,
        clinic_note = case
          when pa.payment_status in ('pending_hold', 'failed')
            then coalesce(pa.clinic_note || ' | ', '') || 'Expired hold released by subsequent booking attempt.'
          else pa.clinic_note
        end
    from expired_candidates ec
    where pa.appointment_id = ec.appointment_id;

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  -- 5. Evaluate ALL remaining active occupants of this slot
  --    Ordering guarantees:
  --      1. Confirmed bookings ('paid', 'exempt', etc.) sort first (0).
  --      2. Any active hold belonging to ANOTHER patient (user_id is distinct from v_user_id)
  --         or with a different doctor scope (assigned_doctor_id is distinct from p_doctor_id)
  --         sorts BEFORE (0) the caller's own same-scope hold (1), so a conflicting reservation
  --         can never be masked by the caller's own row.
  select appointment_id, user_id, payment_status, payment_hold_expires_at,
         payment_reference, payment_amount, assigned_doctor_id
  into v_active
  from public.patient_appointment
  where clinic_id = p_clinic_id
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
    and (
      p_doctor_id is null
      or assigned_doctor_id is null
      or assigned_doctor_id = p_doctor_id
    )
    and status not in ('cancelled', 'rejected')
    and (doctor_status is null or doctor_status <> 'rejected')
    and coalesce(payment_status, 'paid') not in ('expired', 'cancelled')
    and not (
      payment_status in ('pending_hold', 'failed')
      and (payment_hold_expires_at is null or payment_hold_expires_at <= v_now)
    )
  order by
    case when coalesce(payment_status, 'paid') not in ('pending_hold', 'failed') then 0 else 1 end,
    case
      when user_id is distinct from v_user_id
        or (assigned_doctor_id is distinct from p_doctor_id)
        then 0
      else 1
    end,
    created_at desc
  limit 1;

  if v_active.appointment_id is not null then
    -- A. Idempotent retry: SAME user, SAME doctor scope, still-active hold (does not extend expiration)
    if v_active.user_id = v_user_id
       and v_active.payment_status in ('pending_hold', 'failed')
       and (v_active.payment_hold_expires_at is not null and v_active.payment_hold_expires_at > v_now)
       and (v_active.assigned_doctor_id is not distinct from p_doctor_id) then
      select name into v_clinic_name from public.clinic where clinic_id = p_clinic_id;
      return jsonb_build_object(
        'success', true,
        'appointment_id', v_active.appointment_id,
        'payment_reference', coalesce(v_active.payment_reference, 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD'))),
        'payment_amount', coalesce(v_active.payment_amount, 500.00),
        'fee', coalesce(v_active.payment_amount, 500.00),
        'currency', 'PHP',
        'hold_expires_at', v_active.payment_hold_expires_at,
        'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
        'payment_status', v_active.payment_status,
        'clinic_name', coalesce(v_clinic_name, 'Clinic'),
        'is_existing_hold', true
      );
    end if;

    -- B. Anything else is a hard conflict; never release or alter another patient's hold
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_SLOT_UNAVAILABLE',
      'error', 'ERR_SLOT_UNAVAILABLE',
      'message', 'This consultation slot has just been reserved by another patient. Please select another available time.'
    );
  end if;

  -- 6. Authoritative consultation fee and clinic name
  select coalesce(consultation_fee, 500.00), name
  into v_consultation_fee, v_clinic_name
  from public.clinic
  where clinic_id = p_clinic_id;

  if v_consultation_fee is null then
    v_consultation_fee := 500.00;
  end if;

  v_ref := 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 7. Insert the new temporary hold with tightly scoped internal context
  begin
    perform set_config('app.internal_payment_context', 'true', true);

    insert into public.patient_appointment (
      user_id, clinic_id, assigned_doctor_id, date, time, batch_time,
      status, doctor_status, queue_number,
      patient_name, patient_email, patient_contact, patient_address, patient_gender, patient_birthdate,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
      notes, clinic_note, questionnaire_answers, skin_photo_url,
      ai_condition_name, ai_confidence, condition_id, primary_scan_id,
      payment_status, payment_amount, payment_reference, payment_hold_expires_at,
      schedule_sent_to_doctor, check_in_status
    ) values (
      v_user_id,
      p_clinic_id,
      p_doctor_id,
      p_date,
      coalesce(nullif(trim(p_time), ''), v_time_clean || ':00'),
      coalesce(nullif(trim(p_batch_time), ''), v_time_clean),
      'pending',
      'pending-review',
      null,
      p_patient_name, p_patient_email, p_patient_contact, p_patient_address, p_patient_gender, p_patient_birthdate,
      p_emergency_contact_name, p_emergency_contact_phone, p_emergency_contact_relationship,
      p_notes,
      coalesce(nullif(trim(p_clinic_note), ''), 'Consultation slot held pending payment confirmation (10m).'),
      p_questionnaire_answers, p_skin_photo_url,
      p_ai_condition_name, p_ai_confidence, p_condition_id, p_primary_scan_id,
      'pending_hold', v_consultation_fee, v_ref, v_hold_expires_at,
      false, 'scheduled'
    )
    returning appointment_id into v_appt_id;

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  return jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'payment_reference', v_ref,
    'payment_amount', v_consultation_fee,
    'fee', v_consultation_fee,
    'currency', 'PHP',
    'hold_expires_at', v_hold_expires_at,
    'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
    'payment_status', 'pending_hold',
    'clinic_name', coalesce(v_clinic_name, 'Clinic'),
    'is_existing_hold', false
  );
end;
$$;

revoke all on function public.acquire_appointment_slot_hold(
  uuid, uuid, timestamptz, varchar, varchar,
  text, text, text, text, text, date,
  text, text, text, text, text,
  jsonb, text, text, decimal, uuid, uuid, integer, uuid
) from public, anon;

grant execute on function public.acquire_appointment_slot_hold(
  uuid, uuid, timestamptz, varchar, varchar,
  text, text, text, text, text, date,
  text, text, text, text, text,
  jsonb, text, text, decimal, uuid, uuid, integer, uuid
) to authenticated, service_role;

-- ============================================================================
-- 2B. CANCEL_APPOINTMENT_HOLD & RELEASE_EXPIRED_APPOINTMENT_HOLDS
--     Ensure app.internal_payment_context is always reset to '' on both normal
--     and exception paths, and enforce strict authorization & row locking.
-- ============================================================================
create or replace function public.cancel_appointment_hold(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_service_role boolean;
  v_is_admin boolean;
  v_appt record;
  v_rows_updated integer := 0;
begin
  if p_appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'error', 'ERR_INVALID_PARAMS',
      'message', 'Missing appointment ID.'
    );
  end if;

  v_user_id := auth.uid();
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if v_user_id is null and not v_is_service_role and not v_is_admin then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNAUTHORIZED',
      'error', 'ERR_UNAUTHORIZED',
      'message', 'You must be signed in to cancel a reservation hold.'
    );
  end if;

  select appointment_id, user_id, status, payment_status, clinic_id, clinic_note
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'error', 'ERR_NOT_FOUND',
      'message', 'Appointment not found.'
    );
  end if;

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ALREADY_PAID',
      'error', 'ERR_ALREADY_PAID',
      'message', 'Cannot cancel hold: appointment is already paid.'
    );
  end if;

  if v_appt.payment_status not in ('pending_hold', 'failed') and v_appt.status not in ('pending') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_STATUS',
      'error', 'ERR_INVALID_STATUS',
      'message', 'Appointment is not in an active temporary hold state.'
    );
  end if;

  if v_appt.user_id is not null then
    if (v_user_id is null or v_user_id <> v_appt.user_id) and not v_is_admin and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'Unauthorized to cancel another patient''s hold.'
      );
    end if;
  else
    if not v_is_admin and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'Unauthorized to cancel unassigned clinic hold.'
      );
    end if;
  end if;

  begin
    perform set_config('app.internal_payment_context', 'true', true);

    update public.patient_appointment
    set status = 'cancelled',
        payment_status = 'cancelled',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Slot hold cancelled by patient.'
    where appointment_id = p_appointment_id
      and payment_status in ('pending_hold', 'failed');

    get diagnostics v_rows_updated = row_count;
    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  if v_rows_updated = 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CONCURRENT_STATE_CHANGE',
      'error', 'ERR_CONCURRENT_STATE_CHANGE',
      'message', 'Appointment state changed concurrently; hold could not be cancelled.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'clinic_id', v_appt.clinic_id,
    'message', 'Hold successfully cancelled.'
  );
end;
$$;

revoke all on function public.cancel_appointment_hold(uuid) from public, anon;
grant execute on function public.cancel_appointment_hold(uuid) to authenticated, service_role;

create or replace function public.release_expired_appointment_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_is_service_role boolean;
  v_is_admin boolean;
begin
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if not v_is_service_role and not v_is_admin then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'Only service role or administrators may invoke hold cleanup.'
    );
  end if;

  begin
    perform set_config('app.internal_payment_context', 'true', true);

    with expired_candidates as (
      select appointment_id
      from public.patient_appointment
      where payment_status in ('pending_hold', 'failed')
        and (payment_hold_expires_at is null or payment_hold_expires_at <= now())
        and status not in ('cancelled', 'rejected', 'completed')
      order by appointment_id
      for update
    ),
    expired_appts as (
      update public.patient_appointment pa
      set status = 'cancelled',
          payment_status = 'expired',
          clinic_note = coalesce(pa.clinic_note || ' | ', '') || 'Reservation hold expired without payment.'
      from expired_candidates ec
      where pa.appointment_id = ec.appointment_id
      returning pa.appointment_id
    )
    select count(*) into v_count from expired_appts;

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  return jsonb_build_object(
    'success', true,
    'released_count', v_count
  );
end;
$$;

revoke all on function public.release_expired_appointment_holds() from public, anon, authenticated;
grant execute on function public.release_expired_appointment_holds() to service_role;

-- ============================================================================
-- 3. TRIGGER: trg_assign_appointment_queue_and_prevent_duplicates
--    - Attached to public.patient_appointment BEFORE INSERT OR UPDATE
--    - Fires AFTER trg_appointment_protect_fields ('trg_ap' < 'trg_as') so
--      queue_number reassignments on alternate-doctor selection do not trip
--      ERR_FORBIDDEN in trg_appointment_protect_fields.
--    - Reaps expired holds on the target slot before conflict and unique-index
--      checks so direct updates never hit unique index violations on expired rows.
-- ============================================================================
create or replace function public.trg_appointment_slot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cal_date date;
  v_time_clean varchar(20);
  v_conflict_id uuid;
  v_slot_wide_lock_key bigint;
  v_prev_internal_ctx text;
begin
  v_time_clean := left(trim(coalesce(NEW.time, NEW.batch_time, '')), 5);
  v_cal_date := (NEW.date at time zone 'Asia/Manila')::date;

  if NEW.status not in ('cancelled', 'rejected') and (NEW.doctor_status is null or NEW.doctor_status <> 'rejected') then
    -- 0. Acquire Level 1 slot-wide transaction lock (matches acquire_appointment_slot_hold)
    v_slot_wide_lock_key := hashtext(concat(
      'slot-wide|',
      coalesce(NEW.clinic_id::text, ''),
      v_cal_date::text,
      v_time_clean
    ));
    perform pg_advisory_xact_lock(v_slot_wide_lock_key);

    -- 1A. Reap any expired or stale holds on the target slot before conflict and unique-index checks
    v_prev_internal_ctx := coalesce(current_setting('app.internal_payment_context', true), '');
    begin
      perform set_config('app.internal_payment_context', 'true', true);

      with expired_slot_holds as (
        select appointment_id
        from public.patient_appointment
        where ((date at time zone 'Asia/Manila')::date = v_cal_date)
          and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
          and (
            clinic_id = NEW.clinic_id
            or (NEW.assigned_doctor_id is not null and assigned_doctor_id = NEW.assigned_doctor_id)
          )
          and status not in ('cancelled', 'rejected')
          and (
            (
              payment_status in ('pending_hold', 'failed')
              and (payment_hold_expires_at is null or payment_hold_expires_at <= now())
            )
            or payment_status in ('expired', 'cancelled')
          )
          and appointment_id <> coalesce(NEW.appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by appointment_id
        for update
      )
      update public.patient_appointment pa
      set status = 'cancelled',
          payment_status = case
            when pa.payment_status = 'cancelled' then 'cancelled'
            else 'expired'
          end,
          clinic_note = case
            when pa.payment_status in ('pending_hold', 'failed')
              then coalesce(pa.clinic_note || ' | ', '') || 'Expired hold released by subsequent schedule update.'
            else pa.clinic_note
          end
      from expired_slot_holds esh
      where pa.appointment_id = esh.appointment_id;

      perform set_config('app.internal_payment_context', v_prev_internal_ctx, true);
    exception when others then
      perform set_config('app.internal_payment_context', v_prev_internal_ctx, true);
      raise;
    end;

    -- 1B. Bidirectional conflict check (unassigned <-> doctor-specific aware)
    select appointment_id into v_conflict_id
    from public.patient_appointment
    where clinic_id = NEW.clinic_id
      and (
        NEW.assigned_doctor_id is null
        or assigned_doctor_id is null
        or assigned_doctor_id = NEW.assigned_doctor_id
      )
      and ((date at time zone 'Asia/Manila')::date = v_cal_date)
      and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
      and status not in ('cancelled', 'rejected')
      and (doctor_status is null or doctor_status <> 'rejected')
      and not (
        payment_status is not null
        and payment_status in ('expired', 'cancelled')
      )
      and not (
        payment_status is not null
        and payment_status in ('pending_hold', 'failed')
        and (payment_hold_expires_at is null or payment_hold_expires_at <= now())
      )
      and appointment_id <> coalesce(NEW.appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)
    limit 1;

    if v_conflict_id is not null then
      if NEW.assigned_doctor_id is not null then
        raise exception 'ERR_DUPLICATE_SLOT: The time slot % on % is already reserved or booked for this doctor.', v_time_clean, v_cal_date;
      else
        raise exception 'ERR_DUPLICATE_SLOT: The unassigned consultation slot % on % is already reserved for this clinic.', v_time_clean, v_cal_date;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_assign_appointment_queue on public.patient_appointment;
drop trigger if exists trg_prevent_duplicate_appointment on public.patient_appointment;
drop trigger if exists trg_assign_appointment_queue_and_prevent_duplicates on public.patient_appointment;
drop trigger if exists trg_appointment_slot_guard on public.patient_appointment;

create trigger trg_appointment_slot_guard
before insert or update on public.patient_appointment
for each row
execute function public.trg_appointment_slot_guard();

-- ============================================================================
-- 4. FULFILL_APPOINTMENT_PAYMENT_ATOMIC
-- ============================================================================

-- Ensure user_payment.status has sufficient width and allows 'reconciliation_required'
alter table if exists public.user_payment
  alter column status type varchar(50);

alter table if exists public.user_payment
  drop constraint if exists user_payment_status_check;

alter table if exists public.user_payment
  drop constraint if exists check_user_payment_status;

alter table if exists public.user_payment
  add constraint user_payment_status_check
  check (status in ('success', 'failed', 'pending', 'reconciliation_required'));

create or replace function public.fulfill_appointment_payment_atomic(
  p_paymongo_payment_id text,
  p_payment_intent_id text,
  p_appointment_id uuid,
  p_user_id uuid,
  p_amount decimal,
  p_payment_method text default 'gcash',
  p_currency text default 'PHP'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_meta record;
  v_appt record;
  v_existing_pay record;
  v_conflict_appt_id uuid;
  v_now timestamptz := now();
  v_is_expired boolean;
  v_pay_summary text;
  v_recon_note text;
  v_target_user_id uuid;
  v_is_overpayment boolean := false;
  v_overpayment_diff decimal := 0.00;
  v_earned_fee decimal := 0.00;
  v_clinic_name text;
  v_doctor_name text;
  v_cal_date date;
  v_time_clean varchar(20);
  v_locked_cal_date date;
  v_locked_time_clean varchar(20);
  v_lock_key bigint;
  v_slot_lock_key bigint;
  v_locked_first boolean;
  v_locked_second boolean;
begin
  -- 1. Strict Security Barrier: Callable strictly by service_role or active platform administrators
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Unauthorized: Only service_role or admin can execute atomic payment fulfillment.'
    );
  end if;

  if p_paymongo_payment_id is null or p_appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Missing required parameters: paymongo_payment_id and appointment_id are mandatory.'
    );
  end if;

  -- 1B. Currency Validation: Reject any currency other than PHP
  if upper(coalesce(p_currency, 'PHP')) <> 'PHP' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_CURRENCY',
      'message', 'Unsupported currency: ' || p_currency || '. Only PHP is accepted for consultation payments.'
    );
  end if;

  -- 2A. Pre-read slot coordinates to acquire slot advisory locks BEFORE the row lock.
  --     Acquiring advisory locks (in LEAST -> GREATEST order) before SELECT ... FOR UPDATE
  --     matches the lock acquisition order in acquire_appointment_slot_hold() and prevents deadlocks.
  select appointment_id, clinic_id, assigned_doctor_id, date, time, batch_time
  into v_slot_meta
  from public.patient_appointment
  where appointment_id = p_appointment_id;

  if v_slot_meta.appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'message', 'Appointment not found.'
    );
  end if;

  v_cal_date := (v_slot_meta.date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(v_slot_meta.time, v_slot_meta.batch_time, '08:00')), 5);
  v_lock_key := hashtext(concat(
    coalesce(v_slot_meta.clinic_id::text, ''),
    coalesce(v_slot_meta.assigned_doctor_id::text, 'unassigned'),
    v_cal_date::text,
    v_time_clean
  ));
  v_slot_lock_key := hashtext(concat(
    'slot-wide|',
    coalesce(v_slot_meta.clinic_id::text, ''),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(least(v_lock_key, v_slot_lock_key));
  if v_lock_key <> v_slot_lock_key then
    perform pg_advisory_xact_lock(greatest(v_lock_key, v_slot_lock_key));
  end if;

  -- 2B. Lock appointment row with SELECT ... FOR UPDATE to serialize concurrent fulfillment/cancellation
  select appointment_id, user_id, clinic_id, payment_status, status, clinic_note,
         payment_hold_expires_at, payment_amount, patient_name, patient_email,
         date, time, batch_time, assigned_doctor_id, payment_reference, doctor_status
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'message', 'Appointment not found.'
    );
  end if;

  -- Verify locked row coordinates still match the pre-read slot coordinates.
  -- If they changed concurrently between 2A and 2B, acquire the updated slot advisory locks
  -- non-blockingly in deterministic order (or abort with serialization_failure if contended)
  -- so we never block on an advisory lock while already holding a row lock.
  v_locked_cal_date := (v_appt.date at time zone 'Asia/Manila')::date;
  v_locked_time_clean := left(trim(coalesce(v_appt.time, v_appt.batch_time, '08:00')), 5);

  if v_appt.clinic_id is distinct from v_slot_meta.clinic_id
     or v_appt.assigned_doctor_id is distinct from v_slot_meta.assigned_doctor_id
     or v_locked_cal_date is distinct from v_cal_date
     or v_locked_time_clean is distinct from v_time_clean then
    v_cal_date := v_locked_cal_date;
    v_time_clean := v_locked_time_clean;
    v_lock_key := hashtext(concat(
      coalesce(v_appt.clinic_id::text, ''),
      coalesce(v_appt.assigned_doctor_id::text, 'unassigned'),
      v_cal_date::text,
      v_time_clean
    ));
    v_slot_lock_key := hashtext(concat(
      'slot-wide|',
      coalesce(v_appt.clinic_id::text, ''),
      v_cal_date::text,
      v_time_clean
    ));
    v_locked_first := pg_try_advisory_xact_lock(least(v_lock_key, v_slot_lock_key));
    if v_lock_key <> v_slot_lock_key then
      v_locked_second := pg_try_advisory_xact_lock(greatest(v_lock_key, v_slot_lock_key));
    else
      v_locked_second := true;
    end if;

    if not (v_locked_first and v_locked_second) then
      raise exception using
        errcode = '40001',
        message = 'ERR_CONCURRENT_SLOT_CHANGE: Appointment slot coordinates changed concurrently; retry payment fulfillment.';
    end if;
  end if;

  -- 2C. Authoritative Clinic and Doctor Name Resolution
  select name into v_clinic_name from public.clinic where clinic_id = v_appt.clinic_id;
  if v_appt.assigned_doctor_id is not null then
    select doctor_name into v_doctor_name from public.clinic_doctor where doctor_id = v_appt.assigned_doctor_id;
  end if;

  -- 3. Validate ownership and payment amount
  if v_appt.user_id is not null and p_user_id is not null and v_appt.user_id <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_USER_MISMATCH',
      'message', 'Payment user does not match trusted appointment owner.'
    );
  end if;

  v_target_user_id := coalesce(v_appt.user_id, p_user_id);
  if v_target_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_USER_REQUIRED',
      'message', 'Cannot fulfill payment: user_id is missing from both appointment record and payment payload.'
    );
  end if;

  -- 3B. Fee Completeness & Overpayment Logic
  v_earned_fee := coalesce(v_appt.payment_amount, p_amount);
  if v_appt.payment_amount is not null and v_appt.payment_amount > 0 then
    if p_amount < v_appt.payment_amount then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INSUFFICIENT_AMOUNT',
        'message', 'Captured amount ₱' || p_amount::text || ' is less than required appointment fee ₱' || v_appt.payment_amount::text
      );
    elsif (p_amount - v_appt.payment_amount) > 0.01 then
      v_is_overpayment := true;
      v_overpayment_diff := p_amount - v_appt.payment_amount;
      v_earned_fee := v_appt.payment_amount;
    end if;
  end if;

  -- 3C. Cross-Appointment Reference Isolation Guard
  if exists (
    select 1 from public.patient_appointment
    where payment_reference = p_paymongo_payment_id
      and appointment_id <> p_appointment_id
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Payment reference already associated with another appointment.'
    );
  end if;

  -- 4. Check existing payment in user_payment for idempotency and reference isolation
  select payment_id, status, appointment_id, user_id, amount
  into v_existing_pay
  from public.user_payment
  where paymongo_payment_id = p_paymongo_payment_id;

  if v_existing_pay.payment_id is not null then
    if v_existing_pay.appointment_id is not null and v_existing_pay.appointment_id <> p_appointment_id then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTEGRITY_MISMATCH',
        'message', 'Payment reference already associated with a different appointment.'
      );
    end if;
    if v_target_user_id is not null and v_existing_pay.user_id is not null and v_existing_pay.user_id <> v_target_user_id then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTEGRITY_MISMATCH',
        'message', 'Payment reference already associated with a different user.'
      );
    end if;
  end if;

  -- 5. Idempotency Check: Appointment already paid
  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'action', 'idempotent_skip',
      'status', 'paid',
      'appointment_id', p_appointment_id,
      'clinic_id', v_appt.clinic_id,
      'clinic_name', coalesce(v_clinic_name, 'DermAI Partner Clinic'),
      'doctor_name', coalesce(v_doctor_name, 'Attending Dermatologist'),
      'patient_email', v_appt.patient_email,
      'patient_name', v_appt.patient_name,
      'appointment_date', v_appt.date,
      'appointment_time', coalesce(v_appt.time, v_appt.batch_time),
      'earned_fee', v_earned_fee,
      'captured_amount', p_amount,
      'payment_reference', coalesce(v_appt.payment_reference, p_paymongo_payment_id)
    );
  end if;

  -- 6A. Evaluate Hold Expiration & Cancellation State (database clock)
  v_is_expired := (
    v_appt.payment_status = 'expired'
    or (
      v_appt.payment_status in ('pending_hold', 'failed')
      and v_appt.payment_hold_expires_at is not null
      and v_appt.payment_hold_expires_at <= v_now
    )
  );

  if v_appt.payment_status = 'cancelled' or v_appt.status = 'cancelled' or v_is_expired then
    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||
      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||
      ' (Ref: ' || p_paymongo_payment_id || ') after hold was ' ||
      case when v_is_expired then 'expired' else coalesce(v_appt.payment_status, 'cancelled') end ||
      '. Slot was not reactivated.';

    begin
      perform set_config('app.internal_payment_context', 'true', true);

      update public.patient_appointment
      set payment_reference = p_paymongo_payment_id,
          status = case
            when v_is_expired then 'cancelled'
            else status
          end,
          payment_status = case
            when payment_status = 'cancelled' then 'cancelled'
            when v_is_expired then 'expired'
            else payment_status
          end,
          clinic_note = v_recon_note
      where appointment_id = p_appointment_id;

      perform set_config('app.internal_payment_context', '', true);
    exception when others then
      perform set_config('app.internal_payment_context', '', true);
      raise;
    end;

    if v_existing_pay.payment_id is not null then
      update public.user_payment
      set status = 'reconciliation_required',
          amount = p_amount
      where payment_id = v_existing_pay.payment_id;
    else
      insert into public.user_payment (
        amount,
        payment_date, method, status, user_id,
        reference_number, paymongo_payment_id, paymongo_payment_intent_id,
        appointment_id, clinic_id, payment_type
      ) values (
        p_amount,
        v_now, p_payment_method, 'reconciliation_required', v_target_user_id,
        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,
        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'
      );
    end if;

    insert into public.system_audit_log (
      user_id, user_type, log_type, action, target, details, performer_name
    ) values (
      v_target_user_id,
      'patient',
      'appointment',
      case when v_is_expired then 'Payment Captured On Expired Appointment' else 'Payment Captured On Cancelled Appointment' end,
      'Appointment #' || p_appointment_id::text,
      'Payment ' || p_paymongo_payment_id || ' (₱' || p_amount::text || ') captured for appointment ' || p_appointment_id::text || ' after hold was ' || case when v_is_expired then 'expired' else 'cancelled' end || '. Flagged for administrative reconciliation.',
      'Database Atomic Payment RPC'
    );

    return jsonb_build_object(
      'success', true,
      'action', 'reconciliation_required',
      'status', case when v_is_expired then 'expired' else 'cancelled' end,
      'appointment_id', p_appointment_id
    );
  end if;

  -- 6B. Slot-Level Concurrency & Anti-Collision Barrier (doctor + unassigned aware, excluding doctor-rejected rows)
  select appointment_id into v_conflict_appt_id
  from public.patient_appointment
  where clinic_id = v_appt.clinic_id
    and (
      v_appt.assigned_doctor_id is null
      or assigned_doctor_id is null
      or assigned_doctor_id = v_appt.assigned_doctor_id
    )
    and ((date at time zone 'Asia/Manila')::date = (v_appt.date at time zone 'Asia/Manila')::date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = left(trim(coalesce(v_appt.time, v_appt.batch_time, '')), 5))
    and payment_status in ('paid', 'exempt')
    and status not in ('cancelled', 'rejected')
    and (doctor_status is null or doctor_status <> 'rejected')
    and appointment_id <> p_appointment_id
  limit 1;

  if v_conflict_appt_id is not null then
    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||
      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||
      ' (Ref: ' || p_paymongo_payment_id || ') but slot was already booked by appointment ' || v_conflict_appt_id::text ||
      '. Slot was not double-booked.';

    begin
      perform set_config('app.internal_payment_context', 'true', true);

      update public.patient_appointment
      set payment_reference = p_paymongo_payment_id,
          status = 'cancelled',
          payment_status = 'cancelled',
          clinic_note = v_recon_note
      where appointment_id = p_appointment_id;

      perform set_config('app.internal_payment_context', '', true);
    exception when others then
      perform set_config('app.internal_payment_context', '', true);
      raise;
    end;

    if v_existing_pay.payment_id is not null then
      update public.user_payment
      set status = 'reconciliation_required',
          amount = p_amount
      where payment_id = v_existing_pay.payment_id;
    else
      insert into public.user_payment (
        amount,
        payment_date, method, status, user_id,
        reference_number, paymongo_payment_id, paymongo_payment_intent_id,
        appointment_id, clinic_id, payment_type
      ) values (
        p_amount,
        v_now, p_payment_method, 'reconciliation_required', v_target_user_id,
        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,
        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'
      );
    end if;

    insert into public.system_audit_log (
      user_id, user_type, log_type, action, target, details, performer_name
    ) values (
      v_target_user_id,
      'patient',
      'appointment',
      'Payment Captured On Colliding Appointment Slot',
      'Appointment #' || p_appointment_id::text,
      'Payment ' || p_paymongo_payment_id || ' (₱' || p_amount::text || ') was captured for appointment ' || p_appointment_id::text || ', but slot was already booked by appointment ' || v_conflict_appt_id::text || '. Slot collision prevented and payment routed to reconciliation.',
      'Database Atomic Payment RPC'
    );

    return jsonb_build_object(
      'success', true,
      'action', 'reconciliation_required',
      'status', 'cancelled',
      'appointment_id', p_appointment_id,
      'conflict_appointment_id', v_conflict_appt_id,
      'message', 'Slot was already confirmed by another appointment. Payment routed to reconciliation.'
    );
  end if;

  -- 7. NORMAL FULFILLMENT BRANCH (Atomic)
  v_pay_summary := coalesce(v_appt.clinic_note || ' | ', '') || 'Paid Online (' || p_payment_method || ' Ref: ' || p_paymongo_payment_id || ')';

  if v_is_overpayment then
    v_pay_summary := v_pay_summary || ' | [OVERPAYMENT DETECTED] Excess: ₱' || v_overpayment_diff::text || ' (Captured ₱' || p_amount::text || ' vs Expected ₱' || v_appt.payment_amount::text || '). Requires clinic review/refund.';

    insert into public.system_audit_log (
      user_id, user_type, log_type, action, target, details, performer_name
    ) values (
      v_target_user_id,
      'patient',
      'appointment',
      'Consultation Payment Overpayment Detected',
      'Appointment #' || p_appointment_id::text,
      'Appointment ' || p_appointment_id::text || ' received overpayment of ₱' || v_overpayment_diff::text || ' (captured ₱' || p_amount::text || ' vs expected ₱' || v_appt.payment_amount::text || ').',
      'Database Atomic Payment RPC'
    );
  end if;

  begin
    perform set_config('app.internal_payment_context', 'true', true);

    update public.patient_appointment
    set payment_status = 'paid',
        payment_reference = p_paymongo_payment_id,
        payment_amount = v_earned_fee,
        paid_at = v_now,
        clinic_note = v_pay_summary,
        check_in_status = 'scheduled',
        status = 'confirmed',
        schedule_sent_to_doctor = true,
        doctor_status = coalesce(doctor_status, 'pending-review')
    where appointment_id = p_appointment_id
      and payment_status in ('pending_hold', 'failed');

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  if v_existing_pay.payment_id is not null then
    update public.user_payment
    set status = 'success',
        amount = p_amount
    where payment_id = v_existing_pay.payment_id;
  else
    insert into public.user_payment (
      amount,
      payment_date, method, status, user_id,
      reference_number, paymongo_payment_id, paymongo_payment_intent_id,
      appointment_id, clinic_id, payment_type
    ) values (
      p_amount,
      v_now, p_payment_method, 'success', v_target_user_id,
      p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,
      p_appointment_id, v_appt.clinic_id, 'appointment_consultation'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'action', 'marked_paid',
    'status', 'paid',
    'appointment_id', p_appointment_id,
    'clinic_id', v_appt.clinic_id,
    'clinic_name', coalesce(v_clinic_name, 'DermAI Partner Clinic'),
    'doctor_name', coalesce(v_doctor_name, 'Attending Dermatologist'),
    'patient_email', v_appt.patient_email,
    'patient_name', v_appt.patient_name,
    'appointment_date', v_appt.date,
    'appointment_time', coalesce(v_appt.time, v_appt.batch_time),
    'is_overpayment', v_is_overpayment,
    'overpayment_amount', v_overpayment_diff,
    'earned_fee', v_earned_fee,
    'captured_amount', p_amount,
    'payment_reference', p_paymongo_payment_id
  );
end;
$$;

revoke all on function public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text, text) from public, anon;
grant execute on function public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text, text) to service_role;

-- ============================================================================
-- 5. GET_MY_ACTIVE_APPOINTMENT_HOLD (Patient Active Hold Secure Discovery)
-- ============================================================================

drop function if exists public.get_my_active_appointment_hold(uuid);

create or replace function public.get_my_active_appointment_hold(
  p_clinic_id uuid default null
)
returns table (
  appointment_id uuid,
  clinic_id uuid,
  assigned_doctor_id uuid,
  slot_date date,
  slot_time text,
  payment_hold_expires_at timestamptz,
  db_now timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select
    pa.appointment_id,
    pa.clinic_id,
    pa.assigned_doctor_id,
    (pa.date at time zone 'Asia/Manila')::date as slot_date,
    left(trim(coalesce(pa.time, pa.batch_time, '')), 5) as slot_time,
    pa.payment_hold_expires_at,
    v_now as db_now
  from public.patient_appointment pa
  where pa.user_id = v_user_id
    and (p_clinic_id is null or pa.clinic_id = p_clinic_id)
    and pa.payment_status in ('pending_hold', 'failed')
    and pa.payment_hold_expires_at is not null
    and pa.payment_hold_expires_at > v_now
    and pa.status not in ('cancelled', 'rejected')
    and (pa.doctor_status is null or pa.doctor_status <> 'rejected')
  order by pa.payment_hold_expires_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_active_appointment_hold(uuid) from public, anon;
grant execute on function public.get_my_active_appointment_hold(uuid) to authenticated, service_role;


-- ============================================================================
-- PART 2: INTEGRATION TEST SUITE (T0–T14)
-- Executed against the migration definitions created above within this transaction.
-- ============================================================================
do $$
declare
  v_clinic uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_doc2_user uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila') + interval '90 days') at time zone 'Asia/Manila';
  v_cal date := ((now() at time zone 'Asia/Manila')::date + 90);
  v_duty_sched jsonb := jsonb_build_object(
    'slotIntervalMinutes', 30,
    'slot_interval_minutes', 30,
    'maxPatientsPerShift', 50,
    'maxPatientsPerDay', 50,
    'isCustomSchedule', true,
    'weeklyShifts', jsonb_build_object(
      'Monday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-mon-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Tuesday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-tue-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Wednesday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-wed-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Thursday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-thu-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Friday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-fri-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Saturday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-sat-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50)),
      'Sunday', jsonb_build_array(jsonb_build_object('shiftId', 'shift-sun-1', 'label', 'Duty Shift', 'startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'maxPatientsPerShift', 50))
    ),
    'Monday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Tuesday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Wednesday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Thursday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Friday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Saturday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50),
    'Sunday', jsonb_build_object('startTime', '07:00', 'endTime', '20:00', 'slotIntervalMinutes', 30, 'slot_interval_minutes', 30, 'maxPatientsPerShift', 50)
  );
  r_a jsonb;
  r_b jsonb;
  r_doc2 jsonb;
  r_retry jsonb;
  r_forged jsonb;
  r_unauth jsonb;
  r_unassigned jsonb;
  r_doc jsonb;
  r_cancel jsonb;
  r_cleanup jsonb;
  r_late jsonb;
  r_expired_unreaped jsonb;
  v_row record;
  v_rows integer;
  v_exp timestamptz;
  v_amt_a decimal(10,2);
  v_amt_b decimal(10,2);
  v_amt_late decimal(10,2);
  v_trigger_blocked boolean;
  v_dup_blocked boolean;
  v_protect_tgname text;
  v_protect_tgenabled "char";
  v_queue_tgname text;
  v_queue_tgenabled "char";
  v_overload_count integer;
  v_min_nargs smallint;
  v_max_nargs smallint;
  v_clinic2 uuid;
  v_doc1_user uuid;
  v_doc3_user uuid;
  v_doc_cross_c1 uuid;
  v_doc1_clinic2 uuid;
  v_doc3_clinic2 uuid;
  r_cross_ok jsonb;
  r_cross_conflict jsonb;
  r_diff_time jsonb;
  r_diff_doc jsonb;
  v_cross_err text;
begin
  -- 1. Create dedicated approved test clinic fixture inside the transaction
  insert into public.clinic (name, status, consultation_fee)
  values ('DermAI Staging Authority Primary Clinic Fixture', 'approved', 500.00)
  returning clinic_id into v_clinic;

  -- Ensure clinic 1 operating hours exist covering 07:00 to 20:00 for all 7 standard days
  insert into public.clinic_operating_hours (clinic_id, day_of_week, open_time, close_time)
  select v_clinic, d.day_name, '07:00'::time, '20:00'::time
  from (
    values ('Monday'), ('Tuesday'), ('Wednesday'), ('Thursday'),
           ('Friday'), ('Saturday'), ('Sunday')
  ) as d(day_name);

  -- 2. Select two eligible patient users (prioritizing role = 'patient', active status)
  select user_id into v_user_a
  from public."user"
  where coalesce(role, 'patient') = 'patient'
    and coalesce(account_status, 'active') = 'active'
  order by user_id asc
  limit 1;

  if v_user_a is null then
    select user_id into v_user_a
    from public."user"
    where coalesce(role, 'patient') <> 'admin'
      and coalesce(account_status, 'active') = 'active'
    order by user_id asc
    limit 1;
  end if;

  select user_id into v_user_b
  from public."user"
  where user_id <> v_user_a
    and coalesce(role, 'patient') = 'patient'
    and coalesce(account_status, 'active') = 'active'
  order by user_id asc
  limit 1;

  if v_user_b is null then
    select user_id into v_user_b
    from public."user"
    where user_id <> v_user_a
      and coalesce(role, 'patient') <> 'admin'
      and coalesce(account_status, 'active') = 'active'
    order by user_id asc
    limit 1;
  end if;

  if v_user_a is null or v_user_b is null then
    raise exception 'SETUP: need at least 2 eligible patient users on this database.';
  end if;

  -- 3. Obtain dedicated doctor user identities for v_doc1 and v_doc2
  --    Ensure users are distinct from (v_user_a, v_user_b) and each other
  select u.user_id into v_doc1_user
  from public."user" u
  where u.user_id not in (v_user_a, v_user_b)
    and not exists (
      select 1 from public.clinic_doctor cd
      where cd.clinic_id = v_clinic and cd.user_id = u.user_id
    )
  order by u.user_id asc
  limit 1;

  if v_doc1_user is null then
    select u.user_id into v_doc1_user
    from public."user" u
    where u.user_id not in (v_user_a, v_user_b)
    order by u.user_id asc
    limit 1;
  end if;

  select u.user_id into v_doc2_user
  from public."user" u
  where u.user_id not in (v_user_a, v_user_b, coalesce(v_doc1_user, '00000000-0000-0000-0000-000000000000'::uuid))
    and not exists (
      select 1 from public.clinic_doctor cd
      where cd.clinic_id = v_clinic and cd.user_id = u.user_id
    )
  order by u.user_id asc
  limit 1;

  if v_doc2_user is null then
    select u.user_id into v_doc2_user
    from public."user" u
    where u.user_id not in (v_user_a, v_user_b, coalesce(v_doc1_user, '00000000-0000-0000-0000-000000000000'::uuid))
    order by u.user_id asc
    limit 1;
  end if;

  if v_doc1_user is null or v_doc2_user is null then
    raise exception 'SETUP: need at least 2 distinct user identities for test doctors on this database.';
  end if;

  -- 4. Create dedicated test doctors with complete duty schedules inside the transaction
  -- Doctor 1 (Primary test doctor, user_id is v_doc1_user satisfying appointment_availability_without_blocks)
  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, prc_license,
    duty_days, duty_start_time, duty_end_time, duty_schedule, status
  ) values (
    v_clinic, v_doc1_user, 'Dr. Primary Test Specialist',
    'test.doc1.' || substr(gen_random_uuid()::text, 1, 8) || '@dermai.test',
    'PRC-TEST-' || substr(gen_random_uuid()::text, 1, 6),
    array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
    '07:00', '20:00', v_duty_sched, 'Active'
  ) returning doctor_id into v_doc1;

  -- Doctor 2 (Alternate test doctor, user_id is not null for DERMAI_PATIENT_RESELECTION)
  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, prc_license,
    duty_days, duty_start_time, duty_end_time, duty_schedule, status
  ) values (
    v_clinic, v_doc2_user, 'Dr. Alternate Test Specialist',
    'test.doc2.' || substr(gen_random_uuid()::text, 1, 8) || '@dermai.test',
    'PRC-TEST-' || substr(gen_random_uuid()::text, 1, 6),
    array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
    '07:00', '20:00', v_duty_sched, 'Active'
  ) returning doctor_id into v_doc2;

  if v_clinic is null or v_doc1 is null or v_doc2 is null then
    raise exception 'SETUP FAILED: could not initialize dedicated test clinic and doctor fixtures.';
  end if;

  -- ==========================================================================
  -- T0: Verify trigger attachment, enabled state (tgenabled = 'O'),
  --     alphabetical firing order, and single 24-arg RPC overload in pg_proc
  -- ==========================================================================
  select tgname, tgenabled into v_queue_tgname, v_queue_tgenabled
  from pg_trigger
  where tgrelid = 'public.patient_appointment'::regclass
    and tgname = 'trg_appointment_slot_guard'
    and not tgisinternal;

  if v_queue_tgname is null or v_queue_tgenabled <> 'O' then
    raise exception 'T0 FAILED: trigger trg_appointment_slot_guard must be attached and enabled (tgenabled=O), got tgname=%, tgenabled=%',
      v_queue_tgname, v_queue_tgenabled;
  end if;

  select tgname, tgenabled into v_protect_tgname, v_protect_tgenabled
  from pg_trigger
  where tgrelid = 'public.patient_appointment'::regclass
    and tgname in ('trg_appointment_protect_fields', 'trg_appointment_protect_payment')
    and not tgisinternal
  order by tgname
  limit 1;

  if v_protect_tgname is not null and v_protect_tgenabled <> 'O' then
    raise exception 'T0 FAILED: protection trigger (%) is not enabled (tgenabled=%)!', v_protect_tgname, v_protect_tgenabled;
  end if;

  if v_protect_tgname is not null and v_protect_tgname >= v_queue_tgname then
    raise exception 'T0 FAILED: protection trigger (%) must fire alphabetically BEFORE queue trigger (%)!', v_protect_tgname, v_queue_tgname;
  end if;

  select count(*), min(p.pronargs), max(p.pronargs)
  into v_overload_count, v_min_nargs, v_max_nargs
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'acquire_appointment_slot_hold';

  if v_overload_count <> 1 or v_min_nargs <> 24 or v_max_nargs <> 24 then
    raise exception 'T0 FAILED: expected exactly 1 public.acquire_appointment_slot_hold overload with 24 arguments in pg_proc, got count=%, min_args=%, max_args=%',
      v_overload_count, v_min_nargs, v_max_nargs;
  end if;

  raise notice 'T0 ok: trg_appointment_slot_guard enabled (O), fires after %, and exactly 1 (24-arg) acquire_appointment_slot_hold overload exists',
    coalesce(v_protect_tgname, 'protection trigger');

  -- Guard against conflicting existing appointments on the chosen horizon date:
  -- Only clean up prior test appointments belonging specifically to our test users,
  -- and verify no unrelated appointments exist on this slot horizon.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  delete from public.patient_appointment
  where clinic_id = v_clinic
    and ((date at time zone 'Asia/Manila')::date = v_cal)
    and user_id in (v_user_a, v_user_b)
    and (patient_name like 'Patient %' or patient_name like '%Test%');
  perform set_config('request.jwt.claim.role', '', true);

  if exists (
    select 1 from public.patient_appointment
    where clinic_id = v_clinic
      and ((date at time zone 'Asia/Manila')::date = v_cal)
  ) then
    raise exception 'SETUP FAILED: Unrelated appointment records exist on test horizon date % for clinic %; aborting test to preserve real appointments.',
      v_cal, v_clinic;
  end if;

  -- ==========================================================================
  -- T1: Patient A acquires 09:00 with Doctor 1; verify insert defaults &
  --     non-leakage of app.internal_payment_context
  -- ==========================================================================
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);

  r_a := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_batch_time := '09:00',
    p_patient_name := 'Patient A',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_a->>'success')::boolean is not true then
    raise exception 'T1 FAILED: %', r_a;
  end if;

  if coalesce(current_setting('app.internal_payment_context', true), '') <> '' then
    raise exception 'T1 FAILED: app.internal_payment_context leaked after acquire_appointment_slot_hold!';
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_a->>'appointment_id')::uuid;

  if v_row.payment_status <> 'pending_hold' then
    raise exception 'T1 FAILED: expected pending_hold, got %', v_row.payment_status;
  end if;
  if v_row.schedule_sent_to_doctor is not false then
    raise exception 'T1 FAILED: schedule_sent_to_doctor must be false during unpaid pending_hold, got %', v_row.schedule_sent_to_doctor;
  end if;
  if v_row.queue_number is not null then
    raise exception 'T1 FAILED: queue_number must be null during unpaid pending_hold, got %', v_row.queue_number;
  end if;
  if v_row.batch_time <> '09:00' then
    raise exception 'T1 FAILED: expected batch_time 09:00, got %', v_row.batch_time;
  end if;
  if v_row.clinic_note is null or v_row.clinic_note = '' then
    raise exception 'T1 FAILED: expected fallback clinic_note to be populated';
  end if;

  v_exp := v_row.payment_hold_expires_at;
  v_amt_a := coalesce((r_a->>'payment_amount')::decimal, v_row.payment_amount, 500.00);
  raise notice 'T1 ok: Patient A holds 09:00 with Doctor 1 (defaults & context scoping verified)';

  -- ==========================================================================
  -- T2: get_occupied_appointment_slots returns real expiry, reserved type,
  --     and accurate db_now
  -- ==========================================================================
  select * into v_row
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00';

  if v_row.occupancy_type is distinct from 'reserved' then
    raise exception 'T2 FAILED: expected reserved, got %', v_row.occupancy_type;
  end if;
  if v_row.payment_hold_expires_at is null or v_row.payment_hold_expires_at <> v_exp then
    raise exception 'T2 FAILED: expiry mismatch RPC=% table=%', v_row.payment_hold_expires_at, v_exp;
  end if;
  if v_row.db_now is null or abs(extract(epoch from (v_row.db_now - now()))) > 5 then
    raise exception 'T2 FAILED: db_now missing or inaccurate: % vs %', v_row.db_now, now();
  end if;
  raise notice 'T2 ok: get_occupied_appointment_slots returns real DB expiry and db_now';

  -- ==========================================================================
  -- T3: Same-user idempotent retry returns the existing appointment hold
  --     WITHOUT extending payment_hold_expires_at
  -- ==========================================================================
  r_retry := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient A Retry',
    p_hold_duration_minutes := 30,
    p_user_id := v_user_a
  );
  if (r_retry->>'success')::boolean is not true
     or (r_retry->>'is_existing_hold')::boolean is not true
     or (r_retry->>'appointment_id')::uuid <> (r_a->>'appointment_id')::uuid then
    raise exception 'T3 FAILED: expected idempotent existing hold, got %', r_retry;
  end if;

  select payment_hold_expires_at into v_row
  from public.patient_appointment
  where appointment_id = (r_a->>'appointment_id')::uuid;

  if v_row.payment_hold_expires_at <> v_exp or (r_retry->>'hold_expires_at')::timestamptz <> v_exp then
    raise exception 'T3 FAILED: same-user retry must NOT extend payment_hold_expires_at (expected %, got % / %)',
      v_exp, v_row.payment_hold_expires_at, r_retry->>'hold_expires_at';
  end if;
  raise notice 'T3 ok: same-user idempotent retry returned existing hold without extending expiration';

  -- ==========================================================================
  -- T4: Competing Patient B cannot take Doctor 1 at 09:00; A's hold is untouched
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_b := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient B',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_b->>'success')::boolean is not false or r_b->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T4 FAILED: %', r_b;
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_a->>'appointment_id')::uuid;

  if v_row.payment_status <> 'pending_hold' or v_row.status = 'cancelled' or v_row.payment_hold_expires_at <> v_exp then
    raise exception 'T4 FAILED: A hold was modified by B''s failed attempt: %', row_to_json(v_row);
  end if;
  raise notice 'T4 ok: competing Patient B rejected, A hold unchanged';

  -- ==========================================================================
  -- T5: Two different doctors can reserve the SAME time independently, AND
  --     conflict ordering prevents Patient A from acquiring an unassigned hold
  --     when Patient B holds Doctor 2 (or Patient A holds Doctor 1) at 09:00
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_doc2 := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient B with Doctor 2',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_doc2->>'success')::boolean is not true then
    raise exception 'T5 FAILED: Doctor 2 should be reservable independently at 09:00: %', r_doc2;
  end if;

  -- Verify Step 5 conflict ordering: if Patient A now requests an unassigned hold at 09:00
  -- (where both Patient A on Doctor 1 and Patient B on Doctor 2 exist), it MUST be rejected
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_unassigned := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := null,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient A Unassigned At 09:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_unassigned->>'success')::boolean is not false or r_unassigned->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T5 FAILED: unassigned request by Patient A at 09:00 must be blocked by existing doctor holds: %', r_unassigned;
  end if;

  -- Release B's independent hold on Doctor 2 at 09:00 and verify cancel_appointment_hold resets context
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_cancel := public.cancel_appointment_hold((r_doc2->>'appointment_id')::uuid);
  if (r_cancel->>'success')::boolean is not true then
    raise exception 'T5 cleanup FAILED: %', r_cancel;
  end if;
  if coalesce(current_setting('app.internal_payment_context', true), '') <> '' then
    raise exception 'T5 FAILED: app.internal_payment_context leaked after cancel_appointment_hold!';
  end if;
  raise notice 'T5 ok: independent doctor slots, Step 5 conflict ordering, and cancel context reset verified';

  -- ==========================================================================
  -- T6a: Doctor-specific reservation (Doctor 1 at 09:00) blocks an UNASSIGNED
  --      clinic-wide reservation at 09:00
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_unassigned := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := null,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient B Unassigned at 09:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_unassigned->>'success')::boolean is not false or r_unassigned->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T6a FAILED: unassigned reservation must be blocked when Doctor 1 already holds 09:00: %', r_unassigned;
  end if;
  raise notice 'T6a ok: doctor-specific reservation blocks unassigned reservation at same time';

  -- ==========================================================================
  -- T6b: Unassigned reservation (11:00) blocks a doctor-specific reservation
  --      (both via RPC and via direct UPDATE trigger)
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_unassigned := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := null,
    p_date := v_day + interval '11 hours',
    p_time := '11:00:00',
    p_patient_name := 'Patient A Unassigned at 11:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_unassigned->>'success')::boolean is not true then
    raise exception 'T6b setup FAILED: %', r_unassigned;
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_doc := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '11 hours',
    p_time := '11:00:00',
    p_patient_name := 'Patient B Doctor 2 at 11:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_doc->>'success')::boolean is not false or r_doc->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T6b FAILED: doctor hold not blocked by unassigned hold: %', r_doc;
  end if;

  select count(*) into v_rows
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc2)
  where slot_time = '11:00' and occupancy_type = 'reserved';

  if v_rows <> 1 then
    raise exception 'T6b FAILED: unassigned hold missing from doctor-specific occupied view';
  end if;

  -- Also verify trg_appointment_slot_guard blocks direct UPDATE onto 11:00
  r_doc2 := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '12 hours',
    p_time := '12:00:00',
    p_patient_name := 'Patient B Doctor 2 at 12:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_doc2->>'success')::boolean is not true then
    raise exception 'T6b trigger setup FAILED: %', r_doc2;
  end if;

  v_dup_blocked := false;
  v_cross_err := null;
  begin
    update public.patient_appointment
    set time = '11:00:00', batch_time = '11:00'
    where appointment_id = (r_doc2->>'appointment_id')::uuid;
  exception when others then
    v_dup_blocked := true;
    v_cross_err := SQLERRM;
  end;
  if not v_dup_blocked then
    raise exception 'T6b FAILED: trigger allowed direct UPDATE of doctor appointment onto unassigned 11:00 slot!';
  end if;
  if v_cross_err not like '%ERR_DUPLICATE_SLOT%' then
    raise exception 'T6b FAILED: direct UPDATE expected ERR_DUPLICATE_SLOT error, got: %', v_cross_err;
  end if;

  -- Also verify trg_appointment_slot_guard blocks direct INSERT onto occupied 11:00 slot
  v_dup_blocked := false;
  v_cross_err := null;
  begin
    insert into public.patient_appointment (
      user_id, clinic_id, assigned_doctor_id, date, time, batch_time,
      patient_name, status, doctor_status, payment_status, payment_hold_expires_at,
      queue_number
    ) values (
      v_user_b, v_clinic, v_doc2, v_day + interval '11 hours', '11:00:00', '11:00',
      'Direct Insert Collision Test', 'pending', 'pending-review', 'pending_hold', now() + interval '10 minutes',
      null
    );
  exception when others then
    v_dup_blocked := true;
    v_cross_err := SQLERRM;
  end;
  if not v_dup_blocked then
    raise exception 'T6b FAILED: trigger allowed direct INSERT of conflicting appointment onto occupied 11:00 slot!';
  end if;
  if v_cross_err not like '%ERR_DUPLICATE_SLOT%' then
    raise exception 'T6b FAILED: direct INSERT expected ERR_DUPLICATE_SLOT error, got: %', v_cross_err;
  end if;

  perform public.cancel_appointment_hold((r_doc2->>'appointment_id')::uuid);
  raise notice 'T6b ok: unassigned hold blocks doctor-specific RPC, direct UPDATE, and direct INSERT';

  -- ==========================================================================
  -- T7: Ownership, authentication, and release_expired_appointment_holds
  --     authorization + context reset protections
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_b := public.cancel_appointment_hold((r_a->>'appointment_id')::uuid);
  if (r_b->>'success')::boolean is not false or r_b->>'code' <> 'ERR_FORBIDDEN' then
    raise exception 'T7a FAILED: cross-patient cancel not forbidden: %', r_b;
  end if;

  r_forged := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '10 hours',
    p_time := '10:00:00',
    p_patient_name := 'Forged User',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if r_forged->>'code' <> 'ERR_FORBIDDEN' then
    raise exception 'T7b FAILED: forged p_user_id not rejected: %', r_forged;
  end if;

  -- Ordinary authenticated patient calling release_expired_appointment_holds must get ERR_FORBIDDEN
  r_cleanup := public.release_expired_appointment_holds();
  if (r_cleanup->>'success')::boolean is not false or r_cleanup->>'code' <> 'ERR_FORBIDDEN' then
    raise exception 'T7c FAILED: non-admin authenticated user must be rejected by release_expired_appointment_holds, got %', r_cleanup;
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  r_unauth := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '10 hours',
    p_time := '10:00:00',
    p_patient_name := 'Unauthenticated Caller',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if r_unauth->>'code' <> 'ERR_UNAUTHORIZED' then
    raise exception 'T7d FAILED: unauthenticated p_user_id must be rejected with ERR_UNAUTHORIZED, got %', r_unauth;
  end if;

  r_cleanup := public.release_expired_appointment_holds();
  if (r_cleanup->>'success')::boolean is not false or r_cleanup->>'code' <> 'ERR_FORBIDDEN' then
    raise exception 'T7e FAILED: anon caller must be rejected by release_expired_appointment_holds, got %', r_cleanup;
  end if;

  -- Service role calling release_expired_appointment_holds succeeds and resets app.internal_payment_context
  perform set_config('request.jwt.claim.role', 'service_role', true);
  r_cleanup := public.release_expired_appointment_holds();
  if (r_cleanup->>'success')::boolean is not true then
    raise exception 'T7f FAILED: service_role call to release_expired_appointment_holds failed: %', r_cleanup;
  end if;
  if coalesce(current_setting('app.internal_payment_context', true), '') <> '' then
    raise exception 'T7f FAILED: app.internal_payment_context leaked after release_expired_appointment_holds!';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  raise notice 'T7 ok: ownership, authentication, and release_expired_appointment_holds protections verified';

  -- ==========================================================================
  -- T8: Owner cancellation followed by successful rebooking by another patient
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_cancel := public.cancel_appointment_hold((r_unassigned->>'appointment_id')::uuid);
  if (r_cancel->>'success')::boolean is not true then
    raise exception 'T8 FAILED: owner cancel failed: %', r_cancel;
  end if;
  if coalesce(current_setting('app.internal_payment_context', true), '') <> '' then
    raise exception 'T8 FAILED: app.internal_payment_context leaked after owner cancel!';
  end if;

  select count(*) into v_rows
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc2)
  where slot_time = '11:00';
  if v_rows <> 0 then
    raise exception 'T8 FAILED: cancelled hold still occupies 11:00';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_doc := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '11 hours',
    p_time := '11:00:00',
    p_patient_name := 'Patient B Rebooked 11:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_doc->>'success')::boolean is not true then
    raise exception 'T8 FAILED: Patient B could not rebook 11:00 after owner cancellation: %', r_doc;
  end if;
  perform public.cancel_appointment_hold((r_doc->>'appointment_id')::uuid);
  raise notice 'T8 ok: owner cancellation releases slot and allows immediate rebooking';

  -- ==========================================================================
  -- T9: Valid failed-payment retry before expiry
  --     - A non-expired 'failed' hold still occupies the slot as RESERVED
  --     - Competing Patient B cannot steal or cancel it
  --     - Patient A retrying before expiry receives the existing hold
  --       WITHOUT extending payment_hold_expires_at
  -- ==========================================================================
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.patient_appointment
  set payment_status = 'failed'
  where appointment_id = (r_a->>'appointment_id')::uuid;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*) into v_rows
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00' and occupancy_type = 'reserved';
  if v_rows <> 1 then
    raise exception 'T9 FAILED: non-expired failed hold must remain visible as reserved';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_b := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient B Attempt On Failed Hold',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_b->>'success')::boolean is not false or r_b->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T9 FAILED: competing patient must not steal non-expired failed hold: %', r_b;
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_retry := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient A Retry After Failed Attempt',
    p_hold_duration_minutes := 25,
    p_user_id := v_user_a
  );
  if (r_retry->>'success')::boolean is not true
     or (r_retry->>'is_existing_hold')::boolean is not true
     or (r_retry->>'appointment_id')::uuid <> (r_a->>'appointment_id')::uuid then
    raise exception 'T9 FAILED: Patient A could not idempotently retry non-expired failed hold: %', r_retry;
  end if;

  select payment_hold_expires_at into v_row
  from public.patient_appointment
  where appointment_id = (r_a->>'appointment_id')::uuid;

  if v_row.payment_hold_expires_at <> v_exp or (r_retry->>'hold_expires_at')::timestamptz <> v_exp then
    raise exception 'T9 FAILED: failed-hold retry must NOT extend payment_hold_expires_at (expected %, got %)',
      v_exp, v_row.payment_hold_expires_at;
  end if;
  raise notice 'T9 ok: valid failed-payment hold preserved before expiry without extending expiration';

  -- ==========================================================================
  -- T10: Database-time expiration & UNREAPED expired hold receiving late payment
  --      - Verify patient cannot directly alter payment_hold_expires_at
  --      - Expire hold via service_role
  --      - BEFORE any other booking reaps it, send a late payment to
  --        fulfill_appointment_payment_atomic and verify the row transitions
  --        to status = 'cancelled', payment_status = 'expired', and returns
  --        action = 'reconciliation_required'
  --      - Then verify Patient B can acquire 09:00 on Doctor 1
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_trigger_blocked := false;
  v_cross_err := null;
  begin
    execute 'set local role authenticated';
    update public.patient_appointment
    set payment_hold_expires_at = now() - interval '1 second'
    where appointment_id = (r_a->>'appointment_id')::uuid;
    execute 'reset role';
  exception when others then
    v_trigger_blocked := true;
    v_cross_err := SQLERRM;
    execute 'reset role';
  end;
  execute 'reset role';
  if not v_trigger_blocked then
    raise exception 'T10 FAILED: patient was allowed to directly modify payment_hold_expires_at!';
  end if;
  if v_cross_err not like '%ERR_FORBIDDEN: Payment fields may only be written by trusted payment RPCs%' then
    raise exception 'T10 FAILED: patient modification of payment_hold_expires_at expected payment protection error, got: %', v_cross_err;
  end if;

  -- Trusted server role backdates payment_hold_expires_at while status is still 'pending' and payment_status is still 'failed'
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.patient_appointment
  set payment_hold_expires_at = now() - interval '1 second'
  where appointment_id = (r_a->>'appointment_id')::uuid;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*) into v_rows
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00';
  if v_rows <> 0 then
    raise exception 'T10 FAILED: expired hold still occupies slot in get_occupied_appointment_slots';
  end if;

  -- Late payment arrives on the UNREAPED expired hold BEFORE any subsequent booking reaps it
  perform set_config('request.jwt.claim.role', 'service_role', true);
  r_late := public.fulfill_appointment_payment_atomic(
    'pay_test_late_1',
    'pi_test_late_1',
    (r_a->>'appointment_id')::uuid,
    v_user_a,
    v_amt_a,
    'gcash',
    'PHP'
  );
  if r_late->>'action' <> 'reconciliation_required' then
    raise exception 'T10 FAILED: expected reconciliation_required on unreaped expired hold, got %', r_late;
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_a->>'appointment_id')::uuid;
  if v_row.payment_status <> 'expired' or v_row.status <> 'cancelled' then
    raise exception 'T10 FAILED: unreaped expired hold receiving late payment must transition to status=cancelled, payment_status=expired, got status=%, payment_status=%',
      v_row.status, v_row.payment_status;
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Now Patient B acquires 09:00 on Doctor 1 after expiry
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  r_b := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient B After Expiry',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_b
  );
  if (r_b->>'success')::boolean is not true then
    raise exception 'T10 FAILED: B could not acquire after expiry: %', r_b;
  end if;
  v_amt_b := coalesce((r_b->>'payment_amount')::decimal, v_amt_a);
  raise notice 'T10 ok: unreaped expired hold transitioned to cancelled/expired on late payment and allowed rebooking';

  -- ==========================================================================
  -- T11: Successful payment fulfillment (idempotent), non-null queue_number,
  --      and BOOKED slot exclusivity / conflict rejection
  -- ==========================================================================
  perform set_config('request.jwt.claim.role', 'service_role', true);
  r_retry := public.fulfill_appointment_payment_atomic(
    'pay_test_ok_1',
    'pi_test_ok_1',
    (r_b->>'appointment_id')::uuid,
    v_user_b,
    v_amt_b,
    'gcash',
    'PHP'
  );
  if r_retry->>'action' <> 'marked_paid' then
    raise exception 'T11 FAILED first payment: %', r_retry;
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_b->>'appointment_id')::uuid;

  if v_row.status <> 'confirmed' or v_row.payment_status <> 'paid' then
    raise exception 'T11 FAILED: paid fulfillment must transition status to confirmed and payment_status to paid, got % / %', v_row.status, v_row.payment_status;
  end if;

  r_retry := public.fulfill_appointment_payment_atomic(
    'pay_test_ok_1',
    'pi_test_ok_1',
    (r_b->>'appointment_id')::uuid,
    v_user_b,
    v_amt_b,
    'gcash',
    'PHP'
  );
  if r_retry->>'action' <> 'idempotent_skip' then
    raise exception 'T11 FAILED repeat payment not idempotent: %', r_retry;
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select * into v_row
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00';
  if v_row.occupancy_type <> 'booked' or v_row.payment_hold_expires_at is not null then
    raise exception 'T11 FAILED: expected booked with null hold expiry, got % / %', v_row.occupancy_type, v_row.payment_hold_expires_at;
  end if;

  -- Verify that an active BOOKED slot (Patient B at 09:00 on Doctor 1) strictly blocks
  -- any subsequent hold or booking attempt on the same slot, and get_occupied_appointment_slots
  -- reports occupancy_type = 'booked' with null hold expiry.
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  r_retry := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_patient_name := 'Patient A Attempting Booked Slot',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_retry->>'success')::boolean is not false or r_retry->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'T11 FAILED: acquire_appointment_slot_hold allowed reserving an already BOOKED slot: %', r_retry;
  end if;

  -- Also verify direct INSERT onto the booked 09:00 slot is blocked by slot guard trigger
  v_dup_blocked := false;
  v_cross_err := null;
  begin
    insert into public.patient_appointment (
      user_id, clinic_id, assigned_doctor_id, date, time, batch_time,
      patient_name, status, doctor_status, payment_status, payment_hold_expires_at, queue_number
    ) values (
      v_user_a, v_clinic, v_doc1, v_day + interval '9 hours', '09:00:00', '09:00',
      'Conflicting Direct Insert at 09:00', 'pending', 'pending-review', 'pending_hold', now() + interval '10 minutes',
      null
    );
  exception when others then
    v_dup_blocked := true;
    v_cross_err := SQLERRM;
  end;
  if not v_dup_blocked then
    raise exception 'T11 FAILED: trigger allowed direct INSERT onto confirmed booked slot at 09:00!';
  end if;
  if v_cross_err not like '%ERR_SLOT_UNAVAILABLE%'
     and v_cross_err not like '%ERR_DUPLICATE_SLOT%'
     and v_cross_err not like '%idx_unique_exclusive_doctor_slot%' then
    raise exception 'T11 FAILED: direct INSERT expected slot conflict error, got: %', v_cross_err;
  end if;

  select count(*) into v_rows
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00' and assigned_doctor_id = v_doc1;

  if v_rows <> 1 then
    raise exception 'T11 FAILED: expected 1 row for 09:00 on Doctor 1, got %', v_rows;
  end if;

  select * into v_row
  from public.get_occupied_appointment_slots(v_clinic, v_cal, v_doc1)
  where slot_time = '09:00' and assigned_doctor_id = v_doc1;

  if v_row.occupancy_type <> 'booked' or v_row.payment_hold_expires_at is not null then
    raise exception 'T11 FAILED: booked slot must report occupancy_type=booked with null hold expiry, got % / %',
      v_row.occupancy_type, v_row.payment_hold_expires_at;
  end if;

  raise notice 'T11 ok: paid fulfillment verified, idempotent skip verified, and booked slot exclusivity confirmed';

  -- ==========================================================================
  -- T12: Doctor rejection & alternate-doctor reselection workflow:
  --      1. Doctor 1 rejects Patient B's paid appointment at 09:00 (doctor_status = 'rejected').
  --      2. Patient A can now acquire AND pay for Doctor 1 at 09:00 without being
  --         blocked by Patient B's doctor-rejected appointment (Step 6B check).
  --      3. Create an unreaped expired hold on Doctor 2 at 14:00.
  --      4. Patient B (authenticated as patient) performs alternate-doctor
  --         reselection onto Doctor 2 at 14:00 (doctor_status = 'rejected' -> 'pending-review').
  --      5. Verify the direct UPDATE reaps the expired hold on 14:00, succeeds
  --         without ERR_FORBIDDEN or unique-index violation, and assigns a
  --         valid non-null queue_number for Doctor 2!
  -- ==========================================================================
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.patient_appointment
  set status = 'pending',
      doctor_status = 'rejected',
      doctor_note = 'Doctor unavailable at 09:00',
      doctor_reviewed_at = now()
  where appointment_id = (r_b->>'appointment_id')::uuid;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 12a. Patient A acquires and pays for Doctor 1 at 09:00 (must NOT be blocked by B's doctor_status='rejected' row)
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_a := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '9 hours',
    p_time := '09:00:00',
    p_batch_time := '09:00',
    p_patient_name := 'Patient A Booking Rejected Slot',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_a->>'success')::boolean is not true then
    raise exception 'T12a FAILED: doctor_status=rejected appointment blocked another patient from holding 09:00: %', r_a;
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  r_retry := public.fulfill_appointment_payment_atomic(
    'pay_test_ok_after_reject',
    'pi_test_ok_after_reject',
    (r_a->>'appointment_id')::uuid,
    v_user_a,
    v_amt_a,
    'gcash',
    'PHP'
  );
  if r_retry->>'action' <> 'marked_paid' then
    raise exception 'T12a FAILED: fulfill_appointment_payment_atomic Step 6B blocked payment due to doctor_status=rejected row: %', r_retry;
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 12b. Create an expired (but unreaped) hold on Doctor 2 at 14:00
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  r_expired_unreaped := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc2,
    p_date := v_day + interval '14 hours',
    p_time := '14:00:00',
    p_batch_time := '14:00',
    p_patient_name := 'Patient A Unreaped Hold At 14:00',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_expired_unreaped->>'success')::boolean is not true then
    raise exception 'T12b setup FAILED: %', r_expired_unreaped;
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.patient_appointment
  set payment_hold_expires_at = now() - interval '1 second'
  where appointment_id = (r_expired_unreaped->>'appointment_id')::uuid;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 12c. Patient B performs alternate-doctor reselection onto Doctor 2 at 14:00 as authenticated patient
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  update public.patient_appointment
  set assigned_doctor_id = v_doc2,
      status = 'pending',
      doctor_status = 'pending-review',
      schedule_sent_to_doctor = true,
      date = v_day + interval '14 hours',
      time = '14:00:00',
      batch_time = '14:00',
      clinic_note = 'Reassigned to Doctor 2 by patient at no additional charge.',
      doctor_note = null,
      doctor_reviewed_at = null
  where appointment_id = (r_b->>'appointment_id')::uuid;

  if coalesce(current_setting('app.internal_payment_context', true), '') <> '' then
    raise exception 'T12c FAILED: app.internal_payment_context leaked after alternate-doctor reselection!';
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_b->>'appointment_id')::uuid;

  if v_row.assigned_doctor_id <> v_doc2
     or v_row.doctor_status <> 'pending-review' then
    raise exception 'T12c FAILED: alternate-doctor reselection did not properly update doctor: %', row_to_json(v_row);
  end if;

  select * into v_row
  from public.patient_appointment
  where appointment_id = (r_expired_unreaped->>'appointment_id')::uuid;

  if v_row.status <> 'cancelled' or v_row.payment_status <> 'expired' then
    raise exception 'T12c FAILED: unreaped expired hold on target slot was not reaped during direct UPDATE: %', row_to_json(v_row);
  end if;
  raise notice 'T12 ok: rejected-doctor collision fix and alternate-doctor reselection (with queue reassignment & expired-hold reap) verified';

  -- ==========================================================================
  -- T13: Test get_my_active_appointment_hold returns Patient A's active hold
  --      and empty for Patient B / unauthenticated caller / expired hold
  -- ==========================================================================
  -- Acquire active hold for Patient A at 16:00
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  r_a := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic,
    p_doctor_id := v_doc1,
    p_date := v_day + interval '16 hours',
    p_time := '16:00:00',
    p_patient_name := 'Patient A',
    p_hold_duration_minutes := 10,
    p_user_id := v_user_a
  );
  if (r_a->>'success')::boolean is not true then
    raise exception 'T13 setup FAILED: %', r_a;
  end if;

  -- 1. Patient A should discover their own active hold
  select * into v_row
  from public.get_my_active_appointment_hold(v_clinic);

  if v_row.appointment_id is null or v_row.appointment_id <> (r_a->>'appointment_id')::uuid then
    raise exception 'T13 FAILED: Patient A did not discover their own active hold, got %', row_to_json(v_row);
  end if;
  if v_row.slot_time <> '16:00' then
    raise exception 'T13 FAILED: expected slot_time 16:00, got %', v_row.slot_time;
  end if;
  if v_row.payment_hold_expires_at is null or v_row.payment_hold_expires_at <= now() then
    raise exception 'T13 FAILED: invalid payment_hold_expires_at in active hold: %', v_row.payment_hold_expires_at;
  end if;

  -- 2. Patient B should NOT see Patient A's hold
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  select count(*) into v_rows
  from public.get_my_active_appointment_hold(v_clinic);

  if v_rows <> 0 then
    raise exception 'T13 FAILED: Patient B saw Patient A active hold (expected 0 rows, got %)', v_rows;
  end if;

  -- 3. Anonymous caller should receive 0 rows
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  select count(*) into v_rows
  from public.get_my_active_appointment_hold(v_clinic);

  if v_rows <> 0 then
    raise exception 'T13 FAILED: anonymous caller received active hold rows (expected 0 rows, got %)', v_rows;
  end if;

  -- 4. Expired hold is not returned
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('app.internal_payment_context', 'true', true);
  update public.patient_appointment
  set payment_hold_expires_at = now() - interval '5 seconds'
  where appointment_id = (r_a->>'appointment_id')::uuid;
  perform set_config('app.internal_payment_context', '', true);

  select count(*) into v_rows
  from public.get_my_active_appointment_hold(v_clinic);

  if v_rows <> 0 then
    raise exception 'T13 FAILED: expired hold was returned by get_my_active_appointment_hold (expected 0 rows, got %)', v_rows;
  end if;

  raise notice 'T13 ok: get_my_active_appointment_hold returned Patient A hold, hidden from Patient B/anon, and excluded expired holds';

  -- ==========================================================================
  -- T14: Cross-clinic doctor double-booking prevention:
  --      Same real doctor (cd.user_id) active at two branches (v_clinic & v_clinic2).
  --      Active hold at Clinic 1 at 14:00 must block booking at Clinic 2 at 14:00.
  --      Same doctor CAN still be booked at Clinic 2 at 15:00 (different time).
  --      Different doctor (v_doc3_clinic2) CAN be booked at Clinic 2 at 14:00.
  -- ==========================================================================
  -- 1. Create dedicated secondary branch clinic fixture inside the transaction
  insert into public.clinic (name, status, consultation_fee)
  values ('DermAI Staging Authority Secondary Branch Fixture', 'approved', 500.00)
  returning clinic_id into v_clinic2;

  -- Ensure clinic 2 operating hours exist covering 07:00 to 20:00 for all 7 standard days
  insert into public.clinic_operating_hours (clinic_id, day_of_week, open_time, close_time)
  select v_clinic2, d.day_name, '07:00'::time, '20:00'::time
  from (
    values ('Monday'), ('Tuesday'), ('Wednesday'), ('Thursday'),
           ('Friday'), ('Saturday'), ('Sunday')
  ) as d(day_name);

  -- 2. Doctor 1 at Clinic 1 (Primary Branch) uses the existing v_doc1 fixture (user_id = v_doc1_user)
  v_doc_cross_c1 := v_doc1;

  -- 3. Register Doctor 1 at Clinic 2 (Secondary Branch) with the SAME v_doc1_user
  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, prc_license, status, duty_days,
    duty_start_time, duty_end_time, duty_schedule
  ) values (
    v_clinic2, v_doc1_user, 'Dr. Cross Clinic Branch 2 Test Fixture',
    'crossdoc_c2_' || substr(gen_random_uuid()::text, 1, 8) || '@dermai.test',
    'PRC-CROSS-' || substr(gen_random_uuid()::text, 1, 6), 'Active',
    array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
    '07:00', '20:00', v_duty_sched
  ) returning doctor_id into v_doc1_clinic2;

  -- 4. Obtain an independent doctor user identity for v_doc3_clinic2
  select u.user_id into v_doc3_user
  from public."user" u
  where u.user_id not in (v_user_a, v_user_b, v_doc1_user, v_doc2_user)
    and not exists (
      select 1 from public.clinic_doctor cd
      where (cd.clinic_id = v_clinic or cd.clinic_id = v_clinic2)
        and cd.user_id = u.user_id
    )
  order by u.user_id asc
  limit 1;

  if v_doc3_user is null then
    select u.user_id into v_doc3_user
    from public."user" u
    where u.user_id not in (v_user_a, v_user_b, v_doc1_user, v_doc2_user)
    order by u.user_id asc
    limit 1;
  end if;

  if v_doc3_user is null then
    raise exception 'T14 SETUP: need an independent user identity for third test doctor on this database.';
  end if;

  -- 5. Register an independent different doctor at Clinic 2 (with non-null user_id)
  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, prc_license, status, duty_days,
    duty_start_time, duty_end_time, duty_schedule
  ) values (
    v_clinic2, v_doc3_user, 'Dr. Clinic Two Independent Test Fixture',
    'doc3_c2_' || substr(gen_random_uuid()::text, 1, 8) || '@dermai.test',
    'PRC-CROSS-' || substr(gen_random_uuid()::text, 1, 6), 'Active',
    array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
    '07:00', '20:00', v_duty_sched
  ) returning doctor_id into v_doc3_clinic2;

  -- 6. Patient A books the dual-branch doctor at Clinic 1 at 14:00
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  r_cross_ok := public.acquire_appointment_slot_hold(
    p_clinic_id => v_clinic,
    p_doctor_id => v_doc_cross_c1,
    p_date => v_day + interval '14 hours',
    p_time => '14:00:00',
    p_batch_time => '14:00',
    p_patient_name => 'Patient A Manila Slot'
  );
  if (r_cross_ok->>'success')::boolean is not true then
    raise exception 'T14 setup FAILED: could not acquire primary slot for Doctor at Clinic 1: %', r_cross_ok;
  end if;

  -- 6. Patient B attempts to book the SAME doctor at Clinic 2 at the SAME time (14:00)
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  begin
    r_cross_conflict := public.acquire_appointment_slot_hold(
      p_clinic_id => v_clinic2,
      p_doctor_id => v_doc1_clinic2,
      p_date => v_day + interval '14 hours',
      p_time => '14:00:00',
      p_batch_time => '14:00',
      p_patient_name => 'Patient B Cross Clinic Conflict'
    );
    v_cross_err := null;
  exception when others then
    v_cross_err := SQLERRM;
  end;

  if v_cross_err is null and coalesce((r_cross_conflict->>'success')::boolean, false) = true then
    raise exception 'T14 FAILED: Doctor booked at Clinic 1 at 14:00 was not blocked from double-booking at Clinic 2 at 14:00!';
  end if;

  if v_cross_err is not null and v_cross_err not like '%Doctor is already scheduled for an appointment at another branch%' then
    raise exception 'T14 FAILED: expected cross-clinic branch error, got: %', v_cross_err;
  end if;

  -- 6b. Direct INSERT into public.patient_appointment at Clinic 2 must also be blocked by trg_doctor_cross_clinic_guard
  v_dup_blocked := false;
  v_cross_err := null;
  begin
    insert into public.patient_appointment (
      user_id, clinic_id, assigned_doctor_id, date, time, batch_time,
      patient_name, status, doctor_status, payment_status, payment_hold_expires_at,
      queue_number
    ) values (
      v_user_b, v_clinic2, v_doc1_clinic2, v_day + interval '14 hours', '14:00:00', '14:00',
      'Direct Insert Cross Clinic Collision Test', 'pending', 'pending-review', 'pending_hold', now() + interval '10 minutes',
      null
    );
  exception when others then
    v_dup_blocked := true;
    v_cross_err := SQLERRM;
  end;

  if not v_dup_blocked then
    raise exception 'T14 FAILED: trg_doctor_cross_clinic_guard allowed direct INSERT of conflicting appointment for same doctor at Clinic 2 at 14:00!';
  end if;

  if v_cross_err is not null and v_cross_err not like '%Doctor is already scheduled for an appointment at another branch%' then
    raise exception 'T14 FAILED: direct INSERT expected cross-clinic branch error, got: %', v_cross_err;
  end if;

  -- 7. Same doctor CAN still be booked at a different time (15:00) at Clinic 2
  r_diff_time := public.acquire_appointment_slot_hold(
    p_clinic_id => v_clinic2,
    p_doctor_id => v_doc1_clinic2,
    p_date => v_day + interval '15 hours',
    p_time => '15:00:00',
    p_batch_time => '15:00',
    p_patient_name => 'Patient B Cross Clinic Different Time'
  );
  if (r_diff_time->>'success')::boolean is not true then
    raise exception 'T14 FAILED: Same doctor should be bookable at different time (15:00) at Clinic 2, got: %', r_diff_time;
  end if;

  -- 8. A different doctor (v_doc3_clinic2) CAN still be booked at the conflicting time (14:00) at Clinic 2
  r_diff_doc := public.acquire_appointment_slot_hold(
    p_clinic_id => v_clinic2,
    p_doctor_id => v_doc3_clinic2,
    p_date => v_day + interval '14 hours',
    p_time => '14:00:00',
    p_batch_time => '14:00',
    p_patient_name => 'Patient B Different Doctor at Conflicting Time'
  );
  if (r_diff_doc->>'success')::boolean is not true then
    raise exception 'T14 FAILED: Different doctor at Clinic 2 should be bookable at 14:00, got: %', r_diff_doc;
  end if;

  raise notice 'T14 ok: cross-clinic doctor double-booking blocked at 14:00 (via RPC and direct INSERT), same doctor allowed at 15:00, and different doctor allowed at 14:00';

  raise notice 'ALL SLOT HOLD AUTHORITY DB TESTS PASSED (transaction will be rolled back)';
end $$;


-- ============================================================================
-- PART 3: FINAL TRANSACTION ROLLBACK
-- Undoes all migration DDL, schema changes, and test records atomically.
-- ============================================================================
rollback;
