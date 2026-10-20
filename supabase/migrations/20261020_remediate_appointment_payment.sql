-- ============================================================================
-- DermAI Migration: Appointment Payment Critical Remediation (Phase 3)
-- Migration ID: 20261020_remediate_appointment_payment.sql
--
-- Objective:
--   1. Create `app_feature_flag` table to gate simulated payments server-side
--      (disabled by default in production).
--   2. Install `trg_appointment_protect_payment` BEFORE INSERT OR UPDATE trigger
--      to block untrusted clients from directly setting or altering payment-authoritative
--      fields (`payment_status`, `paid_at`, `payment_reference`, `payment_amount`,
--      `queue_number`, `payment_hold_expires_at`).
--   3. Align RPC function signatures, argument names, and JSONB return types:
--      - `acquire_appointment_slot_hold`
--      - `process_simulated_appointment_payment`
--      - `release_expired_appointment_holds` (returns JSONB)
--      - `cancel_appointment_hold`
--   4. Fix null-doctor comparison with `IS NOT DISTINCT FROM` for clinic-level holds.
--   5. Support idempotent booking retries without creating duplicate holds.
--   6. Enforce fixed search_path = public and revoke PUBLIC execution permissions.
-- ============================================================================

-- 1. Server-side Feature Flag Table & Security Policy
create table if not exists app_feature_flag (
  flag_name varchar(100) primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

alter table app_feature_flag enable row level security;

drop policy if exists "feature_flag_read" on app_feature_flag;
create policy "feature_flag_read" on app_feature_flag
  for select using (true);

drop policy if exists "feature_flag_admin_manage" on app_feature_flag;
create policy "feature_flag_admin_manage" on app_feature_flag
  for all using (is_admin()) with check (is_admin());

-- Seed the simulated appointment payment feature flag (disabled by default)
insert into app_feature_flag (flag_name, enabled, description)
values (
  'enable_simulated_appointment_payment',
  false,
  'Server-side gate for educational simulated appointment payments. Default false in production.'
)
on conflict (flag_name) do nothing;


-- 2. Trigger Function: Protect Payment-Authoritative Invariants
create or replace function trg_protect_appointment_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_internal text;
  v_is_admin boolean;
begin
  -- Allow trusted server-side execution via internal transaction context
  v_is_internal := current_setting('app.internal_payment_context', true);
  if v_is_internal = 'true' then
    return NEW;
  end if;

  -- Allow superuser / postgres / service_role
  if current_user in ('postgres', 'service_role') and coalesce(auth.role(), '') = 'service_role' then
    return NEW;
  end if;

  -- Allow administrator users
  begin
    v_is_admin := is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if v_is_admin is true then
    return NEW;
  end if;

  -- Block untrusted client-side direct writes to payment-authoritative fields
  if TG_OP = 'INSERT' then
    if NEW.payment_status = 'paid' then
      raise exception 'ERR_FORBIDDEN: Direct insertion of paid payment_status is prohibited.';
    end if;
    if NEW.queue_number is not null then
      raise exception 'ERR_FORBIDDEN: Direct assignment of queue_number is prohibited.';
    end if;
    if NEW.paid_at is not null then
      raise exception 'ERR_FORBIDDEN: Direct assignment of paid_at is prohibited.';
    end if;
    if NEW.payment_reference is not null and NEW.payment_reference like 'SIM-%' then
      raise exception 'ERR_FORBIDDEN: Direct fabrication of payment_reference is prohibited.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.payment_status is distinct from OLD.payment_status then
      if NEW.payment_status = 'paid' then
        raise exception 'ERR_FORBIDDEN: Direct transition of payment_status to paid is prohibited.';
      end if;
      if OLD.payment_status = 'paid' and NEW.payment_status <> 'paid' then
        raise exception 'ERR_FORBIDDEN: Alteration of verified paid status is prohibited.';
      end if;
    end if;

    if NEW.queue_number is distinct from OLD.queue_number then
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

    if NEW.payment_hold_expires_at is distinct from OLD.payment_hold_expires_at then
      raise exception 'ERR_FORBIDDEN: Direct modification of payment_hold_expires_at is prohibited.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_appointment_protect_payment on patient_appointment;
create trigger trg_appointment_protect_payment
before insert or update on patient_appointment
for each row
execute function trg_protect_appointment_payment_fields();


-- 3. Trigger Function: Update Queue Assignment & Conflict Checks
create or replace function trg_assign_appointment_queue_and_prevent_duplicates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cal_date date;
  v_old_cal_date date;
  v_time_clean varchar(20);
  v_conflict_id uuid;
  v_next_q integer;
  v_lock_key bigint;
  v_is_hold boolean;
begin
  -- Clean time representation (e.g. '08:00')
  v_time_clean := left(trim(coalesce(NEW.time, NEW.batch_time, '08:00')), 5);
  v_cal_date := (NEW.date at time zone 'Asia/Manila')::date;
  v_is_hold := (NEW.payment_status is not null and NEW.payment_status in ('pending_hold', 'failed'));

  -- 1. Prevent duplicate bookings for the same doctor, calendar date, and time slot
  -- Only active bookings block the slot. Expired/cancelled/failed holds and cancelled/rejected appointments do NOT block.
  if NEW.status not in ('cancelled', 'rejected') and (NEW.doctor_status is null or NEW.doctor_status <> 'rejected') then
    if NEW.assigned_doctor_id is not null then
      select appointment_id into v_conflict_id
      from patient_appointment
      where clinic_id = NEW.clinic_id
        and assigned_doctor_id = NEW.assigned_doctor_id
        and ((date at time zone 'Asia/Manila')::date = v_cal_date)
        and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
        and status not in ('cancelled', 'rejected')
        and (doctor_status is null or doctor_status <> 'rejected')
        -- Ignore expired holds
        and not (
          payment_status is not null
          and payment_status in ('expired', 'cancelled', 'failed')
        )
        and not (
          payment_status is not null
          and payment_status = 'pending_hold'
          and payment_hold_expires_at is not null
          and payment_hold_expires_at <= now()
        )
        and appointment_id <> coalesce(NEW.appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)
      limit 1;

      if v_conflict_id is not null then
        raise exception 'ERR_DUPLICATE_SLOT: The time slot % on % is already reserved or booked for this doctor.', v_time_clean, v_cal_date;
      end if;
    end if;
  end if;

  -- 2. Queue Number Assignment
  -- Rule: Temporary unpaid holds must NOT consume queue numbers!
  if v_is_hold then
    NEW.queue_number := null;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    v_old_cal_date := (OLD.date at time zone 'Asia/Manila')::date;
  end if;

  -- Assign queue number if:
  --   a) New paid/exempt insert without queue number
  --   b) Update where queue_number was previously null (e.g. hold payment completion)
  --   c) Date or doctor changed
  if (TG_OP = 'INSERT' and (NEW.queue_number is null or NEW.queue_number <= 0))
     or (TG_OP = 'UPDATE' and OLD.queue_number is null and NEW.queue_number is null and (NEW.payment_status is null or NEW.payment_status in ('paid', 'exempt')))
     or (TG_OP = 'UPDATE' and (v_old_cal_date is distinct from v_cal_date or OLD.assigned_doctor_id is distinct from NEW.assigned_doctor_id))
     or (NEW.queue_number is null and (NEW.payment_status is null or NEW.payment_status in ('paid', 'exempt'))) then

    -- Advisory lock scoped to (clinic_id, assigned_doctor_id, calendar_date)
    v_lock_key := hashtext(concat(
      coalesce(NEW.clinic_id::text, ''),
      coalesce(NEW.assigned_doctor_id::text, 'unassigned'),
      v_cal_date::text
    ));
    perform pg_advisory_xact_lock(v_lock_key);

    -- Find maximum queue number already assigned for this doctor/clinic and calendar date
    select coalesce(max(queue_number), 0) + 1
    into v_next_q
    from patient_appointment
    where clinic_id = NEW.clinic_id
      and (assigned_doctor_id is not distinct from NEW.assigned_doctor_id)
      and ((date at time zone 'Asia/Manila')::date = v_cal_date)
      and queue_number is not null;

    NEW.queue_number := coalesce(v_next_q, 1);
  else
    -- Preserve existing queue number on other updates (status changes, notes, etc.)
    if TG_OP = 'UPDATE' and OLD.queue_number is not null and OLD.queue_number > 0 then
      NEW.queue_number := OLD.queue_number;
    end if;
  end if;

  return NEW;
