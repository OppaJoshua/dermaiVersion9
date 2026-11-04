-- ============================================================================
-- DermAI Migration: Final Checkout State Machine & Append-Only Audit Logging
-- Date: 2026-11-03
-- Purpose:
-- 1. Add authoritative checkout attempt state columns to patient_appointment.
-- 2. Create append-only checkout_attempt_log table with monotonic sequence ordering.
-- 3. Implement payment-safe claim, uncertain, commit, release, and cancel RPCs.
-- 4. Harden trigger protection against direct client manipulation of checkout fields.
-- 5. Isolate RPC execution exclusively to service_role (preventing out-of-band manipulation).
-- ============================================================================

-- Step 1: Add checkout state tracking columns safely
alter table public.patient_appointment
  add column if not exists checkout_status text default 'idle',
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_payment_method text,
  add column if not exists checkout_payload_hash text,
  add column if not exists checkout_uncertain_reason text,
  add column if not exists checkout_uncertain_at timestamptz;

-- Step 2: Safe, idempotent backfill for existing appointments
update public.patient_appointment
set checkout_status = case
  when payment_status = 'paid' then 'committed'
  when payment_reference is not null and payment_reference not in ('', 'NONE') and payment_reference not like 'SIM-%' then 'committed'
  when payment_status = 'cancelled' or status = 'cancelled' then 'cancelled'
  when checkout_claim_id is not null and checkout_claim_expires_at > now() then 'in_flight'
  else 'idle'
end
where checkout_status is null or checkout_status = 'idle';

-- Enforce NOT NULL and CHECK constraints post-backfill
alter table public.patient_appointment
  alter column checkout_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_patient_appointment_checkout_status'
  ) then
    alter table public.patient_appointment
      add constraint chk_patient_appointment_checkout_status
      check (checkout_status in ('idle', 'in_flight', 'uncertain', 'committed', 'cancelled', 'reconciliation_required'));
  end if;
end $$;

