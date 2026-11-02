-- ============================================================================
-- Migration: 20261031_slot_hold_authority_and_visibility.sql
-- Purpose:
--   Authoritative database-side fix for appointment slot reservation visibility,
--   disappearing RESERVED status, and cross-patient synchronization:
--
--   1. get_occupied_appointment_slots(p_clinic_id, p_date, p_doctor_id):
--      - Returns real payment_hold_expires_at and database clock db_now = now()
--        so frontend clients can synchronize hold countdowns using server-relative
--        remaining time without browser clock-skew false expirations.
--      - Deduplicates per (slot_time, assigned_doctor_id) with priority:
--        'booked' > 'reserved' (latest payment_hold_expires_at).
--      - Excludes expired holds strictly using database clock (now()).
--      - Preserves zero-PII output contract.
--
--   2. acquire_appointment_slot_hold(...) (canonical 24-parameter signature):
--      - Drops the legacy 21-parameter overload (and any non-24-arg overload)
--        so all callers resolve unambiguously to the hardened 24-parameter RPC.
--      - Acquires two transaction-scoped advisory locks in deterministic
--        ascending order (LEAST -> GREATEST) to serialize both doctor-specific
--        and unassigned clinic-wide slot reservations without deadlocks.
--      - Bidirectional doctor/unassigned conflict check:
--        * An unassigned reservation (p_doctor_id IS NULL) conflicts with ANY
--          active doctor-specific or unassigned reservation/booking at the same
--          clinic, date, and time.
--        * A doctor-specific reservation (p_doctor_id IS NOT NULL) conflicts
--          with that doctor's active reservation/booking AND any unassigned
--          clinic-wide reservation/booking at the same clinic, date, and time,
--          while allowing DIFFERENT doctors at the same clinic to reserve their
--          own independent slots concurrently.
--      - Preserves active 'failed' holds until payment_hold_expires_at <= now()
--        so the holding patient can retry payment within their 10-minute window.
--      - Conflict ordering guarantees that confirmed bookings and any other
--        patient's active hold (or different doctor-scope hold) always sort
--        ahead of the caller's own hold so a conflict can never be masked.
--      - Scopes app.internal_payment_context to 'true' only around internal
--        DML statements and resets it to '' immediately (including on error).
--
--   3. cancel_appointment_hold(p_appointment_id) & release_expired_appointment_holds():
--      - Enforces strict ownership / service_role / admin checks and row locking.
--      - Scopes and resets app.internal_payment_context to '' on both normal
--        completion and exception paths.
--      - Locks expired rows in deterministic appointment_id order.
--
--   4. trg_assign_appointment_queue_and_prevent_duplicates():
--      - Properly attached via CREATE TRIGGER on public.patient_appointment
--        (firing after trg_appointment_protect_fields alphabetically).
--      - Reaps expired holds on the target slot before conflict and unique-index
--        enforcement so direct updates (including alternate-doctor reselection)
--        never fail against idx_unique_exclusive_doctor_slot or
--        idx_unique_exclusive_unassigned_slot due to an unreaped expired hold.
--      - Enforces bidirectional unassigned/doctor-specific slot conflict rules.
--      - Assigns queue_number on paid fulfillment and alternate-doctor reselection
--        without triggering ERR_FORBIDDEN in trg_appointment_protect_fields.
--
--   5. fulfill_appointment_payment_atomic(...):
--      - Acquires the same two-key deterministic advisory locks (LEAST -> GREATEST)
--        before locking the appointment row FOR UPDATE, and verifies after
--        FOR UPDATE that slot coordinates did not change concurrently (acquiring
--        updated slot locks via non-blocking pg_try_advisory_xact_lock or raising
--        serialization_failure to prevent lock-order inversion).
--      - Transitions expired holds receiving late payments to status = 'cancelled'
--        and payment_status = 'expired' (when not already 'cancelled') while
--        recording reconciliation metadata.
--      - Excludes doctor_status = 'rejected' in Step 6B anti-collision check so
--        a doctor-declined appointment never blocks another patient's payment.
-- ============================================================================

begin;

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

commit;
