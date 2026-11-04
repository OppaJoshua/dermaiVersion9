-- ============================================================================

-- DermAI Migration: Payment-Aware Appointment Slot Hold Expiration & Fulfillment

-- Date: 2026-11-03

-- Purpose:

-- 1. Protect appointments with active or in-flight PayMongo payments from premature expiration.

-- 2. Allow delayed webhooks (>10m hold window) to fulfill valid reservations when slot has no conflict.

-- 3. Prevent double-booking if another patient legitimately booked the slot after expiration.

-- 4. Preserve standard 10-minute expiration for abandoned holds without payment attempts.

-- 5. Guard hold cancellation against concurrent processing payments.

-- ============================================================================



-- 1. GET_OCCUPIED_APPOINTMENT_SLOTS (Payment-Aware)

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

      left(trim(coalesce(pa.time, pa.batch_time, '08:00')), 5)::varchar as slot_time,

      (pa.date at time zone 'Asia/Manila')::date as slot_date,

      pa.assigned_doctor_id as assigned_doctor_id,

      pa.clinic_id as clinic_id,

      case

        when pa.payment_status in ('pending_hold', 'failed')

         and (

           pa.payment_hold_expires_at is null

           or pa.payment_hold_expires_at > now()

           or (

             pa.payment_reference is not null

             and pa.payment_reference not like 'SIM-%'

             and pa.payment_status not in ('failed', 'cancelled', 'expired')

             and pa.payment_hold_expires_at > (now() - interval '1 hour')

           )

         )

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

      and (p_doctor_id is null or pa.assigned_doctor_id = p_doctor_id or pa.assigned_doctor_id is null)

      and pa.status not in ('cancelled', 'rejected')

      and (pa.doctor_status is null or pa.doctor_status <> 'rejected')

      and not (

        pa.payment_status is not null

        and (

          pa.payment_status in ('expired', 'cancelled')

          or (

            pa.payment_status = 'failed'

            and pa.payment_hold_expires_at is not null

            and pa.payment_hold_expires_at <= now()

          )

          or (

            pa.payment_status = 'pending_hold'

            and pa.payment_hold_expires_at is not null

            and pa.payment_hold_expires_at <= now()

            and (pa.payment_reference is null or pa.payment_reference like 'SIM-%')

          )

          or (

            pa.payment_status in ('pending_hold', 'failed')

            and pa.payment_hold_expires_at is not null

            and pa.payment_hold_expires_at <= (now() - interval '1 hour')

          )

        )

      )

  ) occ

  order by occ.slot_time, occ.assigned_doctor_id,

           case when occ.occupancy_type = 'booked' then 0 else 1 end,

           occ.payment_hold_expires_at desc nulls last;

end;

$$;



revoke all on function public.get_occupied_appointment_slots(uuid, date, uuid) from public;

grant execute on function public.get_occupied_appointment_slots(uuid, date, uuid) to authenticated, anon, service_role;





