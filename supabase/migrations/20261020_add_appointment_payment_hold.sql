-- ============================================================================
-- DermAI Migration: Appointment Payment & Temporary Slot Hold
-- Migration ID: 20261020_add_appointment_payment_hold.sql
--
-- Objective:
--   1. Add discrete payment tracking columns to `patient_appointment`.
--   2. Support temporary 10-minute slot holds for pending consultation payments.
--   3. Defer queue number assignment until payment confirmation.
--   4. Prevent expired holds from blocking doctor schedule availability.
--   5. Provide atomic, transaction-safe RPC functions for acquiring holds,
--      processing simulated payments, cancelling holds, and releasing expired holds.
--   6. Extend `user_payment` to track consultation transactions distinctly from
--      subscription payments without altering subscription behavior.
-- ============================================================================

-- 1. Extend `patient_appointment` with payment columns
alter table if exists patient_appointment
  add column if not exists payment_status varchar(30),
  add column if not exists payment_hold_expires_at timestamptz,
  add column if not exists payment_amount decimal(10,2),
  add column if not exists payment_reference text,
  add column if not exists paid_at timestamptz;

-- Enforce valid payment statuses (NULL allowed for existing/legacy records)
alter table if exists patient_appointment
  drop constraint if exists check_appointment_payment_status;

alter table if exists patient_appointment
  add constraint check_appointment_payment_status
  check (payment_status is null or payment_status in ('pending_hold', 'paid', 'failed', 'cancelled', 'expired', 'exempt'));

-- 2. Extend `user_payment` table to link consultation payments
alter table if exists user_payment
  add column if not exists appointment_id uuid references patient_appointment(appointment_id) on delete set null,
  add column if not exists clinic_id uuid references clinic(clinic_id) on delete set null,
  add column if not exists payment_type varchar(50) not null default 'subscription';

alter table if exists user_payment
  drop constraint if exists check_user_payment_type;

alter table if exists user_payment
  add constraint check_user_payment_type
  check (payment_type in ('subscription', 'appointment_consultation', 'appointment_consultation_simulated'));

-- Indexes for performance
create index if not exists idx_pt_appt_payment_hold
  on patient_appointment (assigned_doctor_id, date, payment_status, payment_hold_expires_at);

create index if not exists idx_user_payment_appointment_id
  on user_payment (appointment_id);

create index if not exists idx_user_payment_clinic_id
  on user_payment (clinic_id);

-- Update RLS on user_payment so clinics can view payments for their consultations
drop policy if exists "pay_clinic_read" on user_payment;
create policy "pay_clinic_read" on user_payment
  for select using (
    is_admin() or
    user_id = auth.uid() or
    (clinic_id is not null and exists (
      select 1 from clinic where clinic.clinic_id = user_payment.clinic_id and clinic.owner_user_id = auth.uid()
    ))
  );

-- 3. Database Function: Release Expired Appointment Holds
-- Transition any holding appointment whose hold window has elapsed to 'cancelled'/'expired'
create or replace function release_expired_appointment_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
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

  return v_count;
end;
$$;

-- 4. Re-define Trigger Function: trg_assign_appointment_queue_and_prevent_duplicates()
-- Updates:
--  a) Ignores expired holds when checking for conflicting slots.
--  b) Defers queue number assignment while payment_status = 'pending_hold'.
--  c) Atomically assigns queue_number when payment_status transitions to 'paid' (or 'exempt').
create or replace function trg_assign_appointment_queue_and_prevent_duplicates()
returns trigger
language plpgsql
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
  v_is_hold := (NEW.payment_status is not null and NEW.payment_status = 'pending_hold');

  -- 1. Prevent duplicate bookings for the same doctor, calendar date, and time slot
  -- Only active bookings block the slot. Expired holds and cancelled/rejected appointments do NOT block.
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
          and payment_status in ('expired', 'cancelled')
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
  -- Rule: Temporary unpaid holds (payment_status = 'pending_hold') must NOT consume queue numbers!
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

    -- Find maximum queue number already assigned for this doctor and calendar date (ignoring nulls)
    select coalesce(max(queue_number), 0) + 1
    into v_next_q
    from patient_appointment
    where clinic_id = NEW.clinic_id
      and (
        (NEW.assigned_doctor_id is not null and assigned_doctor_id = NEW.assigned_doctor_id) or
        (NEW.assigned_doctor_id is null and (assigned_doctor_id is null or assigned_doctor_id = NEW.assigned_doctor_id))
      )
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