-- Step 3: Create append-only checkout_attempt_log (No cascading delete to preserve audit history)
create table if not exists public.checkout_attempt_log (
  log_id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null, -- Intentionally NO cascading delete
  attempt_id uuid not null,
  attempt_sequence integer not null default 1,
  claim_id text,
  intent_id text, -- Populated if intent ID was discovered, committed, or reconciled
  idempotency_key text not null,
  payment_method text not null,
  payload_hash text not null,
  event text not null, -- 'claim_acquired', 'reentry_renewed', 'gateway_timeout', 'intent_committed', 'cancellation_confirmed', 'cancellation_failed', 'preflight_released', 'webhook_reconciled', 'retention_expired', 'crash_detected'
  status text not null, -- 'in_flight', 'uncertain', 'committed', 'cancelled', 'reconciliation_required', 'idle'
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_checkout_attempt_log_appt on public.checkout_attempt_log(appointment_id);
create index if not exists idx_checkout_attempt_log_attempt on public.checkout_attempt_log(attempt_id);
create index if not exists idx_checkout_attempt_log_key on public.checkout_attempt_log(idempotency_key);
create index if not exists idx_checkout_attempt_log_intent on public.checkout_attempt_log(intent_id) where intent_id is not null;

alter table public.checkout_attempt_log enable row level security;
revoke all on public.checkout_attempt_log from public, anon, authenticated;
grant select, insert on public.checkout_attempt_log to service_role;

-- Step 4: Drop old function signatures to prevent duplicate overloads
drop function if exists public.claim_checkout_intent(uuid, text, integer);
drop function if exists public.claim_checkout_intent(uuid, text, text, text, integer);
drop function if exists public.claim_checkout_intent;

drop function if exists public.commit_checkout_intent(uuid, text, text, text, numeric, uuid, uuid);
drop function if exists public.commit_checkout_intent(uuid, text, uuid, text, text, numeric, uuid, uuid);
drop function if exists public.commit_checkout_intent;

drop function if exists public.release_checkout_claim(uuid, text);
drop function if exists public.release_checkout_claim;

drop function if exists public.record_checkout_uncertain(uuid, text, uuid, text);
drop function if exists public.record_checkout_uncertain;

drop function if exists public.cancel_checkout_attempt(uuid, text, uuid, text, text);
drop function if exists public.cancel_checkout_attempt;

-- Step 5: Implement authoritative claim_checkout_intent RPC
create or replace function public.claim_checkout_intent(
  p_appointment_id uuid,
  p_claim_id text,
  p_payment_method text,
  p_payload_hash text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_now timestamptz := now();
  v_lease interval;
  v_expires_at timestamptz;
  v_attempt_id uuid;
  v_idempotency_key text;
  v_seq integer := 1;
begin
  if p_appointment_id is null or p_claim_id is null or trim(p_claim_id) = '' or
     p_payment_method is null or p_payload_hash is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID, claim ID, payment method, and payload hash are required.'
    );
  end if;

  v_lease := (coalesce(p_lease_seconds, 60) || ' seconds')::interval;
  v_expires_at := v_now + v_lease;

  select appointment_id, user_id, clinic_id, payment_amount, payment_status,
         status, payment_hold_expires_at, payment_reference, checkout_claim_id,
         checkout_attempt_id, checkout_status, checkout_claim_expires_at,
         checkout_idempotency_key, checkout_payload_hash, checkout_payment_method,
         checkout_uncertain_at
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object('success', false, 'code', 'ERR_ALREADY_PAID', 'message', 'Appointment is already paid.');
  end if;

  -- 1. COMMITTED INTENT GUARD: Prevent replacing or demoting a committed checkout
  if v_appt.checkout_status = 'committed' or 
     (v_appt.payment_reference is not null and v_appt.payment_reference not in ('', 'NONE') and v_appt.payment_reference not like 'SIM-%') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CHECKOUT_COMMITTED',
      'message', 'A payment intent is already committed for this reservation.',
      'payment_reference', v_appt.payment_reference,
      'payment_method', v_appt.checkout_payment_method
    );
  end if;

  if v_appt.payment_status = 'cancelled' or (v_appt.payment_hold_expires_at is not null and v_appt.payment_hold_expires_at <= v_now) then
    return jsonb_build_object('success', false, 'code', 'ERR_HOLD_EXPIRED', 'message', 'Reservation hold has expired or was cancelled.');
  end if;

  -- 2. ACTIVE LEASE & SAME-CLAIM RE-ENTRY
  if v_appt.checkout_status = 'in_flight' and v_appt.checkout_claim_expires_at > v_now then
    if v_appt.checkout_claim_id = p_claim_id then
      -- Re-entry: extend lease boundary, retain existing attempt_id and idempotency_key
      perform set_config('app.internal_payment_context', 'true', true);

      select coalesce(max(attempt_sequence), 0) + 1 into v_seq
      from public.checkout_attempt_log
      where attempt_id = v_appt.checkout_attempt_id;

      insert into public.checkout_attempt_log (
        appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
        payment_method, payload_hash, event, status, reason
      ) values (
        p_appointment_id, v_appt.checkout_attempt_id, v_seq, p_claim_id,
        v_appt.checkout_idempotency_key, p_payment_method, p_payload_hash,
        'reentry_renewed', 'in_flight', 'Active lease renewed by same claim holder.'
      );

      update public.patient_appointment
      set checkout_claim_expires_at = v_expires_at
      where appointment_id = p_appointment_id;

      perform set_config('app.internal_payment_context', '', true);

      return jsonb_build_object(
        'success', true,
        'code', 'OK',
        'appointment_id', p_appointment_id,
        'claim_id', p_claim_id,
        'attempt_id', v_appt.checkout_attempt_id,
        'idempotency_key', v_appt.checkout_idempotency_key,
        'claim_expires_at', v_expires_at,
        'is_reentry', true
      );
    else
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_CLAIM_IN_PROGRESS',
        'message', 'Another checkout request is currently acquiring a payment intent.',
        'claim_expires_at', v_appt.checkout_claim_expires_at
      );
    end if;
  end if;

  -- 3. CRASH RECOVERY: Fail closed to uncertain if lease expired during in_flight
  if v_appt.checkout_status = 'in_flight' and v_appt.checkout_claim_expires_at <= v_now then
    perform set_config('app.internal_payment_context', 'true', true);

    select coalesce(max(attempt_sequence), 0) + 1 into v_seq
    from public.checkout_attempt_log
    where attempt_id = v_appt.checkout_attempt_id;

    insert into public.checkout_attempt_log (
      appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
      payment_method, payload_hash, event, status, reason
    ) values (
      p_appointment_id, v_appt.checkout_attempt_id, v_seq, v_appt.checkout_claim_id,
      v_appt.checkout_idempotency_key, coalesce(v_appt.checkout_payment_method, p_payment_method),
      coalesce(v_appt.checkout_payload_hash, p_payload_hash),
      'crash_detected', 'uncertain', 'Lease expired while attempt was in_flight.'
    );

    update public.patient_appointment
    set checkout_status = 'uncertain',
        checkout_uncertain_reason = 'lease_expired_during_in_flight',
        checkout_uncertain_at = v_now
    where appointment_id = p_appointment_id;

    v_appt.checkout_status := 'uncertain';
    v_appt.checkout_uncertain_at := v_now;
  end if;

  -- 4. UNCERTAIN STATE RESOLUTION & RETRY SAFETY
  if v_appt.checkout_status = 'uncertain' then
    -- Hard 24-hour gateway cache expiration boundary
    if v_appt.checkout_uncertain_at is not null and (v_now - v_appt.checkout_uncertain_at) > interval '24 hours' then
      perform set_config('app.internal_payment_context', 'true', true);

      select coalesce(max(attempt_sequence), 0) + 1 into v_seq
      from public.checkout_attempt_log
      where attempt_id = v_appt.checkout_attempt_id;

      insert into public.checkout_attempt_log (
        appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
        payment_method, payload_hash, event, status, reason
      ) values (
        p_appointment_id, v_appt.checkout_attempt_id, v_seq, p_claim_id,
        v_appt.checkout_idempotency_key, p_payment_method, p_payload_hash,
        'retention_expired', 'reconciliation_required', 'Attempt exceeded 24-hour gateway cache window.'
      );

      update public.patient_appointment
      set checkout_status = 'reconciliation_required',
          payment_status = 'reconciliation_required'
      where appointment_id = p_appointment_id;

      perform set_config('app.internal_payment_context', '', true);

      return jsonb_build_object(
        'success', false,
        'code', 'ERR_IDEMPOTENCY_EXPIRED',
        'message', 'Checkout attempt exceeded the 24-hour gateway idempotency retention window and cannot be safely replayed. Please cancel this reservation or contact clinic support.',
        'uncertain_at', v_appt.checkout_uncertain_at
      );
    end if;

    -- Block payment method tampering while prior attempt is uncertain
    if v_appt.checkout_payment_method is not null and v_appt.checkout_payment_method <> p_payment_method then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_METHOD_SWITCH_BLOCKED',
        'message', 'Cannot switch payment methods while previous checkout attempt is uncertain. Replay or cancel the existing attempt first.',
        'pending_method', v_appt.checkout_payment_method,
        'attempt_id', v_appt.checkout_attempt_id,
        'idempotency_key', v_appt.checkout_idempotency_key
      );
    end if;

    -- Block payload parameter tampering
    if v_appt.checkout_payload_hash is not null and v_appt.checkout_payload_hash <> p_payload_hash then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_PAYLOAD_MISMATCH',
        'message', 'Payload parameters do not match the pending uncertain attempt.',
        'attempt_id', v_appt.checkout_attempt_id
      );
    end if;

    -- Verified retry: reuse attempt_id and idempotency_key
    v_attempt_id := v_appt.checkout_attempt_id;
    v_idempotency_key := v_appt.checkout_idempotency_key;
  else
    -- Fresh Attempt from idle / cancelled
    v_attempt_id := gen_random_uuid();
    v_idempotency_key := 'dermai_appt_' || replace(p_appointment_id::text, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  select coalesce(max(attempt_sequence), 0) + 1 into v_seq
  from public.checkout_attempt_log
  where attempt_id = v_attempt_id;

  insert into public.checkout_attempt_log (
    appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
    payment_method, payload_hash, event, status, reason
  ) values (
    p_appointment_id, v_attempt_id, v_seq, p_claim_id,
    v_idempotency_key, p_payment_method, p_payload_hash,
    case when v_appt.checkout_status = 'uncertain' then 'retry_replayed' else 'claim_acquired' end,
    'in_flight', 'Lease acquired for checkout intent processing.'
  );

  update public.patient_appointment
  set checkout_claim_id = p_claim_id,
      checkout_attempt_id = v_attempt_id,
      checkout_status = 'in_flight',
      checkout_claim_expires_at = v_expires_at,
      checkout_idempotency_key = v_idempotency_key,
      checkout_payment_method = p_payment_method,
      checkout_payload_hash = p_payload_hash
  where appointment_id = p_appointment_id;

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object(
    'success', true,
    'code', 'OK',
    'appointment_id', p_appointment_id,
    'claim_id', p_claim_id,
    'attempt_id', v_attempt_id,
    'idempotency_key', v_idempotency_key,
    'claim_expires_at', v_expires_at,
    'is_retry', (v_appt.checkout_status = 'uncertain')
  );
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.claim_checkout_intent from public, anon, authenticated;
grant execute on function public.claim_checkout_intent to service_role;

-- Step 6: Implement commit_checkout_intent RPC
create or replace function public.commit_checkout_intent(
  p_appointment_id uuid,
  p_claim_id text,
  p_attempt_id uuid,
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
as $$
declare
  v_appt record;
  v_rows integer;
  v_seq integer := 1;
begin
  if p_appointment_id is null or p_claim_id is null or p_attempt_id is null or
     p_intent_id is null or trim(p_intent_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID, claim ID, attempt ID, and intent ID are required.'
    );
  end if;

  select appointment_id, user_id, payment_status, checkout_claim_id,
         checkout_attempt_id, checkout_status, checkout_claim_expires_at,
         checkout_idempotency_key, checkout_payload_hash
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.payment_status = 'paid' then
    return jsonb_build_object('success', false, 'code', 'ERR_ALREADY_PAID', 'message', 'Appointment is already paid.');
  end if;

  -- Validate claim ownership, attempt ownership, and unexpired lease
  if v_appt.checkout_claim_id is distinct from p_claim_id or
     v_appt.checkout_attempt_id is distinct from p_attempt_id or
     v_appt.checkout_claim_expires_at is null or
     v_appt.checkout_claim_expires_at <= now() then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CLAIM_LOST',
      'message', 'Checkout claim lease was lost, replaced, or expired before commit.',
      'current_claim_id', v_appt.checkout_claim_id,
      'claim_expires_at', v_appt.checkout_claim_expires_at
    );
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  select coalesce(max(attempt_sequence), 0) + 1 into v_seq
  from public.checkout_attempt_log
  where attempt_id = p_attempt_id;

  insert into public.checkout_attempt_log (
    appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
    payment_method, payload_hash, event, status, reason
  ) values (
    p_appointment_id, p_attempt_id, v_seq, p_claim_id, p_intent_id,
    coalesce(v_appt.checkout_idempotency_key, 'unknown'), p_method,
    coalesce(v_appt.checkout_payload_hash, 'unknown'),
    'intent_committed', 'committed', 'Payment intent committed and tracked successfully.'
  );

  update public.patient_appointment
  set payment_reference = p_intent_id,
      checkout_status = 'committed',
      checkout_claim_id = null,
      checkout_claim_expires_at = null
  where appointment_id = p_appointment_id
    and checkout_claim_id = p_claim_id
    and checkout_attempt_id = p_attempt_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    perform set_config('app.internal_payment_context', '', true);
    return jsonb_build_object('success', false, 'code', 'ERR_COMMIT_FAILED', 'message', 'Failed to commit appointment row.');
  end if;

  insert into public.user_payment (
    amount, payment_date, method, status, user_id,
    reference_number, paymongo_payment_id, paymongo_payment_intent_id,
    appointment_id, clinic_id, payment_type
  ) values (
    p_amount, now(), p_method, 'processing', coalesce(p_user_id, v_appt.user_id),
    p_intent_id, p_intent_id, p_intent_id,
    p_appointment_id, p_clinic_id, 'appointment_consultation'
  )
  on conflict (paymongo_payment_id) do update set
    status = 'processing',
    appointment_id = excluded.appointment_id,
    updated_at = now();

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object(
    'success', true,
    'code', 'OK',
    'appointment_id', p_appointment_id,
    'payment_reference', p_intent_id,
    'checkout_status', 'committed'
  );
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.commit_checkout_intent from public, anon, authenticated;
grant execute on function public.commit_checkout_intent to service_role;

-- Step 7: Implement record_checkout_uncertain RPC
create or replace function public.record_checkout_uncertain(
  p_appointment_id uuid,
  p_claim_id text,
  p_attempt_id uuid,
  p_uncertain_reason text default 'gateway_timeout'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_rows integer;
  v_seq integer := 1;
begin
  if p_appointment_id is null or p_claim_id is null or p_attempt_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS', 'message', 'Missing required identifiers');
  end if;

  select appointment_id, checkout_claim_id, checkout_attempt_id,
         checkout_status, payment_status, payment_reference,
         checkout_idempotency_key, checkout_payment_method, checkout_payload_hash
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.checkout_status = 'committed' or v_appt.payment_reference is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ALREADY_COMMITTED',
      'message', 'Checkout attempt was already committed before uncertainty could be recorded.',
      'payment_reference', v_appt.payment_reference
    );
  end if;

  if v_appt.checkout_claim_id is distinct from p_claim_id or
     v_appt.checkout_attempt_id is distinct from p_attempt_id or
     v_appt.checkout_status <> 'in_flight' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_ATTEMPT_MISMATCH',
      'message', 'Cannot mark uncertain: attempt was lost, superseded, or not in flight.',
      'current_status', v_appt.checkout_status,
      'current_claim_id', v_appt.checkout_claim_id,
      'current_attempt_id', v_appt.checkout_attempt_id
    );
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  select coalesce(max(attempt_sequence), 0) + 1 into v_seq
  from public.checkout_attempt_log
  where attempt_id = p_attempt_id;

  insert into public.checkout_attempt_log (
    appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
    payment_method, payload_hash, event, status, reason
  ) values (
    p_appointment_id, p_attempt_id, v_seq, p_claim_id,
    coalesce(v_appt.checkout_idempotency_key, 'unknown'),
    coalesce(v_appt.checkout_payment_method, 'unknown'),
    coalesce(v_appt.checkout_payload_hash, 'unknown'),
    'gateway_timeout', 'uncertain', p_uncertain_reason
  );

  update public.patient_appointment
  set checkout_status = 'uncertain',
      checkout_uncertain_reason = p_uncertain_reason,
      checkout_uncertain_at = now()
  where appointment_id = p_appointment_id
    and checkout_claim_id = p_claim_id
    and checkout_attempt_id = p_attempt_id
    and checkout_status = 'in_flight';

  get diagnostics v_rows = row_count;

  perform set_config('app.internal_payment_context', '', true);

  if v_rows <> 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_UNCERTAIN_UPDATE_FAILED',
      'message', 'Conditional update affected zero rows; concurrent modification detected.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'code', 'OK',
    'appointment_id', p_appointment_id,
    'attempt_id', p_attempt_id,
    'status', 'uncertain'
  );
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.record_checkout_uncertain from public, anon, authenticated;
grant execute on function public.record_checkout_uncertain to service_role;