-- 2. ACQUIRE_APPOINTMENT_SLOT_HOLD (Payment-Aware Expiration Cleanup)

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

  v_time_clean := left(trim(coalesce(p_time, p_batch_time, '08:00')), 5);

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



  -- 4. Reap genuinely EXPIRED holds (database clock)

  -- Holds with active external payment intents (pi_...) are protected and not reaped here

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

          (payment_status = 'failed' and payment_hold_expires_at is not null and payment_hold_expires_at <= v_now)

          or (

            payment_status = 'pending_hold'

            and payment_hold_expires_at is not null

            and payment_hold_expires_at <= v_now

            and (payment_reference is null or payment_reference like 'SIM-%')

          )

          or (

            payment_status in ('pending_hold', 'failed')

            and payment_hold_expires_at is not null

            and payment_hold_expires_at <= (v_now - interval '1 hour')

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

      (payment_status = 'failed' and payment_hold_expires_at is not null and payment_hold_expires_at <= v_now)

      or (

        payment_status = 'pending_hold'

        and payment_hold_expires_at is not null

        and payment_hold_expires_at <= v_now

        and (payment_reference is null or payment_reference like 'SIM-%')

      )

      or (

        payment_status in ('pending_hold', 'failed')

        and payment_hold_expires_at is not null

        and payment_hold_expires_at <= (v_now - interval '1 hour')

      )

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

    -- A. Idempotent retry: SAME user, SAME doctor scope, still-active hold

    if v_active.user_id = v_user_id

       and v_active.payment_status in ('pending_hold', 'failed')

       and (

         v_active.payment_hold_expires_at is null

         or v_active.payment_hold_expires_at > v_now

         or (v_active.payment_reference is not null and v_active.payment_reference not like 'SIM-%')

       )

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



  -- 7. Insert the new temporary hold

  begin

    perform set_config('app.internal_payment_context', 'true', true);



    insert into public.patient_appointment (

      clinic_id, assigned_doctor_id, user_id, date, time, batch_time,

      patient_name, patient_email, patient_contact, patient_address,

      patient_gender, patient_birthdate, emergency_contact_name,

      emergency_contact_phone, emergency_contact_relationship, notes,

      clinic_note, questionnaire_answers, skin_photo_url, ai_condition_name,

      ai_confidence, condition_id, primary_scan_id, status, payment_status,

      payment_amount, payment_reference, payment_hold_expires_at, created_at

    ) values (

      p_clinic_id, p_doctor_id, v_user_id, p_date, v_time_clean, v_time_clean,

      p_patient_name, p_patient_email, p_patient_contact, p_patient_address,

      p_patient_gender, p_patient_birthdate, p_emergency_contact_name,

      p_emergency_contact_phone, p_emergency_contact_relationship, p_notes,

      coalesce(p_clinic_note, 'Temporary slot hold acquired pending upfront payment.'),

      p_questionnaire_answers, p_skin_photo_url, p_ai_condition_name,

      p_ai_confidence, p_condition_id, p_primary_scan_id, 'pending', 'pending_hold',

      v_consultation_fee, v_ref, v_hold_expires_at, v_now

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

    'clinic_name', coalesce(v_clinic_name, 'Clinic')

  );

end;

$$;



revoke all on function public.acquire_appointment_slot_hold(uuid, uuid, timestamptz, varchar, varchar, text, text, text, text, text, date, text, text, text, text, text, jsonb, text, text, decimal, uuid, uuid, integer, uuid) from public;

grant execute on function public.acquire_appointment_slot_hold(uuid, uuid, timestamptz, varchar, varchar, text, text, text, text, text, date, text, text, text, text, text, jsonb, text, text, decimal, uuid, uuid, integer, uuid) to authenticated, anon, service_role;





-- 3. CANCEL_APPOINTMENT_HOLD (Protected against In-Flight Payment & Unverified Gateway Intent)
drop function if exists public.cancel_appointment_hold(uuid);
drop function if exists public.cancel_appointment_hold(uuid, boolean);

create or replace function public.cancel_appointment_hold(
  p_appointment_id uuid,
  p_gateway_verified boolean default false
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

  select appointment_id, user_id, status, payment_status, clinic_id, clinic_note, payment_reference
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

  -- Guard against cancelling an appointment that has an active in-flight processing or succeeded payment.
  -- This protection applies to ALL callers (including service role and admin) to guarantee payment safety.
  if exists (
    select 1 from public.user_payment
    where appointment_id = p_appointment_id
      and status in ('processing', 'paid', 'succeeded', 'completed')
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_PROCESSING',
      'error', 'ERR_PAYMENT_PROCESSING',
      'message', 'Payment is currently in progress or already completed; hold cannot be cancelled.'
    );
  end if;

  -- If payment_reference contains a real gateway intent (starts with 'pi_' or not SIM-/NONE),
  -- reject direct RPC cancellation unless verified terminal by the trusted server Edge Function (service_role + p_gateway_verified).
  if (
    v_appt.payment_reference is not null
    and v_appt.payment_reference <> ''
    and v_appt.payment_reference <> 'NONE'
    and v_appt.payment_reference not like 'SIM-%'
  ) then
    if not (v_is_service_role and coalesce(p_gateway_verified, false) = true) then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_GATEWAY_CHECK_REQUIRED',
        'error', 'ERR_GATEWAY_CHECK_REQUIRED',
        'message', 'Appointment has an attached payment intent. Authoritative gateway verification via server is required before cancelling.'
      );
    end if;
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
        'message', 'Unauthorized to cancel another patient\'s hold.'
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
        checkout_claim_id = null,
        checkout_claim_expires_at = null,
        clinic_note = coalesce(clinic_note || ' | ', '') || 'Slot hold cancelled.'
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

revoke all on function public.cancel_appointment_hold(uuid, boolean) from public, anon;
grant execute on function public.cancel_appointment_hold(uuid, boolean) to authenticated, service_role;






-- 4. RELEASE_EXPIRED_APPOINTMENT_HOLDS (Payment-Aware Batch Cleanup)

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

      where status not in ('cancelled', 'rejected', 'completed')

        and (

          -- Confirmed failed payments past expiry

          (payment_status = 'failed' and payment_hold_expires_at is not null and payment_hold_expires_at <= now())

          -- Pure unpaid holds with no external payment intent

          or (

            payment_status = 'pending_hold'

            and payment_hold_expires_at is not null

            and payment_hold_expires_at <= now()

            and (payment_reference is null or payment_reference like 'SIM-%')

          )

          -- Hard ceiling for stale abandoned holds past 1 hour

          or (

            payment_status in ('pending_hold', 'failed')

            and payment_hold_expires_at is not null

            and payment_hold_expires_at <= (now() - interval '1 hour')

          )

        )

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





-- 5. FULFILL_APPOINTMENT_PAYMENT_ATOMIC (Safe Late Webhook Fulfillment & Anti-Collision)

drop function if exists public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text);
drop function if exists public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text, text);
drop function if exists public.fulfill_appointment_payment_atomic(uuid, text, numeric, text, uuid, text);
drop function if exists public.fulfill_appointment_payment_atomic(uuid, text, numeric, text, uuid, text, text);