end;
$$;


-- 4. RPC Function: release_expired_appointment_holds (Fixed JSONB return type)
drop function if exists release_expired_appointment_holds();

create or replace function release_expired_appointment_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  perform set_config('app.internal_payment_context', 'true', true);

  with expired_appts as (
    update patient_appointment
    set status = 'cancelled',
        payment_status = 'expired',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Reservation hold expired without payment.'
    where payment_status = 'pending_hold'
      and payment_hold_expires_at is not null
      and payment_hold_expires_at <= now()
      and status not in ('cancelled', 'rejected', 'completed')
    returning appointment_id
  )
  select count(*) into v_count from expired_appts;

  return jsonb_build_object(
    'success', true,
    'released_count', v_count
  );
end;
$$;


-- 5. RPC Function: acquire_appointment_slot_hold
-- Safe drop of old signatures
drop function if exists acquire_appointment_slot_hold(uuid, uuid, timestamptz, varchar, text, text, text, text, text, date, text, text, text, text, jsonb, text, text, decimal, uuid, uuid, integer);
drop function if exists acquire_appointment_slot_hold;

create or replace function acquire_appointment_slot_hold(
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
  v_user_id uuid;
  v_cal_date date;
  v_time_clean varchar(20);
  v_lock_key bigint;
  v_existing_id uuid;
  v_existing_user_id uuid;
  v_existing_status varchar(20);
  v_existing_pay_status varchar(30);
  v_existing_expires timestamptz;
  v_existing_ref text;
  v_existing_fee decimal(10,2);
  v_consultation_fee decimal(10,2);
  v_hold_expires_at timestamptz;
  v_new_appt_id uuid;
  v_ref text;
  v_clinic_name text;
  v_now timestamptz;
begin
  -- 1. Authentication check
  v_user_id := auth.uid();
  if v_user_id is null then
    if is_admin() and p_user_id is not null then
      v_user_id := p_user_id;
    else
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_UNAUTHORIZED',
        'error', 'ERR_UNAUTHORIZED',
        'message', 'You must be signed in to reserve an appointment.'
      );
    end if;
  end if;

  if p_user_id is not null and p_user_id <> v_user_id and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'You cannot create an appointment hold for another patient.'
    );
  end if;

  v_now := now();

  -- 2. Normalization
  v_cal_date := (p_date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(p_time, p_batch_time, '08:00')), 5);
  v_hold_expires_at := v_now + (coalesce(p_hold_duration_minutes, 10) * interval '1 minute');

  -- 3. Concurrency Lock: scoped to (clinic_id, doctor_id, calendar_date, time)
  v_lock_key := hashtext(concat(
    coalesce(p_clinic_id::text, ''),
    coalesce(p_doctor_id::text, 'unassigned'),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(v_lock_key);

  -- 4. Check existing appointment on this slot (using IS NOT DISTINCT FROM for doctor_id)
  select appointment_id, user_id, status, payment_status, payment_hold_expires_at, payment_reference, payment_amount
  into v_existing_id, v_existing_user_id, v_existing_status, v_existing_pay_status, v_existing_expires, v_existing_ref, v_existing_fee
  from patient_appointment
  where clinic_id = p_clinic_id
    and (assigned_doctor_id is not distinct from p_doctor_id)
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
    and status not in ('cancelled', 'rejected')
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    -- A. Idempotent Retry: Same user retrying while hold is still active
    if v_existing_user_id = v_user_id and v_existing_pay_status in ('pending_hold', 'failed') and v_existing_expires > v_now then
      select name into v_clinic_name from clinic where clinic_id = p_clinic_id;
      return jsonb_build_object(
        'success', true,
        'appointment_id', v_existing_id,
        'payment_reference', coalesce(v_existing_ref, 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD'))),
        'payment_amount', coalesce(v_existing_fee, 500.00),
        'fee', coalesce(v_existing_fee, 500.00),
        'currency', 'PHP',
        'hold_expires_at', v_existing_expires,
        'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
        'payment_status', v_existing_pay_status,
        'clinic_name', coalesce(v_clinic_name, 'Clinic'),
        'is_existing_hold', true
      );
    -- B. Expired Hold: Release stale hold atomically
    elsif v_existing_pay_status = 'pending_hold' and v_existing_expires is not null and v_existing_expires <= v_now then
      perform set_config('app.internal_payment_context', 'true', true);
      update patient_appointment
      set status = 'cancelled',
          payment_status = 'expired',
          clinic_note = coalesce(clinic_note || ' | ', '') || 'Expired hold released by subsequent booking attempt.'
      where appointment_id = v_existing_id;
    -- C. Already expired or cancelled record: slot is available
    elsif v_existing_pay_status in ('expired', 'cancelled') then
      null;
    -- D. Slot is occupied by active booking or another patient's active hold
    else
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_SLOT_UNAVAILABLE',
        'error', 'ERR_SLOT_UNAVAILABLE',
        'message', 'This consultation slot has just been reserved by another patient. Please select another available time.'
      );
    end if;
  end if;

  -- 5. Fetch authoritative consultation fee and clinic name
  select coalesce(consultation_fee, 500.00), name
  into v_consultation_fee, v_clinic_name
  from clinic
  where clinic_id = p_clinic_id;

  if v_consultation_fee is null then
    v_consultation_fee := 500.00;
  end if;

  v_ref := 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 6. Insert new appointment with temporary hold state
  perform set_config('app.internal_payment_context', 'true', true);

  insert into patient_appointment (
    user_id,
    clinic_id,
    assigned_doctor_id,
    date,
    time,
    batch_time,
    status,
    payment_status,
    payment_hold_expires_at,
    payment_amount,
    payment_reference,
    queue_number,
    doctor_status,
    schedule_sent_to_doctor,
    check_in_status,
    patient_name,
    patient_email,
    patient_contact,
    patient_address,
    patient_gender,
    patient_birthdate,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relationship,
    notes,
    clinic_note,
    skin_photo_url,
    ai_condition_name,
    ai_confidence,
    condition_id,
    primary_scan_id,
    questionnaire_answers
  ) values (
    v_user_id,
    p_clinic_id,
    p_doctor_id,
    p_date,
    p_time,
    coalesce(p_batch_time, v_time_clean),
    'pending',
    'pending_hold',
    v_hold_expires_at,
    v_consultation_fee,
    v_ref,
    null,
    null,
    false,
    'scheduled',
    p_patient_name,
    p_patient_email,
    p_patient_contact,
    p_patient_address,
    p_patient_gender,
    p_patient_birthdate,
    p_emergency_contact_name,
    p_emergency_contact_phone,
    p_emergency_contact_relationship,
    p_notes,
    coalesce(p_clinic_note, 'Consultation slot held pending payment confirmation (10m).'),
    p_skin_photo_url,
    p_ai_condition_name,
    p_ai_confidence,
    p_condition_id,
    p_primary_scan_id,
    p_questionnaire_answers
  )
  returning appointment_id into v_new_appt_id;

  return jsonb_build_object(
    'success', true,
    'appointment_id', v_new_appt_id,
    'payment_reference', v_ref,
    'payment_amount', v_consultation_fee,
    'fee', v_consultation_fee,
    'currency', 'PHP',
    'hold_expires_at', v_hold_expires_at,
    'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
    'payment_status', 'pending_hold',
    'clinic_name', coalesce(v_clinic_name, 'Skin Clinic')
  );
end;
$$;


-- 6. RPC Function: process_simulated_appointment_payment
-- Safe drop of old signatures
drop function if exists process_simulated_appointment_payment(uuid, varchar);
drop function if exists process_simulated_appointment_payment;

create or replace function process_simulated_appointment_payment(
  p_appointment_id uuid,
  p_simulated_outcome varchar default 'success',
  p_simulated_method varchar default 'Simulated Card'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sim_enabled boolean;
  v_user_id uuid;
  v_appt record;
  v_cal_date date;
  v_lock_key bigint;
  v_fee decimal(10,2);
  v_ref text;
  v_next_q integer;
  v_now timestamptz;
begin
  -- 1. Server-side simulation gate check
  select coalesce(enabled, false) into v_sim_enabled
  from app_feature_flag
  where flag_name = 'enable_simulated_appointment_payment';

  if not coalesce(v_sim_enabled, false) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_SIMULATION_DISABLED',
      'error', 'ERR_SIMULATION_DISABLED',
      'message', 'Simulated appointment payment is disabled in this environment. Contact system administrator.'
    );
  end if;

  -- 2. Caller authentication
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNAUTHORIZED',
      'error', 'ERR_UNAUTHORIZED',
      'message', 'Authentication required.'
    );
  end if;

  v_now := now();

  -- 3. Row Lock on target appointment
  select * into v_appt
  from patient_appointment
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

  -- 4. Verify patient ownership
  if v_appt.user_id <> v_user_id and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'You can only complete payment for your own appointment.'
    );
  end if;

  -- 5. Check idempotent completion: already paid?
  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'already_paid', true,
      'appointment_id', p_appointment_id,
      'payment_status', 'paid',
      'queue_number', v_appt.queue_number,
      'reference_number', v_appt.payment_reference,
      'payment_reference', v_appt.payment_reference,
      'paid_at', v_appt.paid_at,
      'amount', v_appt.payment_amount,
      'currency', 'PHP'
    );
  end if;

  -- 6. Check if hold has expired
  if (v_appt.payment_status is not null and v_appt.payment_status = 'expired')
     or (v_appt.payment_hold_expires_at is not null and v_appt.payment_hold_expires_at <= v_now) then
    perform set_config('app.internal_payment_context', 'true', true);
    update patient_appointment
    set status = 'cancelled',
        payment_status = 'expired',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Payment attempted after hold expired.'
    where appointment_id = p_appointment_id;

    return jsonb_build_object(
      'success', false,
      'code', 'ERR_HOLD_EXPIRED',
      'error', 'ERR_HOLD_EXPIRED',
      'payment_status', 'expired',
      'can_retry', false,
      'message', 'Your 10-minute reservation hold has expired. The slot has been released back to the clinic.'
    );
  end if;

  -- 7. Verify status is active pending_hold or failed (retry)
  if v_appt.status in ('cancelled', 'rejected') or (v_appt.payment_status is not null and v_appt.payment_status in ('cancelled', 'expired')) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_STATE',
      'error', 'ERR_INVALID_STATE',
      'payment_status', v_appt.payment_status,
      'can_retry', false,
      'message', 'Appointment is not in an active hold state.'
    );
  end if;

  -- 8. Handle explicit Simulated Outcomes: 'failed', 'cancelled', 'success'
  if p_simulated_outcome = 'failed' then
    perform set_config('app.internal_payment_context', 'true', true);
    update patient_appointment
    set payment_status = 'failed',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Simulated payment failed (user choice).'
    where appointment_id = p_appointment_id;

    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_FAILED',
      'error', 'ERR_PAYMENT_FAILED',
      'appointment_id', p_appointment_id,
      'payment_status', 'failed',
      'can_retry', (v_appt.payment_hold_expires_at > v_now),
      'hold_expires_at', v_appt.payment_hold_expires_at,
      'message', 'Simulated payment failed. You may retry within the reservation window.'
    );
  end if;

  if p_simulated_outcome = 'cancelled' then
    perform set_config('app.internal_payment_context', 'true', true);
    update patient_appointment
    set status = 'cancelled',
        payment_status = 'cancelled',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Simulated payment checkout cancelled by user.'
    where appointment_id = p_appointment_id;

    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_CANCELLED',
      'error', 'ERR_PAYMENT_CANCELLED',
      'appointment_id', p_appointment_id,
      'payment_status', 'cancelled',
      'can_retry', false,
      'message', 'Simulated payment was cancelled. The reservation hold has been released.'
    );
  end if;

  -- 9. Authoritative Fee
  v_fee := coalesce(v_appt.payment_amount, 500.00);

  -- 10. Generate permanent payment reference if not already present
  v_ref := coalesce(v_appt.payment_reference, 'SIM-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)));

  -- 11. Advisory Lock for atomic queue number assignment
  v_cal_date := (v_appt.date at time zone 'Asia/Manila')::date;
  v_lock_key := hashtext(concat(
    coalesce(v_appt.clinic_id::text, ''),
    coalesce(v_appt.assigned_doctor_id::text, 'unassigned'),
    v_cal_date::text
  ));
  perform pg_advisory_xact_lock(v_lock_key);

  -- Compute next queue number using IS NOT DISTINCT FROM for doctor_id
  select coalesce(max(queue_number), 0) + 1
  into v_next_q
  from patient_appointment
  where clinic_id = v_appt.clinic_id
    and (assigned_doctor_id is not distinct from v_appt.assigned_doctor_id)
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and queue_number is not null;

  v_next_q := coalesce(v_next_q, 1);

  -- 12. Atomically transition appointment into active clinical triage
  perform set_config('app.internal_payment_context', 'true', true);

  update patient_appointment
  set payment_status = 'paid',
      payment_reference = v_ref,
      payment_amount = v_fee,
      paid_at = v_now,
      queue_number = v_next_q,
      schedule_sent_to_doctor = true,
      doctor_status = 'pending-review',
      status = 'pending',
      clinic_note = coalesce(clinic_note || ' | ', '') || 'Simulated payment verified (' || coalesce(p_simulated_method, 'Online Payment') || '). Ref: ' || v_ref
  where appointment_id = p_appointment_id;

  -- 13. Record in financial ledger table user_payment
  insert into user_payment (
    user_id,
    appointment_id,
    clinic_id,
    amount,
    method,
    status,
    payment_type,
    reference_number,
    paymongo_payment_id,
    payment_date
  ) values (
    v_user_id,
    p_appointment_id,
    v_appt.clinic_id,
    v_fee,
    'Simulated ' || coalesce(p_simulated_method, 'Payment'),
    'success',
    'appointment_consultation_simulated',
    v_ref,
    v_ref,
    v_now
  );

  -- 14. Create confirmation notification for patient
  insert into user_notification (
    user_id,
    type,
    subtype,
    title,
    body,
    metadata,
    is_read
  ) values (
    v_user_id,
    'appointment-scheduled',
    'payment_confirmed',
    'Appointment Payment Confirmed (Demo)',
    'Your consultation payment of ₱' || trim(to_char(v_fee, '999,999.99')) || ' (' || coalesce(p_simulated_method, 'Demo Payment') || ') has been verified. Queue #' || v_next_q || ' reserved.',
    jsonb_build_object('appointment_id', p_appointment_id, 'queue_number', v_next_q, 'reference_number', v_ref),
    false
  );

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'payment_status', 'paid',
    'queue_number', v_next_q,
    'reference_number', v_ref,
    'payment_reference', v_ref,
    'paid_at', v_now,
    'amount', v_fee,
    'currency', 'PHP'
  );