-- Step 8: Implement release_checkout_claim RPC (Strictly for Preflight Abort)
create or replace function public.release_checkout_claim(
  p_appointment_id uuid,
  p_claim_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_seq integer := 1;
begin
  if p_appointment_id is null or p_claim_id is null or trim(p_claim_id) = '' then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS', 'message', 'Appointment ID and claim ID are required.');
  end if;

  select appointment_id, checkout_claim_id, checkout_attempt_id, checkout_status,
         payment_reference, checkout_idempotency_key, checkout_payment_method, checkout_payload_hash
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.checkout_status = 'committed' or 
     (v_appt.payment_reference is not null and v_appt.payment_reference not in ('', 'NONE') and v_appt.payment_reference not like 'SIM-%') then
    return jsonb_build_object('success', false, 'code', 'ERR_ALREADY_COMMITTED', 'message', 'Cannot release claim on a committed checkout.');
  end if;

  if v_appt.checkout_claim_id is distinct from p_claim_id then
    return jsonb_build_object('success', false, 'code', 'ERR_CLAIM_MISMATCH', 'message', 'Caller does not own active claim lease.');
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  if v_appt.checkout_attempt_id is not null then
    select coalesce(max(attempt_sequence), 0) + 1 into v_seq
    from public.checkout_attempt_log
    where attempt_id = v_appt.checkout_attempt_id;

    insert into public.checkout_attempt_log (
      appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
      payment_method, payload_hash, event, status, reason
    ) values (
      p_appointment_id, v_appt.checkout_attempt_id, v_seq, p_claim_id,
      coalesce(v_appt.checkout_idempotency_key, 'preflight_none'),
      coalesce(v_appt.checkout_payment_method, 'unknown'),
      coalesce(v_appt.checkout_payload_hash, 'none'),
      'preflight_released', 'idle', 'Preflight validation abort or early client dismiss.'
    );
  end if;

  update public.patient_appointment
  set checkout_claim_id = null,
      checkout_claim_expires_at = null,
      checkout_status = 'idle',
      checkout_attempt_id = null,
      checkout_idempotency_key = null,
      checkout_payload_hash = null,
      checkout_payment_method = null
  where appointment_id = p_appointment_id
    and checkout_claim_id = p_claim_id;

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object('success', true, 'appointment_id', p_appointment_id);
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.release_checkout_claim from public, anon, authenticated;
grant execute on function public.release_checkout_claim to service_role;

-- Step 9: Implement cancel_checkout_attempt RPC
create or replace function public.cancel_checkout_attempt(
  p_appointment_id uuid,
  p_claim_id text,
  p_attempt_id uuid,
  p_gateway_confirmed_status text,
  p_reason text default 'user_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_seq integer := 1;
begin
  if p_appointment_id is null or p_claim_id is null or p_attempt_id is null or p_gateway_confirmed_status is null then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS', 'message', 'Missing required cancellation parameters.');
  end if;

  if p_gateway_confirmed_status not in ('cancelled', 'failed', 'not_created') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_GATEWAY_NOT_CANCELLED',
      'message', 'Gateway status ' || p_gateway_confirmed_status || ' does not establish definitive cancellation.'
    );
  end if;

  select appointment_id, checkout_claim_id, checkout_attempt_id, checkout_status, payment_reference,
         checkout_idempotency_key, checkout_payment_method, checkout_payload_hash
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.checkout_attempt_id is distinct from p_attempt_id or
     v_appt.checkout_claim_id is distinct from p_claim_id then
    return jsonb_build_object('success', false, 'code', 'ERR_ATTEMPT_MISMATCH', 'message', 'Claim or attempt ID mismatch.');
  end if;

  if v_appt.checkout_status = 'committed' then
    return jsonb_build_object('success', false, 'code', 'ERR_ALREADY_COMMITTED', 'message', 'Cannot cancel committed checkout via attempt cancellation.');
  end if;

  perform set_config('app.internal_payment_context', 'true', true);

  select coalesce(max(attempt_sequence), 0) + 1 into v_seq
  from public.checkout_attempt_log
  where attempt_id = p_attempt_id;

  insert into public.checkout_attempt_log (
    appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
    payment_method, payload_hash, event, status, reason
  ) values (
    p_appointment_id, p_attempt_id, v_seq, p_claim_id, v_appt.payment_reference,
    coalesce(v_appt.checkout_idempotency_key, 'unknown'),
    coalesce(v_appt.checkout_payment_method, 'unknown'),
    coalesce(v_appt.checkout_payload_hash, 'unknown'),
    'cancellation_confirmed', 'cancelled', p_reason || ' (gateway: ' || p_gateway_confirmed_status || ')'
  );

  update public.patient_appointment
  set checkout_status = 'cancelled',
      checkout_claim_id = null,
      checkout_claim_expires_at = null,
      checkout_idempotency_key = null,
      checkout_payload_hash = null,
      checkout_payment_method = null
  where appointment_id = p_appointment_id
    and checkout_attempt_id = p_attempt_id;

  perform set_config('app.internal_payment_context', '', true);

  return jsonb_build_object('success', true, 'code', 'OK', 'status', 'cancelled');
exception when others then
  perform set_config('app.internal_payment_context', '', true);
  raise;
end;
$$;

revoke all on function public.cancel_checkout_attempt from public, anon, authenticated;
grant execute on function public.cancel_checkout_attempt to service_role;

-- Step 10: Update trg_protect_appointment_payment_fields trigger to protect new checkout fields
create or replace function public.trg_protect_appointment_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx text;
begin
  v_ctx := current_setting('app.internal_payment_context', true);

  if v_ctx is null or v_ctx <> 'true' then
    if TG_OP = 'UPDATE' then
      if NEW.checkout_status is distinct from OLD.checkout_status or
         NEW.checkout_attempt_id is distinct from OLD.checkout_attempt_id or
         NEW.checkout_idempotency_key is distinct from OLD.checkout_idempotency_key or
         NEW.checkout_payload_hash is distinct from OLD.checkout_payload_hash or
         NEW.checkout_payment_method is distinct from OLD.checkout_payment_method or
         NEW.checkout_uncertain_reason is distinct from OLD.checkout_uncertain_reason or
         NEW.checkout_uncertain_at is distinct from OLD.checkout_uncertain_at then
        raise exception 'ERR_FORBIDDEN: Direct client modification of checkout state is prohibited.';
      end if;

      if NEW.payment_hold_expires_at is distinct from OLD.payment_hold_expires_at then
        raise exception 'ERR_FORBIDDEN: Direct modification of payment_hold_expires_at is prohibited.';
      end if;

      if NEW.checkout_claim_id is distinct from OLD.checkout_claim_id then
        raise exception 'ERR_FORBIDDEN: Direct modification of checkout_claim_id is prohibited.';
      end if;

      if NEW.checkout_claim_expires_at is distinct from OLD.checkout_claim_expires_at then
        raise exception 'ERR_FORBIDDEN: Direct modification of checkout_claim_expires_at is prohibited.';
      end if;

      -- Block untrusted client direct cancellation if active payment intent or processing payment exists
      if (NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled')
         or (NEW.payment_status = 'cancelled' and OLD.payment_status is distinct from 'cancelled') then
        if (OLD.payment_reference is not null and OLD.payment_reference not in ('', 'NONE') and OLD.payment_reference not like 'SIM-%')
           or exists (
             select 1 from public.user_payment up
             where up.appointment_id = OLD.appointment_id
               and up.status in ('processing', 'paid', 'succeeded', 'completed')
           ) then
          raise exception 'ERR_GATEWAY_CHECK_REQUIRED: Direct cancellation of appointment with active payment intent is prohibited. Safe server-side cancellation required.';
        end if;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