create or replace function public.fulfill_appointment_payment_atomic(

  p_appointment_id uuid,

  p_paymongo_payment_id text,

  p_amount numeric,

  p_payment_method text,

  p_user_id uuid default null,

  p_payment_intent_id text default null,

  p_currency text default 'PHP'

)

returns jsonb

language plpgsql

security definer

set search_path = public

as $$

declare

  v_appt record;

  v_conflict_appt_id uuid;

  v_existing_pay record;

  v_slot_meta record;

  v_clinic_name text;

  v_doctor_name text;

  v_queue_num integer;

  v_pay_summary text;

  v_recon_note text;

  v_is_overpayment boolean := false;

  v_overpayment_diff decimal(10,2) := 0;

  v_earned_fee decimal(10,2);

  v_cal_date date;

  v_time_clean varchar(20);

  v_lock_key bigint;

  v_slot_lock_key bigint;

  v_locked_first boolean;

  v_locked_second boolean;

  v_locked_cal_date date;

  v_locked_time_clean varchar(20);

  v_target_user_id uuid;

  v_now timestamptz;

begin

  if p_appointment_id is null or p_paymongo_payment_id is null or p_amount is null or p_payment_method is null then

    return jsonb_build_object(

      'success', false,

      'code', 'ERR_INVALID_PARAMS',

      'message', 'Missing required parameters for payment fulfillment.'

    );

  end if;



  v_now := now();



  -- 1. Pre-read slot coordinates to derive deterministic advisory lock keys

  select clinic_id, assigned_doctor_id, date, time, batch_time

  into v_slot_meta

  from public.patient_appointment

  where appointment_id = p_appointment_id;



  if v_slot_meta.clinic_id is null then

    return jsonb_build_object(

      'success', false,

      'code', 'ERR_NOT_FOUND',

      'message', 'Appointment not found.'

    );

  end if;



  v_cal_date := (v_slot_meta.date at time zone 'Asia/Manila')::date;

  v_time_clean := left(trim(coalesce(v_slot_meta.time, v_slot_meta.batch_time, '08:00')), 5);



  -- 2A. Concurrency Lock: Deterministic Ascending Key Order (LEAST -> GREATEST)

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

         date, time, batch_time, assigned_doctor_id, payment_reference, doctor_status, queue_number

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



  -- Coordinate change verification

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

      'queue_number', v_appt.queue_number,

      'earned_fee', v_earned_fee,

      'captured_amount', p_amount,

      'payment_reference', coalesce(v_appt.payment_reference, p_paymongo_payment_id)

    );

  end if;



  -- 5B. Orphan & Stale Intent Guard (SEC-03 & Test Item 8):

  -- If payment is from an orphaned intent or does not match active committed intent,

  -- divert to reconciliation_required and NEVER overwrite active appointment.

  if exists (

    select 1 from public.payment_intent_orphan

    where paymongo_payment_id in (p_paymongo_payment_id, coalesce(p_payment_intent_id, ''))

  ) then

    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||

      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||

      ' (Ref: ' || p_paymongo_payment_id || ') from an orphaned checkout intent. Active appointment was not altered.';



    if v_existing_pay.payment_id is not null then

      update public.user_payment

      set status = 'reconciliation_required',

          amount = p_amount

      where payment_id = v_existing_pay.payment_id;

    else

      insert into public.user_payment (

        amount, payment_date, method, status, user_id,

        reference_number, paymongo_payment_id, paymongo_payment_intent_id,

        appointment_id, clinic_id, payment_type

      ) values (

        p_amount, v_now, p_payment_method, 'reconciliation_required', v_target_user_id,

        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,

        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'

      );

    end if;



    update public.payment_intent_orphan

    set status = 'reconciled',

        resolved_at = coalesce(resolved_at, v_now),

        updated_at = v_now

    where paymongo_payment_id in (p_paymongo_payment_id, coalesce(p_payment_intent_id, ''));



    return jsonb_build_object(

      'success', true,

      'action', 'reconciliation_required',

      'status', 'reconciliation_required',

      'appointment_id', p_appointment_id,

      'payment_reference', p_paymongo_payment_id,

      'message', 'Payment captured for an orphaned/superseded intent. Flagged for reconciliation.'

    );

  end if;



  if v_appt.payment_reference is not null

     and v_appt.payment_reference not in (p_paymongo_payment_id, coalesce(p_payment_intent_id, ''))

     and not (v_appt.payment_reference like 'TEMP-%') then

    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||

      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||

      ' (Ref: ' || p_paymongo_payment_id || ') does not match active payment reference ' || v_appt.payment_reference ||

      '. Active appointment reference was not overwritten.';



    if v_existing_pay.payment_id is not null then

      update public.user_payment

      set status = 'reconciliation_required',

          amount = p_amount

      where payment_id = v_existing_pay.payment_id;

    else

      insert into public.user_payment (

        amount, payment_date, method, status, user_id,

        reference_number, paymongo_payment_id, paymongo_payment_intent_id,

        appointment_id, clinic_id, payment_type

      ) values (

        p_amount, v_now, p_payment_method, 'reconciliation_required', v_target_user_id,

        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,

        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'

      );

    end if;



    return jsonb_build_object(

      'success', true,

      'action', 'reconciliation_required',

      'status', 'reconciliation_required',

      'appointment_id', p_appointment_id,

      'payment_reference', p_paymongo_payment_id,

      'message', 'Captured payment reference does not match active appointment reference. Flagged for reconciliation.'

    );

  end if;



  -- 6A. Explicit Cancellation Check:

  -- If appointment was explicitly cancelled by patient or clinic note, payment cannot reactivate it.

  if v_appt.payment_status = 'cancelled' or v_appt.status = 'cancelled' then

    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||

      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||

      ' (Ref: ' || p_paymongo_payment_id || ') after appointment was cancelled. Slot was not reactivated.';



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

      'Payment Captured On Cancelled Appointment',

      'Appointment #' || p_appointment_id::text,

      'Payment ' || p_paymongo_payment_id || ' (₱' || p_amount::text || ') captured for cancelled appointment ' || p_appointment_id::text || '. Flagged for administrative reconciliation.',

      'Database Atomic Payment RPC'

    );



    return jsonb_build_object(

      'success', true,

      'action', 'reconciliation_required',

      'status', 'cancelled',

      'appointment_id', p_appointment_id

    );

  end if;



  -- 6B. Slot Collision Check:

  -- Check if ANOTHER appointment has already booked or reserved this slot.

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

    -- Truly collided: another patient already booked this slot while hold was expired

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



  -- 7. NORMAL FULFILLMENT BRANCH (Slot is available & valid — fulfill even if hold timestamp passed!)

  v_pay_summary := coalesce(v_appt.clinic_note || ' | ', '') || 'Paid Online (' || p_payment_method || ' Ref: ' || p_paymongo_payment_id || ')';



  -- Queue Number Generation (Idempotent: only if not already assigned)

  if v_appt.queue_number is not null then

    v_queue_num := v_appt.queue_number;

  else

    select coalesce(max(queue_number), 0) + 1

    into v_queue_num

    from public.patient_appointment

    where clinic_id = v_appt.clinic_id

      and ((date at time zone 'Asia/Manila')::date = v_cal_date)

      and payment_status = 'paid'

      and status not in ('cancelled', 'rejected');

  end if;



  begin

    perform set_config('app.internal_payment_context', 'true', true);



    update public.patient_appointment

    set payment_status = 'paid',

        status = 'scheduled',

        paid_at = coalesce(paid_at, v_now),

        payment_reference = p_paymongo_payment_id,

        queue_number = v_queue_num,

        clinic_note = v_pay_summary

    where appointment_id = p_appointment_id;



    perform set_config('app.internal_payment_context', '', true);

  exception when others then

    perform set_config('app.internal_payment_context', '', true);

    raise;

  end;



  -- Upsert user_payment record

  if v_existing_pay.payment_id is not null then

    update public.user_payment

    set status = 'paid',

        amount = p_amount,

        appointment_id = p_appointment_id,

        user_id = v_target_user_id,

        clinic_id = v_appt.clinic_id

    where payment_id = v_existing_pay.payment_id;

  else

    insert into public.user_payment (

      amount,

      payment_date, method, status, user_id,

      reference_number, paymongo_payment_id, paymongo_payment_intent_id,

      appointment_id, clinic_id, payment_type

    ) values (

      p_amount,

      v_now, p_payment_method, 'paid', v_target_user_id,

      p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,

      p_appointment_id, v_appt.clinic_id, 'appointment_consultation'

    );

  end if;



  -- System Audit Log

  insert into public.system_audit_log (

    user_id, user_type, log_type, action, target, details, performer_name

  ) values (

    v_target_user_id,

    'patient',

    'appointment',

    'Appointment Payment Fulfilled',

    'Appointment #' || p_appointment_id::text,

    'Payment of ₱' || p_amount::text || ' via ' || p_payment_method || ' (Ref: ' || p_paymongo_payment_id || ') verified and fulfilled. Queue #' || v_queue_num::text || ' assigned.',

    'Database Atomic Payment RPC'

  );



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

    'queue_number', v_queue_num,

    'earned_fee', v_earned_fee,

    'captured_amount', p_amount,

    'payment_reference', p_paymongo_payment_id,

    'is_overpayment', v_is_overpayment,

    'overpayment_amount', v_overpayment_diff

  );

