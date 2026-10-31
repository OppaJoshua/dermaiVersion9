-- ============================================================================
-- DermAI Database Migration: 20261030_realtime_occupied_slots_and_occupancy_type.sql
-- Description:
--   1. Authoritative get_occupied_appointment_slots RPC:
--      - Returns occupancy_type ('reserved' vs 'booked') without exposing any patient,
--        payment, contact, or medical information (Zero PII).
--      - Graceful 2-year scheduling horizon using Asia/Manila date boundaries.
--      - Excludes cancelled, rejected, and expired/timed-out holds.
--      - Supports doctor-specific slot filtering while preserving clinic-wide unassigned holds.
--      - Granted to authenticated, anon, and service_role for schedule viewing.
--   2. Authoritative cancel_appointment_hold RPC:
--      - Safely cancels temporary pending/failed checkout holds.
--      - CRITICAL SECURITY: Uses auth.role() and auth.uid() (never current_user in SECURITY DEFINER).
--      - Enforces strict patient ownership (must match auth.uid(), admin, or service_role).
--      - Unassigned holds (user_id IS NULL) strictly require admin or service_role to cancel.
--      - CRITICAL CONCURRENCY: Uses SELECT ... FOR UPDATE row lock and atomic conditional UPDATE.
--      - Verifies row_count to prevent false success on concurrent state change.
--      - CRITICAL GUARD: Paid appointments can NEVER be cancelled by hold cleanup.
--      - Granted strictly to authenticated and service_role (revoked from anon).
--   3. Authoritative release_expired_appointment_holds RPC:
--      - Reaps expired pending_hold or failed records where payment_hold_expires_at <= now().
--      - CRITICAL SECURITY: Callable ONLY by service_role or admin (verified via auth.role()).
--      - Revoked from anon and public to prevent unauthorized execution.
-- ============================================================================

-- 1. DROP EXISTING FUNCTIONS SAFELY (required in Postgres when return types change)
drop function if exists public.get_occupied_appointment_slots(uuid, date, uuid);
drop function if exists public.cancel_appointment_hold(uuid);
drop function if exists public.release_expired_appointment_holds();

-- 2. GET_OCCUPIED_APPOINTMENT_SLOTS
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
  occupancy_type varchar
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_today_manila date;
begin
  -- Parameter validation
  if p_clinic_id is null or p_date is null then
    return;
  end if;

  -- Verify target clinic exists
  if not exists (select 1 from public.clinic c where c.clinic_id = p_clinic_id) then
    return;
  end if;

  v_today_manila := (timezone('Asia/Manila', now()))::date;

  -- Validate scheduling horizon: 365 days past to 730 days future (graceful empty return)
  if p_date < (v_today_manila - interval '365 days')::date or p_date > (v_today_manila + interval '730 days')::date then
    return;
  end if;

  return query
  select distinct
    left(trim(coalesce(pa.time, pa.batch_time, '08:00')), 5)::varchar as slot_time,
    (pa.date at time zone 'Asia/Manila')::date as slot_date,
    pa.assigned_doctor_id,
    pa.clinic_id,
    case
      when pa.payment_status = 'pending_hold' and (pa.payment_hold_expires_at is null or pa.payment_hold_expires_at > now()) then 'reserved'::varchar
      else 'booked'::varchar
    end as occupancy_type
  from public.patient_appointment pa
  where pa.clinic_id = p_clinic_id
    and ((pa.date at time zone 'Asia/Manila')::date = p_date)
    and (p_doctor_id is null or pa.assigned_doctor_id = p_doctor_id or pa.assigned_doctor_id is null)
    and pa.status not in ('cancelled', 'rejected')
    and (pa.doctor_status is null or pa.doctor_status <> 'rejected')
    -- Exclude expired, cancelled, or failed payment holds
    and not (
      pa.payment_status is not null
      and pa.payment_status in ('expired', 'cancelled', 'failed')
    )
    and not (
      pa.payment_status is not null
      and pa.payment_status in ('pending_hold', 'failed')
      and pa.payment_hold_expires_at is not null
      and pa.payment_hold_expires_at <= now()
    );