-- 5. RPC Function: acquire_appointment_slot_hold
-- Atomically checks availability, releases any stale expired hold, and reserves a 10-minute hold
create or replace function acquire_appointment_slot_hold(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_date timestamptz,
  p_time varchar,
  p_patient_name text default null,
  p_patient_email text default null,
  p_patient_contact text default null,
  p_patient_address text default null,
  p_patient_gender text default null,
  p_patient_birthdate date default null,
  p_emergency_name text default null,
  p_emergency_phone text default null,
  p_emergency_rel text default null,
  p_notes text default null,
  p_questionnaire jsonb default null,
  p_photo_url text default null,
  p_condition_name text default null,
  p_confidence decimal default null,
  p_condition_id uuid default null,
  p_primary_scan_id uuid default null,
  p_hold_minutes integer default 10
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
  v_existing_status varchar(20);
  v_existing_pay_status varchar(30);
  v_existing_expires timestamptz;
  v_consultation_fee decimal(10,2);
  v_hold_expires_at timestamptz;
  v_new_appt_id uuid;
begin
  -- 1. Authentication check
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'ERR_UNAUTHORIZED',
      'message', 'You must be signed in to reserve an appointment.'
    );
  end if;

  -- 2. Normalization
  v_cal_date := (p_date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(p_time, '08:00')), 5);
  v_hold_expires_at := now() + (coalesce(p_hold_minutes, 10) * interval '1 minute');

  -- 3. Concurrency Lock: scoped to (clinic_id, doctor_id, calendar_date, time)
  v_lock_key := hashtext(concat(
    coalesce(p_clinic_id::text, ''),
    coalesce(p_doctor_id::text, ''),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(v_lock_key);

  -- 4. Check existing appointment on this slot
  select appointment_id, status, payment_status, payment_hold_expires_at
  into v_existing_id, v_existing_status, v_existing_pay_status, v_existing_expires
  from patient_appointment
  where clinic_id = p_clinic_id
    and assigned_doctor_id = p_doctor_id
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
    and status not in ('cancelled', 'rejected')
  order by created_at desc
  limit 1;

  -- If an appointment exists on this slot:
  if v_existing_id is not null then
    -- Check if it is an expired hold
    if v_existing_pay_status = 'pending_hold' and v_existing_expires is not null and v_existing_expires <= now() then
      -- Release stale hold atomically
      update patient_appointment
      set status = 'cancelled',
          payment_status = 'expired',
          clinic_note = coalesce(clinic_note || ' | ', '') || 'Expired hold released by subsequent booking attempt.'
      where appointment_id = v_existing_id;
    elsif v_existing_pay_status in ('expired', 'cancelled') then
      -- Already marked expired/cancelled; treat as available
      null;
    else
      -- Active reservation or active hold exists: Slot is occupied!
      return jsonb_build_object(
        'success', false,
        'error', 'ERR_SLOT_UNAVAILABLE',
        'message', 'This consultation slot has just been reserved by another patient. Please select another available time.'
      );
    end if;
  end if;

  -- 5. Fetch authoritative consultation fee from clinic table
  select coalesce(consultation_fee, 500.00) into v_consultation_fee
  from clinic
  where clinic_id = p_clinic_id;

  if v_consultation_fee is null then
    v_consultation_fee := 500.00;
  end if;

  -- 6. Insert new appointment with temporary hold state
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
    v_time_clean,
    'pending',
    'pending_hold',
    v_hold_expires_at,
    v_consultation_fee,
    null, -- Queue number is deferred until payment completion
    null, -- Doctor status is deferred until payment completion
    false, -- Not sent to doctor triage until paid
    'scheduled',
    p_patient_name,
    p_patient_email,
    p_patient_contact,
    p_patient_address,
    p_patient_gender,
    p_patient_birthdate,
    p_emergency_name,
    p_emergency_phone,
    p_emergency_rel,
    p_notes,
    'Consultation slot held pending payment confirmation (10m).',
    p_photo_url,
    p_condition_name,
    p_confidence,
    p_condition_id,
    p_primary_scan_id,
    p_questionnaire
  )
  returning appointment_id into v_new_appt_id;

  return jsonb_build_object(
    'success', true,
    'appointment_id', v_new_appt_id,
    'fee', v_consultation_fee,
    'currency', 'PHP',
    'hold_expires_at', v_hold_expires_at,
    'hold_duration_minutes', coalesce(p_hold_minutes, 10)
  );
end;
$$;

-- 6. RPC Function: process_simulated_appointment_payment
-- Atomically validates ownership and hold, updates payment_status to 'paid',
-- assigns queue_number via advisory lock, records transaction in user_payment, and creates notification
create or replace function process_simulated_appointment_payment(
  p_appointment_id uuid,
  p_method varchar default 'GCash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_appt record;
  v_cal_date date;
  v_time_clean varchar(20);
  v_lock_key bigint;
  v_fee decimal(10,2);
  v_ref text;
  v_next_q integer;
  v_now timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED', 'message', 'Authentication required.');
  end if;

  v_now := now();

  -- 1. Row Lock on target appointment
  select * into v_appt
  from patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'error', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  -- 2. Verify patient ownership
  if v_appt.user_id <> v_user_id and not is_admin() then
    return jsonb_build_object('success', false, 'error', 'ERR_FORBIDDEN', 'message', 'You can only complete payment for your own appointment.');
  end if;

  -- 3. Check idempotent completion: already paid?
  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', true,
      'already_paid', true,
      'appointment_id', p_appointment_id,
      'queue_number', v_appt.queue_number,
      'reference_number', v_appt.payment_reference,
      'paid_at', v_appt.paid_at,
      'amount', v_appt.payment_amount
    );
  end if;

  -- 4. Check if hold has expired
  if (v_appt.payment_status is not null and v_appt.payment_status = 'expired')
     or (v_appt.payment_hold_expires_at is not null and v_appt.payment_hold_expires_at <= v_now) then
    -- Mark cancelled & expired
    update patient_appointment
    set status = 'cancelled',
        payment_status = 'expired',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Payment attempted after hold expired.'
    where appointment_id = p_appointment_id;

    return jsonb_build_object(
      'success', false,
      'error', 'ERR_HOLD_EXPIRED',
      'message', 'Your 10-minute reservation hold has expired. The slot has been released back to the clinic.'
    );
  end if;

  -- 5. Verify status is active pending_hold
  if v_appt.status in ('cancelled', 'rejected') or (v_appt.payment_status is not null and v_appt.payment_status in ('cancelled', 'expired')) then
    return jsonb_build_object(
      'success', false,
      'error', 'ERR_INVALID_STATE',
      'message', 'Appointment is not in an active hold state.'
    );
  end if;

  -- 6. Authoritative fee
  v_fee := coalesce(v_appt.payment_amount, 500.00);

  -- 7. Generate clean transaction reference
  v_ref := 'SIM-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 8. Advisory lock for atomic queue number assignment
  v_cal_date := (v_appt.date at time zone 'Asia/Manila')::date;
  v_lock_key := hashtext(concat(
    coalesce(v_appt.clinic_id::text, ''),
    coalesce(v_appt.assigned_doctor_id::text, 'unassigned'),
    v_cal_date::text
  ));
  perform pg_advisory_xact_lock(v_lock_key);

  -- Compute next queue number for this doctor and day
  select coalesce(max(queue_number), 0) + 1
  into v_next_q
  from patient_appointment
  where clinic_id = v_appt.clinic_id
    and (
      (v_appt.assigned_doctor_id is not null and assigned_doctor_id = v_appt.assigned_doctor_id) or
      (v_appt.assigned_doctor_id is null and (assigned_doctor_id is null or assigned_doctor_id = v_appt.assigned_doctor_id))
    )
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and queue_number is not null;

  -- 9. Atomically transition appointment into active clinical triage
  update patient_appointment
  set payment_status = 'paid',
      payment_reference = v_ref,
      payment_amount = v_fee,
      paid_at = v_now,
      queue_number = coalesce(v_next_q, 1),
      schedule_sent_to_doctor = true,
      doctor_status = 'pending-review',
      status = 'pending',
      clinic_note = coalesce(clinic_note || ' | ', '') || 'Simulated payment verified (' || coalesce(p_method, 'Online Payment') || '). Ref: ' || v_ref
  where appointment_id = p_appointment_id;

  -- 10. Record in financial ledger table user_payment
  insert into user_payment (
    user_id,
    appointment_id,
    clinic_id,
    amount,
    method,
    status,
    payment_type,
    reference_number,
    payment_date
  ) values (
    v_user_id,
    p_appointment_id,
    v_appt.clinic_id,
    v_fee,
    'Simulated ' || coalesce(p_method, 'Payment'),
    'success',
    'appointment_consultation_simulated',
    v_ref,
    v_now
  );

  -- 11. Create confirmation notification for patient
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
    'Your consultation payment of ₱' || trim(to_char(v_fee, '999,999.99')) || ' (' || coalesce(p_method, 'Demo Payment') || ') has been verified. Queue #' || v_next_q || ' reserved.',
    jsonb_build_object('appointment_id', p_appointment_id, 'queue_number', v_next_q, 'reference_number', v_ref),
    false
  );

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'queue_number', v_next_q,
    'reference_number', v_ref,
    'paid_at', v_now,
    'amount', v_fee,
    'currency', 'PHP'
  );