end;

$$;



revoke all on function public.fulfill_appointment_payment_atomic(uuid, text, numeric, text, uuid, text, text) from public, anon;

grant execute on function public.fulfill_appointment_payment_atomic(uuid, text, numeric, text, uuid, text, text) to authenticated, service_role;






-- ============================================================================
-- ATOMIC CHECKOUT CLAIM & COMMIT RPCS (Concurrency & Partial Tracking Safety)
-- ============================================================================

alter table public.patient_appointment
  add column if not exists checkout_claim_id text,
  add column if not exists checkout_claim_expires_at timestamptz,
  add column if not exists checkout_idempotency_key text;

-- ============================================================================
-- PERSISTENT ORPHAN INTENT TRACKING TABLE & RPCS (SEC-03)
-- ============================================================================

create table if not exists public.payment_intent_orphan (
  orphan_id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.patient_appointment(appointment_id) on delete cascade,
  paymongo_payment_id text not null unique,
  amount numeric not null,
  currency text not null default 'PHP',
  status text not null default 'pending_cancellation', -- pending_cancellation, cancelled, reconciled, failed_cancellation
  cancellation_error text,
  claim_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_payment_intent_orphan_appt on public.payment_intent_orphan(appointment_id);
create index if not exists idx_payment_intent_orphan_status on public.payment_intent_orphan(status);

alter table public.payment_intent_orphan enable row level security;
revoke all on public.payment_intent_orphan from public, anon;
grant select, insert, update, delete on public.payment_intent_orphan to service_role;

create or replace function public.record_orphaned_intent(
  p_appointment_id uuid,
  p_paymongo_payment_id text,
  p_amount numeric,
  p_claim_id text default null,
  p_idempotency_key text default null,
  p_cancellation_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as 
declare
  v_id uuid;
begin
  if p_appointment_id is null or p_paymongo_payment_id is null or trim(p_paymongo_payment_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID and PayMongo payment ID are required.'
    );
  end if;

  insert into public.payment_intent_orphan (
    appointment_id,
    paymongo_payment_id,
    amount,
    currency,
    status,
    cancellation_error,
    claim_id,
    idempotency_key,
    created_at,
    updated_at
  ) values (
    p_appointment_id,
    p_paymongo_payment_id,
    coalesce(p_amount, 0),
    'PHP',
    'pending_cancellation',
    p_cancellation_error,
    p_claim_id,
    p_idempotency_key,
    now(),
    now()
  )
  on conflict (paymongo_payment_id) do update set
    cancellation_error = coalesce(excluded.cancellation_error, public.payment_intent_orphan.cancellation_error),
    updated_at = now()
  returning orphan_id into v_id;

  return jsonb_build_object(
    'success', true,
    'orphan_id', v_id,
    'paymongo_payment_id', p_paymongo_payment_id
  );
end;
;

revoke all on function public.record_orphaned_intent(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.record_orphaned_intent(uuid, text, numeric, text, text, text) to service_role;

create or replace function public.resolve_orphaned_intent(
  p_paymongo_payment_id text,
  p_status text,
  p_cancellation_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as 
declare
  v_row_count integer;
begin
  if p_paymongo_payment_id is null or trim(p_paymongo_payment_id) = '' or p_status is null then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS');
  end if;

  update public.payment_intent_orphan
  set status = p_status,
      cancellation_error = case when p_cancellation_error is not null then p_cancellation_error else cancellation_error end,
      updated_at = now(),
      resolved_at = case when p_status in ('cancelled', 'reconciled') then coalesce(resolved_at, now()) else resolved_at end
  where paymongo_payment_id = p_paymongo_payment_id;

  get diagnostics v_row_count = row_count;

  return jsonb_build_object(
    'success', true,
    'updated', v_row_count > 0,
    'paymongo_payment_id', p_paymongo_payment_id,
    'status', p_status
  );
end;
;

revoke all on function public.resolve_orphaned_intent(text, text, text) from public, anon;
grant execute on function public.resolve_orphaned_intent(text, text, text) to service_role;

-- 1. claim_checkout_intent: Atomically acquires an exclusive checkout lease
create or replace function public.claim_checkout_intent(
  p_appointment_id uuid,
  p_claim_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as 
declare
  v_appt record;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_lease interval;
  v_idempotency_key text;
begin
  if p_appointment_id is null or p_claim_id is null or trim(p_claim_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID and claim ID are required.'
    );
  end if;

  v_lease := (coalesce(p_lease_seconds, 60) || ' seconds')::interval;
  v_expires_at := v_now + v_lease;

  select
    appointment_id,
    user_id,
    clinic_id,
    payment_amount,
    payment_status,
    status,
    payment_hold_expires_at,
    payment_reference,
    checkout_claim_id,
    checkout_claim_expires_at,
    checkout_idempotency_key
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

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ALREADY_PAID',
      'message', 'Appointment is already paid.'
    );
  end if;

  if v_appt.payment_status = 'cancelled' or (v_appt.payment_hold_expires_at is not null and v_appt.payment_hold_expires_at <= v_now) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_HOLD_EXPIRED',
      'message', 'Appointment reservation hold has expired or was cancelled.'
    );
  end if;

  -- Check if another active unexpired claim exists
  if v_appt.checkout_claim_id is not null
     and v_appt.checkout_claim_id <> p_claim_id
     and v_appt.checkout_claim_expires_at is not null
     and v_appt.checkout_claim_expires_at > v_now then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CLAIM_IN_PROGRESS',
      'message', 'Another checkout request is currently acquiring a payment intent for this appointment.',
      'claim_expires_at', v_appt.checkout_claim_expires_at
    );
  end if;

  -- Maintain stable checkout idempotency key for this logical checkout operation
  if v_appt.checkout_idempotency_key is null then
    v_idempotency_key := 'dermai_appt_' || replace(p_appointment_id::text, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  else
    v_idempotency_key := v_appt.checkout_idempotency_key;
  end if;

  -- Acquire or refresh claim
  perform set_config('app.internal_payment_context', 'true', true);

  update public.patient_appointment
  set checkout_claim_id = p_claim_id,
      checkout_claim_expires_at = v_expires_at,
      checkout_idempotency_key = v_idempotency_key
  where appointment_id = p_appointment_id;

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object(
    'success', true,
    'appointment_id', v_appt.appointment_id,
    'user_id', v_appt.user_id,
    'clinic_id', v_appt.clinic_id,
    'payment_amount', v_appt.payment_amount,
    'payment_status', v_appt.payment_status,
    'payment_reference', v_appt.payment_reference,
    'checkout_claim_id', p_claim_id,
    'checkout_claim_expires_at', v_expires_at,
    'checkout_idempotency_key', v_idempotency_key
  );
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
;

revoke all on function public.claim_checkout_intent(uuid, text, integer) from public, anon;
grant execute on function public.claim_checkout_intent(uuid, text, integer) to authenticated, service_role;

-- 2. commit_checkout_intent: Atomically records payment reference and user_payment row, clearing claim
create or replace function public.commit_checkout_intent(
  p_appointment_id uuid,
  p_claim_id text,
  p_intent_id text,
  p_method text,
  p_amount numeric,
  p_clinic_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as 
declare
  v_appt record;
begin
  if p_appointment_id is null or p_intent_id is null or trim(p_intent_id) = '' or p_claim_id is null or trim(p_claim_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID, claim ID, and intent ID are required.'
    );
  end if;

  select appointment_id, user_id, payment_status, checkout_claim_id, checkout_claim_expires_at
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

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ALREADY_PAID',
      'message', 'Appointment is already paid.'
    );
  end if;

  -- SEC-01: Validate checkout claim ownership and unexpired lease
  if v_appt.checkout_claim_id is null
     or v_appt.checkout_claim_id <> p_claim_id
     or v_appt.checkout_claim_expires_at is null
     or v_appt.checkout_claim_expires_at <= now() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CLAIM_LOST',
      'message', 'Checkout claim lease was lost, replaced, or expired before commit.',
      'current_claim_id', v_appt.checkout_claim_id,
      'claim_expires_at', v_appt.checkout_claim_expires_at
    );
  end if;

  -- Atomic update of patient_appointment and upsert of user_payment in the same transaction
  perform set_config('app.internal_payment_context', 'true', true);

  update public.patient_appointment
  set payment_reference = p_intent_id,
      checkout_claim_id = null,
      checkout_claim_expires_at = null
  where appointment_id = p_appointment_id;

  insert into public.user_payment (
    amount,
    payment_date,
    method,
    status,
    user_id,
    reference_number,
    paymongo_payment_id,
    paymongo_payment_intent_id,
    appointment_id,
    clinic_id,
    payment_type
  ) values (
    p_amount,
    now(),
    p_method,
    'processing',
    coalesce(p_user_id, v_appt.user_id),
    p_intent_id,
    p_intent_id,
    p_intent_id,
    p_appointment_id,
    p_clinic_id,
    'appointment_consultation'
  )
  on conflict (paymongo_payment_id) do update set
    amount = excluded.amount,
    payment_date = excluded.payment_date,
    method = excluded.method,
    status = 'processing',
    appointment_id = excluded.appointment_id,
    clinic_id = excluded.clinic_id;

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'payment_reference', p_intent_id
  );
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
;

revoke all on function public.commit_checkout_intent(uuid, text, text, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.commit_checkout_intent(uuid, text, text, text, numeric, uuid, uuid) to service_role;

-- 3. release_checkout_claim: Releases claim lease immediately on PayMongo error or preflight abort
create or replace function public.release_checkout_claim(
  p_appointment_id uuid,
  p_claim_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS');
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  update public.patient_appointment
  set checkout_claim_id = null,
      checkout_claim_expires_at = null
  where appointment_id = p_appointment_id
    and (p_claim_id is null or checkout_claim_id = p_claim_id);

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object('success', true);
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.release_checkout_claim(uuid, text) from public, anon;
grant execute on function public.release_checkout_claim(uuid, text) to authenticated, service_role;