end;
$$;

revoke all on function public.get_occupied_appointment_slots(uuid, date, uuid) from public;
grant execute on function public.get_occupied_appointment_slots(uuid, date, uuid) to authenticated, anon, service_role;

-- 3. CANCEL_APPOINTMENT_HOLD
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

  -- 1. Security Check: Use auth.role() rather than current_user inside SECURITY DEFINER
  v_user_id := auth.uid();
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');

  if v_user_id is null and not v_is_service_role then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNAUTHORIZED',
      'error', 'ERR_UNAUTHORIZED',
      'message', 'You must be signed in to cancel a reservation hold.'
    );
  end if;

  -- 2. Concurrency Lock: Lock the appointment row using SELECT ... FOR UPDATE
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

  -- CRITICAL GUARD: Paid appointments can NEVER be cancelled by hold release
  if v_appt.payment_status = 'paid' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ALREADY_PAID',
      'error', 'ERR_ALREADY_PAID',
      'message', 'Cannot cancel hold: appointment is already paid.'
    );
  end if;

  -- Guard: Only pending_hold or failed temporary reservations can be released
  if v_appt.payment_status not in ('pending_hold', 'failed') and v_appt.status not in ('pending') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_STATUS',
      'error', 'ERR_INVALID_STATUS',
      'message', 'Appointment is not in an active temporary hold state.'
    );
  end if;

  -- 3. Ownership verification:
  -- - If appointment has user_id: caller must be the holding patient, an administrator, or service_role
  -- - If appointment has user_id IS NULL: ordinary patients are prohibited; only admin or service_role can cancel
  if v_appt.user_id is not null then
    if (v_user_id is null or v_user_id <> v_appt.user_id) and not is_admin() and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'Unauthorized to cancel another patient''s hold.'
      );
    end if;
  else
    if not is_admin() and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'Unauthorized to cancel unassigned clinic hold.'
      );
    end if;
  end if;

  -- 4. Perform authoritative cancellation with conditional state precondition
  perform set_config('app.internal_payment_context', 'true', true);

  update public.patient_appointment
  set status = 'cancelled',
      payment_status = 'cancelled',
      clinic_note = coalesce(clinic_note || ' | ', '') || 'Slot hold cancelled by patient.'
  where appointment_id = p_appointment_id
    and payment_status in ('pending_hold', 'failed');

  get diagnostics v_rows_updated = row_count;

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

revoke all on function public.cancel_appointment_hold(uuid) from public;
grant execute on function public.cancel_appointment_hold(uuid) to authenticated, service_role;

-- 4. RELEASE_EXPIRED_APPOINTMENT_HOLDS
create or replace function public.release_expired_appointment_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_is_service_role boolean;
begin
  -- CRITICAL SECURITY: Restrict execution to service_role or administrator accounts (via auth.role())
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');

  if not v_is_service_role and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'Only service role or administrators may invoke hold cleanup.'
    );
  end if;

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
grant execute on function public.release_expired_appointment_holds() to service_role;

-- ============================================================================
-- ============================================================================
-- 5. FINANCIAL LEDGER INTEGRITY & CONCURRENCY CONSTRAINTS (user_payment)
-- ============================================================================
alter table if exists public.user_payment
  alter column status type varchar(50);

alter table if exists public.user_payment
  drop constraint if exists user_payment_status_check;

alter table if exists public.user_payment
  drop constraint if exists check_user_payment_status;

alter table if exists public.user_payment
  add constraint check_user_payment_status
  check (status in ('success', 'failed', 'pending', 'reconciliation_required', 'refunded'));

-- Ensure column overpayment_amount exists to separate earned revenue from excess liability
alter table if exists public.user_payment
  add column if not exists overpayment_amount decimal(10,2) not null default 0.00;

-- Ensure database-level idempotency on PayMongo transactions to prevent duplicate payment records
create unique index if not exists idx_user_payment_paymongo_payment_id
  on public.user_payment (paymongo_payment_id)
  where paymongo_payment_id is not null;