end;
$$;


-- 7. RPC Function: cancel_appointment_hold
drop function if exists cancel_appointment_hold(uuid);
drop function if exists cancel_appointment_hold;

create or replace function cancel_appointment_hold(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_appt record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNAUTHORIZED',
      'error', 'ERR_UNAUTHORIZED',
      'message', 'Authentication required.'
    );
  end if;

  select * into v_appt
  from patient_appointment
  where appointment_id = p_appointment_id;

  if v_appt.appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'error', 'ERR_NOT_FOUND',
      'message', 'Appointment not found.'
    );
  end if;

  if v_appt.user_id <> v_user_id and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'Unauthorized.'
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

  perform set_config('app.internal_payment_context', 'true', true);

  update patient_appointment
  set status = 'cancelled',
      payment_status = 'cancelled',
      clinic_note = coalesce(clinic_note || ' | ', '') || 'Slot hold cancelled by patient.'
  where appointment_id = p_appointment_id;

  return jsonb_build_object('success', true, 'appointment_id', p_appointment_id, 'message', 'Hold successfully cancelled.');
end;
$$;


-- 8. Explicit Permissions and Role Grants
revoke all on function release_expired_appointment_holds() from public;
revoke all on function acquire_appointment_slot_hold from public;
revoke all on function process_simulated_appointment_payment from public;
revoke all on function cancel_appointment_hold from public;

grant execute on function release_expired_appointment_holds() to authenticated, anon, service_role;
grant execute on function acquire_appointment_slot_hold to authenticated, service_role;
grant execute on function process_simulated_appointment_payment to authenticated, service_role;
grant execute on function cancel_appointment_hold to authenticated, service_role;
