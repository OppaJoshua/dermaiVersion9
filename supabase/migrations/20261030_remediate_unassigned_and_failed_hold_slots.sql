-- ============================================================================
-- DermAI Database Migration: 20261030_remediate_unassigned_and_failed_hold_slots.sql
-- Description: 
--   1. Protect unassigned doctor clinic slots against concurrent double-booking
--      via partial unique index idx_unique_exclusive_unassigned_slot and trigger.
--   2. Remediate acquire_appointment_slot_hold and release_expired_appointment_holds
--      to allow expired or failed payment holds to be safely reaped and rebooked,
--      while strictly preserving authoritative paid appointments and valid active holds.
-- ============================================================================

-- 1. Partial unique index to prevent concurrent double-booking of unassigned clinic consultation slots
create unique index if not exists idx_unique_exclusive_unassigned_slot
on public.patient_appointment (
  clinic_id, 
  ((date at time zone 'Asia/Manila')::date), 
  (left(trim(coalesce(time, batch_time, '')), 5))
)
where status not in ('cancelled', 'rejected') 
  and (doctor_status is null or doctor_status <> 'rejected')
  and assigned_doctor_id is null;

-- 2. Update trigger function: trg_assign_appointment_queue_and_prevent_duplicates
--    Enforces slot collision checking for both assigned doctor slots and unassigned clinic slots.
create or replace function public.trg_assign_appointment_queue_and_prevent_duplicates()
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

  -- 1. Prevent duplicate bookings for the same clinic, doctor (or unassigned), calendar date, and time slot
  -- Only active bookings block the slot. Expired/cancelled/failed holds and cancelled/rejected appointments do NOT block.
  if NEW.status not in ('cancelled', 'rejected') and (NEW.doctor_status is null or NEW.doctor_status <> 'rejected') then
    select appointment_id into v_conflict_id
    from public.patient_appointment
    where clinic_id = NEW.clinic_id
      and (assigned_doctor_id is not distinct from NEW.assigned_doctor_id)
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
        and payment_status in ('pending_hold', 'failed')
        and payment_hold_expires_at is not null
        and payment_hold_expires_at <= now()
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

  -- 2. Queue Number Assignment
  -- Rule: Temporary unpaid holds must NOT consume queue numbers!
  if v_is_hold then
    NEW.queue_number := null;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    v_old_cal_date := (OLD.date at time zone 'Asia/Manila')::date;
  end if;

  -- Assign queue number when:
  --   a) New paid/exempt booking is inserted with queue_number is null
  --   b) An existing unpaid hold transitions to paid/exempt
  --   c) Calendar date changes (rescheduled)
  if (TG_OP = 'INSERT' and NEW.queue_number is null)
     or (TG_OP = 'UPDATE' and OLD.queue_number is null and NEW.payment_status in ('paid', 'exempt'))
     or (TG_OP = 'UPDATE' and v_old_cal_date is not null and v_old_cal_date <> v_cal_date) then

    -- Advisory transaction lock scoped to (clinic, doctor, calendar_date)
    v_lock_key := hashtext(concat(
      coalesce(NEW.clinic_id::text, ''),
      coalesce(NEW.assigned_doctor_id::text, 'unassigned'),
      v_cal_date::text
    ));
    perform pg_advisory_xact_lock(v_lock_key);

    -- Find current max queue_number for this doctor on this day
    select coalesce(max(queue_number), 0) + 1 into v_next_q
    from public.patient_appointment
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

-- 3. Update release_expired_appointment_holds RPC function
--    Releases holds that have expired past payment_hold_expires_at, whether pending_hold or failed.
create or replace function public.release_expired_appointment_holds()
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
    update public.patient_appointment
    set status = 'cancelled',
        payment_status = 'expired',
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Reservation hold expired without payment.'
    where payment_status in ('pending_hold', 'failed')
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

revoke all on function public.release_expired_appointment_holds() from public;
grant execute on function public.release_expired_appointment_holds() to authenticated, anon, service_role;

-- 4. Update acquire_appointment_slot_hold RPC function
--    Atomically acquires a temporary hold with concurrency advisory lock.
--    Allows expired holds (pending_hold or failed) to be reaped and rebooked,
--    while strictly preserving authoritative paid appointments and active holds.
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
  v_clinic_name text;
  v_appt_id uuid;
  v_ref text;
  v_hold_expires_at timestamptz;
  v_now timestamptz;
begin
  -- 1. Security & Authentication Resolution
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNAUTHORIZED',
      'error', 'ERR_UNAUTHORIZED',
      'message', 'Authentication required to acquire an appointment slot hold.'
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
  from public.patient_appointment
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
      select name into v_clinic_name from public.clinic where clinic_id = p_clinic_id;
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
    -- B. Expired or Failed Hold: Release stale hold atomically
    elsif (v_existing_pay_status in ('pending_hold', 'failed')) and v_existing_expires is not null and v_existing_expires <= v_now then
      perform set_config('app.internal_payment_context', 'true', true);
      update public.patient_appointment
      set status = 'cancelled',
          payment_status = 'expired',
          clinic_note = coalesce(clinic_note || ' | ', '') || 'Expired hold released by subsequent booking attempt.'
      where appointment_id = v_existing_id;
    -- C. Already expired or cancelled record: slot is available
    elsif v_existing_pay_status in ('expired', 'cancelled') or v_existing_status in ('cancelled', 'rejected') then
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
  from public.clinic
  where clinic_id = p_clinic_id;

  if v_consultation_fee is null then
    v_consultation_fee := 500.00;
  end if;

  v_ref := 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 6. Insert new appointment with temporary hold state
  perform set_config('app.internal_payment_context', 'true', true);

  insert into public.patient_appointment (
    user_id,
    clinic_id,
    assigned_doctor_id,
    date,
    time,
    batch_time,
    status,
    doctor_status,
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
    questionnaire_answers,
    skin_photo_url,
    ai_condition_name,
    ai_confidence,
    condition_id,
    primary_scan_id,
    payment_status,
    payment_amount,
    payment_reference,
    payment_hold_expires_at,
    schedule_sent_to_doctor,
    check_in_status
  ) values (
    v_user_id,
    p_clinic_id,
    p_doctor_id,
    p_date,
    v_time_clean || ':00',
    v_time_clean,
    'pending',
    'pending-review',
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
    p_clinic_note,
    p_questionnaire_answers,
    p_skin_photo_url,
    p_ai_condition_name,
    p_ai_confidence,
    p_condition_id,
    p_primary_scan_id,
    'pending_hold',
    v_consultation_fee,
    v_ref,
    v_hold_expires_at,
    true,
    'scheduled'
  )
  returning appointment_id into v_appt_id;

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

revoke all on function public.acquire_appointment_slot_hold from public;
grant execute on function public.acquire_appointment_slot_hold to authenticated, service_role;