end;
$$;

-- 7. RPC Function: cancel_appointment_hold
-- Patient explicitly releases hold before expiration
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
    return jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED', 'message', 'Authentication required.');
  end if;

  select * into v_appt
  from patient_appointment
  where appointment_id = p_appointment_id;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'error', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.user_id <> v_user_id and not is_admin() then
    return jsonb_build_object('success', false, 'error', 'ERR_FORBIDDEN', 'message', 'Unauthorized.');
  end if;

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object('success', false, 'error', 'ERR_ALREADY_PAID', 'message', 'Cannot cancel hold: appointment is already paid.');
  end if;

  update patient_appointment
  set status = 'cancelled',
      payment_status = 'cancelled',
      clinic_note = coalesce(clinic_note || ' | ', '') || 'Slot hold cancelled by patient.'
  where appointment_id = p_appointment_id;

  return jsonb_build_object('success', true, 'appointment_id', p_appointment_id, 'message', 'Hold successfully cancelled.');
end;
$$;

-- 8. Grant execution permissions on RPC functions
grant execute on function release_expired_appointment_holds() to authenticated, anon, service_role;
grant execute on function acquire_appointment_slot_hold to authenticated, service_role;
grant execute on function process_simulated_appointment_payment to authenticated, service_role;
grant execute on function cancel_appointment_hold to authenticated, service_role;