-- ============================================================================
-- 6. AUTHORITATIVE ATOMIC PAYMENT FULFILLMENT RPC
-- ============================================================================
drop function if exists public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text);
drop function if exists public.fulfill_appointment_payment_atomic(text, text, uuid, uuid, decimal, text, text);

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
  v_slot_lock_key bigint;
begin
  -- 1. Strict Security Barrier: Callable strictly by service_role or active platform administrators
  if coalesce(auth.role(), '') <> 'service_role' and not is_admin() then
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

  -- 2. Lock appointment row with SELECT ... FOR UPDATE to serialize all concurrent fulfillment/cancellation requests
  select appointment_id, user_id, clinic_id, payment_status, status, clinic_note,
         payment_hold_expires_at, payment_amount, patient_name, patient_email, date, time, batch_time, assigned_doctor_id, payment_reference
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

  -- 2B. Harmonized Slot-Level Transactional Advisory Lock:
  -- Acquire identical pg_advisory_xact_lock used by acquire_appointment_slot_hold() to serialize hold acquisition and payment fulfillment
  v_cal_date := (v_appt.date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(v_appt.time, v_appt.batch_time, '08:00')), 5);
  v_slot_lock_key := hashtext(concat(
    coalesce(v_appt.clinic_id::text, ''),
    coalesce(v_appt.assigned_doctor_id::text, 'unassigned'),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(v_slot_lock_key);

  -- 2C. Authoritative Clinic and Doctor Name Resolution
  select name into v_clinic_name from public.clinic where clinic_id = v_appt.clinic_id;
  if v_appt.assigned_doctor_id is not null then
    select doctor_name into v_doctor_name from public.clinic_doctor where doctor_id = v_appt.assigned_doctor_id;
  end if;

  -- 3. Trust Authoritative Server-Side Data: Validate ownership and payment amount
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

  -- 3B. Fee Completeness & Overpayment Logic:
  -- - Underpayment is rejected immediately with ERR_INSUFFICIENT_AMOUNT
  -- - Overpayment is handled explicitly: accepted, recorded, and flagged in clinic note & audit log for refunding
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
    -- Isolation guard: Ensure payment reference is not reused across different appointments
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
  -- When already paid, return all authoritative appointment metadata so caller can verify outbox receipt idempotently
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

  -- 6. Evaluate Hold Expiration & Cancellation State
  v_is_expired := (
    v_appt.payment_status = 'expired'
    or (
      v_appt.payment_status in ('pending_hold', 'failed')
      and v_appt.payment_hold_expires_at is not null
      and v_appt.payment_hold_expires_at <= v_now
    )
  );

  if v_appt.payment_status = 'cancelled' or v_appt.status = 'cancelled' or v_is_expired then
    -- RECONCILIATION BRANCH (Atomic: Never reactivate cancelled/expired slot)
    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||
      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||
      ' (Ref: ' || p_paymongo_payment_id || ') after hold was ' ||
      case when v_is_expired then 'expired' else coalesce(v_appt.payment_status, 'cancelled') end ||
      '. Slot was not reactivated.';

    update public.patient_appointment
    set payment_reference = p_paymongo_payment_id,
        clinic_note = v_recon_note
    where appointment_id = p_appointment_id;

    if v_existing_pay.payment_id is not null then
      update public.user_payment
      set status = 'reconciliation_required',
          amount = p_amount,
          amount_paid = p_amount,
          overpayment_amount = 0.00
      where payment_id = v_existing_pay.payment_id;
    else
      insert into public.user_payment (
        amount, amount_paid, overpayment_amount, total_amount,
        payment_date, method, status, user_id,
        reference_number, paymongo_payment_id, paymongo_payment_intent_id,
        appointment_id, clinic_id, payment_type
      ) values (
        p_amount, p_amount, 0.00, p_amount,
        v_now, p_payment_method, 'reconciliation_required', v_target_user_id,
        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,
        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'
      );
    end if;

    insert into public.system_audit_log (
      user_id, action, details, ip_address, user_agent
    ) values (
      v_target_user_id,
      case when v_is_expired then 'Payment Captured On Expired Appointment' else 'Payment Captured On Cancelled Appointment' end,
      'Payment ' || p_paymongo_payment_id || ' (₱' || p_amount::text || ') captured for appointment ' || p_appointment_id::text || ' after hold was ' || case when v_is_expired then 'expired' else 'cancelled' end || '. Flagged for administrative reconciliation.',
      '127.0.0.1',
      'Database Atomic Payment RPC'
    );

    return jsonb_build_object(
      'success', true,
      'action', 'reconciliation_required',
      'status', case when v_is_expired then 'expired' else 'cancelled' end,
      'appointment_id', p_appointment_id
    );
  end if;

  -- 6B. Slot-Level Concurrency & Anti-Collision Barrier:
  -- Verify that no other appointment has already been confirmed/paid for this exact doctor/clinic/date/time
  select appointment_id into v_conflict_appt_id
  from public.patient_appointment
  where clinic_id = v_appt.clinic_id
    and (assigned_doctor_id is not distinct from v_appt.assigned_doctor_id)
    and ((date at time zone 'Asia/Manila')::date = (v_appt.date at time zone 'Asia/Manila')::date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = left(trim(coalesce(v_appt.time, v_appt.batch_time, '')), 5))
    and payment_status = 'paid'
    and status not in ('cancelled', 'rejected')
    and appointment_id <> p_appointment_id
  limit 1;

  if v_conflict_appt_id is not null then
    -- Slot was already confirmed by another appointment!
    -- Route to reconciliation immediately without double-booking the doctor!
    v_recon_note := coalesce(v_appt.clinic_note || ' | ', '') ||
      '[RECONCILIATION REQUIRED] Captured ₱' || p_amount::text || ' via ' || p_payment_method ||
      ' (Ref: ' || p_paymongo_payment_id || ') but slot was already booked by appointment ' || v_conflict_appt_id::text ||
      '. Slot was not double-booked.';

    update public.patient_appointment
    set payment_reference = p_paymongo_payment_id,
        status = 'cancelled',
        payment_status = 'cancelled',
        clinic_note = v_recon_note
    where appointment_id = p_appointment_id;

    if v_existing_pay.payment_id is not null then
      update public.user_payment
      set status = 'reconciliation_required',
          amount = p_amount,
          amount_paid = p_amount,
          overpayment_amount = 0.00
      where payment_id = v_existing_pay.payment_id;
    else
      insert into public.user_payment (
        amount, amount_paid, overpayment_amount, total_amount,
        payment_date, method, status, user_id,
        reference_number, paymongo_payment_id, paymongo_payment_intent_id,
        appointment_id, clinic_id, payment_type
      ) values (
        p_amount, p_amount, 0.00, p_amount,
        v_now, p_payment_method, 'reconciliation_required', v_target_user_id,
        p_paymongo_payment_id, p_paymongo_payment_id, p_payment_intent_id,
        p_appointment_id, v_appt.clinic_id, 'appointment_consultation'
      );
    end if;

    insert into public.system_audit_log (
      user_id, action, details, ip_address, user_agent
    ) values (
      v_target_user_id,
      'Payment Captured On Colliding Appointment Slot',
      'Payment ' || p_paymongo_payment_id || ' (₱' || p_amount::text || ') was captured for appointment ' || p_appointment_id::text || ', but slot was already booked by appointment ' || v_conflict_appt_id::text || '. Slot collision prevented and payment routed to reconciliation.',
      '127.0.0.1',
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
      user_id, action, details, ip_address, user_agent
    ) values (
      v_target_user_id,
      'Consultation Payment Overpayment Detected',
      'Appointment ' || p_appointment_id::text || ' received overpayment of ₱' || v_overpayment_diff::text || ' (captured ₱' || p_amount::text || ' vs expected ₱' || v_appt.payment_amount::text || ').',
      '127.0.0.1',
      'Database Atomic Payment RPC'
    );
  end if;

  update public.patient_appointment
  set payment_status = 'paid',
      payment_reference = p_paymongo_payment_id,
      payment_amount = v_earned_fee,
      paid_at = v_now,
      clinic_note = v_pay_summary,
      check_in_status = 'scheduled',
      status = 'scheduled'
  where appointment_id = p_appointment_id
    and payment_status in ('pending_hold', 'failed');

  if v_existing_pay.payment_id is not null then
    update public.user_payment
    set status = 'success',
        amount = v_earned_fee,
        amount_paid = p_amount,
        overpayment_amount = case when v_is_overpayment then v_overpayment_diff else 0.00 end,
        total_amount = v_earned_fee
    where payment_id = v_existing_pay.payment_id;
  else
    insert into public.user_payment (
      amount, amount_paid, overpayment_amount, total_amount,
      payment_date, method, status, user_id,
      reference_number, paymongo_payment_id, paymongo_payment_intent_id,
      appointment_id, clinic_id, payment_type
    ) values (
      v_earned_fee,
      p_amount,
      case when v_is_overpayment then v_overpayment_diff else 0.00 end,
      v_earned_fee,
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
-- 7. RELIABLE EMAIL OUTBOX & IDEMPOTENCY SYSTEM
-- ============================================================================

create table if not exists public.email_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  email_type text not null,
  recipient_email text not null,
  user_id uuid references public."user"(user_id) on delete set null,
  appointment_id uuid references public.patient_appointment(appointment_id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_attempt_at timestamptz,
  lease_expires_at timestamptz,
  error_details text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_outbox_status on public.email_outbox(status);
create index if not exists idx_email_outbox_idempotency_key on public.email_outbox(idempotency_key);
create index if not exists idx_email_outbox_appointment_id on public.email_outbox(appointment_id);

-- Enable Row Level Security
alter table public.email_outbox enable row level security;

-- Only service_role and admin have access to email outbox
drop policy if exists "Service role has full access to email outbox" on public.email_outbox;
create policy "Service role has full access to email outbox"
  on public.email_outbox
  for all
  using (coalesce(auth.role(), '') = 'service_role' or is_admin())
  with check (coalesce(auth.role(), '') = 'service_role' or is_admin());

-- RPC to atomically claim an individual outbox task
create or replace function public.claim_email_outbox(
  p_idempotency_key text,
  p_email_type text,
  p_recipient_email text,
  p_user_id uuid,
  p_appointment_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_now timestamptz := now();
  v_lease_expiry timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Unauthorized: Only service_role or admin can claim outbox tasks.'
    );
  end if;

  if p_idempotency_key is null or p_recipient_email is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Missing required parameters for email outbox claim.'
    );
  end if;

  -- 1. Insert pending record if it doesn't already exist
  insert into public.email_outbox (
    idempotency_key, email_type, recipient_email, user_id, appointment_id, payload, status
  ) values (
    p_idempotency_key, p_email_type, p_recipient_email, p_user_id, p_appointment_id, p_payload, 'pending'
  )
  on conflict (idempotency_key) do nothing;

  -- 2. Lock row exclusively with FOR UPDATE to eliminate concurrent worker races
  select * into v_row
  from public.email_outbox
  where idempotency_key = p_idempotency_key
  for update;

  -- 3. If already sent, skip immediately (sent entries are never reclaimed)
  if v_row.status = 'sent' then
    return jsonb_build_object(
      'success', true,
      'claim_acquired', false,
      'status', 'sent',
      'outbox_id', v_row.outbox_id,
      'message', 'Email has already been sent.'
    );
  end if;

  -- 4. If currently processing and lease has NOT expired, another worker has active lock
  if v_row.status = 'processing' and v_row.lease_expires_at is not null and v_row.lease_expires_at > v_now then
    return jsonb_build_object(
      'success', true,
      'claim_acquired', false,
      'status', 'processing',
      'outbox_id', v_row.outbox_id,
      'message', 'Email is currently being processed by another worker within lease window.'
    );
  end if;

  -- 5. Dead-Letter Barrier: If attempts reached or exceeded max_attempts, transition expired processing task to failed
  if (v_row.status = 'failed' or (v_row.status = 'processing' and v_row.lease_expires_at is not null and v_row.lease_expires_at <= v_now))
     and v_row.attempts >= v_row.max_attempts then
    update public.email_outbox
    set status = 'failed',
        error_details = coalesce(error_details || ' | ', '') || 'Maximum delivery attempts exceeded (' || attempts::text || '/' || max_attempts::text || '). Moved to dead-letter state.',
        lease_expires_at = null,
        updated_at = v_now
    where outbox_id = v_row.outbox_id;

    return jsonb_build_object(
      'success', false,
      'claim_acquired', false,
      'status', 'failed',
      'outbox_id', v_row.outbox_id,
      'message', 'Maximum delivery attempts exceeded. Moved to failed state.'
    );
  end if;

  -- 6. Claim acquired: Transition to processing and increment attempts exactly once
  update public.email_outbox
  set status = 'processing',
      attempts = attempts + 1,
      last_attempt_at = v_now,
      lease_expires_at = v_lease_expiry,
      updated_at = v_now
  where outbox_id = v_row.outbox_id;

  return jsonb_build_object(
    'success', true,
    'claim_acquired', true,
    'status', 'processing',
    'outbox_id', v_row.outbox_id,
    'attempts', v_row.attempts + 1
  );
end;
$$;

-- RPC to atomically claim a batch of eligible outbox tasks for background retry worker
create or replace function public.claim_next_email_outbox_batch(
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_lease_expiry timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_admin() then
    raise exception 'ERR_FORBIDDEN: Only service_role or admin can claim outbox batches.';
  end if;

  -- Sweep expired processing records at or above attempt limit directly to 'failed' (dead-letter state)
  update public.email_outbox
  set status = 'failed',
      error_details = coalesce(error_details || ' | ', '') || 'Processing lease expired after reaching maximum attempts (' || attempts::text || '/' || max_attempts::text || '). Moved to dead-letter state.',
      lease_expires_at = null,
      updated_at = v_now
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at <= v_now
    and attempts >= max_attempts;

  -- Return candidate batch using FOR UPDATE SKIP LOCKED
  return query
  with candidate as (
    select o.outbox_id
    from public.email_outbox o
    join public.patient_appointment a on a.appointment_id = o.appointment_id
    where (
      o.status = 'pending'
      or (o.status = 'failed' and o.attempts < o.max_attempts)
      or (o.status = 'processing' and o.lease_expires_at is not null and o.lease_expires_at <= v_now and o.attempts < o.max_attempts)
    )
    and o.status <> 'sent'
    -- CRITICAL SAFETY: Worker ONLY dispatches receipts for confirmed, paid appointments!
    and a.payment_status = 'paid'
    and a.status not in ('cancelled', 'rejected')
    order by o.created_at asc
    limit p_batch_size
    for update of o skip locked
  )
  update public.email_outbox u
  set status = 'processing',
      attempts = attempts + 1,
      last_attempt_at = v_now,
      lease_expires_at = v_lease_expiry,
      updated_at = v_now
  from candidate c
  where u.outbox_id = c.outbox_id
  returning u.*;
end;
$$;

-- RPC to finalize outbox email result
create or replace function public.finalize_email_outbox(
  p_outbox_id uuid,
  p_success boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Unauthorized: Only service_role or admin can finalize outbox tasks.'
    );
  end if;

  if p_success then
    update public.email_outbox
    set status = 'sent',
        sent_at = v_now,
        lease_expires_at = null,
        error_details = null,
        updated_at = v_now
    where outbox_id = p_outbox_id;
  else
    update public.email_outbox
    set status = 'failed',
        lease_expires_at = null,
        error_details = p_error,
        updated_at = v_now
    where outbox_id = p_outbox_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.claim_email_outbox(text, text, text, uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.claim_email_outbox(text, text, text, uuid, uuid, jsonb, integer) to service_role;

revoke all on function public.claim_next_email_outbox_batch(integer, integer) from public, anon;
grant execute on function public.claim_next_email_outbox_batch(integer, integer) to service_role;

revoke all on function public.finalize_email_outbox(uuid, boolean, text) from public, anon;
grant execute on function public.finalize_email_outbox(uuid, boolean, text) to service_role;
