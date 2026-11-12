-- =============================================================================
-- Migration: 20261112120000_main_paymongo_checkout_sync.sql
-- Target: DermAI MAIN Supabase Project (yxteeadjgavejpiriewj)
-- Purpose: Consolidated, additive PayMongo checkout/payment synchronization.
--
-- What this migration CHANGES:
--   1. Adds 9 checkout_* state-machine columns to public.patient_appointment,
--      backfills checkout_status only, sets NOT NULL, and adds
--      chk_patient_appointment_checkout_status.
--   2. Narrowly replaces user_payment_status_check on public.user_payment to allow
--      'processing' and 'cancelled' alongside MAIN's existing ('success', 'failed',
--      'pending', 'reconciliation_required') without touching existing rows or
--      any other constraints.
--   3. Adds scoped trigger function public.trg_protect_appointment_checkout_fields()
--      and trigger trg_appointment_protect_checkout_fields protecting only the
--      9 checkout_* columns without relying on app.internal_payment_context.
--   4. Adds append-only audit table public.checkout_attempt_log (service_role
--      SELECT/INSERT only).
--   5. Adds service_role-only checkout RPCs matching paymongo-payment/index.ts:
--      - public.claim_checkout_intent(uuid, text, text, text, integer)
--      - public.commit_checkout_intent(uuid, text, uuid, text, text, numeric, uuid, uuid)
--      - public.release_checkout_claim(uuid, text)
--   6. Adds public.payment_intent_orphan (nullable appointment_id with
--      ON DELETE SET NULL to preserve orphan/reconciliation audit history) and
--      service_role-only orphan RPCs:
--      - public.record_orphaned_intent(uuid, text, numeric, text, text, text)
--      - public.resolve_orphaned_intent(text, text, text)
--   7. Scopes trg_appointment_slot_guard and trg_doctor_cross_clinic_guard
--      trigger attachments via BEFORE INSERT OR UPDATE OF (10 identity/scheduling/payment
--      columns) so checkout-only updates avoid slot reaping / cross-clinic scans
--      while preserving their live MAIN trigger function bodies untouched.
--   8. Adds strict service_role-only 4-arg overload
--      public.cancel_appointment_hold(uuid, boolean, text default null, text default null)
--      (with NO default on p_gateway_verified): requires verified intent ownership
--      when p_gateway_verified = true, requires clean idle/no-ref/no-ledger state
--      when p_gateway_verified = false, delegates to MAIN's preserved 1-arg
--      cancel_appointment_hold(uuid), and atomically transitions ONLY the matching
--      pending/processing ledger row to verified 'cancelled'/'failed' + sets
--      checkout_status = 'cancelled' in the same transaction.
--
-- What this migration DELIBERATELY LEAVES UNTOUCHED:
--   - Live MAIN trigger function bodies: trg_appointment_slot_guard(),
--     prevent_doctor_cross_clinic_double_booking(), trg_protect_appointment_payment_fields(),
--     capture_doctor_unavailability_report(), guard_appointment_hold_availability(),
--     guard_appointment_schedule_block()
--   - public.fulfill_appointment_payment_atomic(text,text,uuid,uuid,numeric,text,text)
--   - public.cancel_appointment_hold(uuid) and its existing grants/authorization
--   - public.trg_protect_appointment_payment_fields() & trg_appointment_protect_payment
--   - public.trg_protect_booking_payment_ledger()
--   - Appointment status, doctor_status, doctor accept/decline, assignment,
--     24-hour doctor reselection, slot reservation, scheduling, and queue logic
--   - Existing payment_hold_expires_at (timestamptz) and partial unique index
--     idx_user_payment_paymongo_payment_id (WHERE paymongo_payment_id IS NOT NULL)
--   - Existing 96 'success' rows in public.user_payment (no updated_at column added)
--   - Email outbox tables/RPCs (omitted; absent on MAIN and non-blocking for payment)
--   - Unused checkout RPCs (record_checkout_uncertain, cancel_checkout_attempt)
-- =============================================================================

-- =============================================================================
-- PART 0A: OPTIONAL READ-ONLY PREFLIGHT QUERIES (Run manually before execution)
-- =============================================================================
/*
-- 1. Verify patient_appointment.payment_hold_expires_at exists as timestamptz
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patient_appointment'
  AND column_name IN ('payment_hold_expires_at', 'payment_status', 'payment_amount', 'payment_reference');

-- 2. Verify user_payment status distribution, check constraints, and partial unique index
SELECT status, count(*) FROM public.user_payment GROUP BY 1 ORDER BY 2 DESC;
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_payment'::regclass AND contype = 'c'
ORDER BY conname;
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'user_payment'
ORDER BY indexname;

-- 3. Confirm zero duplicate non-null paymongo_payment_id values
SELECT paymongo_payment_id, count(*)
FROM public.user_payment
WHERE paymongo_payment_id IS NOT NULL
GROUP BY 1
HAVING count(*) > 1;

-- 4. Confirm preserved MAIN functions exist before execution
SELECT p.oid::regprocedure AS signature, p.prosecdef, coalesce(p.proacl::text, 'DEFAULT') AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'cancel_appointment_hold',
    'fulfill_appointment_payment_atomic',
    'trg_protect_appointment_payment_fields',
    'trg_protect_booking_payment_ledger'
  )
ORDER BY p.proname, signature::text;
*/

begin;

-- =============================================================================
-- PART 0B: TRANSACTIONAL PREFLIGHT GUARD (Aborts cleanly without DDL if unsafe)
-- =============================================================================
do $$
declare
  v_dup_count integer;
  v_bad_status_count integer;
begin
  if to_regclass('public.patient_appointment') is null then
    raise exception 'PREFLIGHT_FAILED: public.patient_appointment does not exist.';
  end if;

  if to_regclass('public.user_payment') is null then
    raise exception 'PREFLIGHT_FAILED: public.user_payment does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patient_appointment'
      and column_name = 'payment_hold_expires_at'
      and udt_name = 'timestamptz'
  ) then
    raise exception 'PREFLIGHT_FAILED: public.patient_appointment.payment_hold_expires_at (timestamptz) is missing or has unexpected type.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'user_payment'
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'paymongo_payment_id'
      and pg_get_expr(i.indpred, i.indrelid) ilike '%paymongo_payment_id IS NOT NULL%'
  ) then
    raise exception 'PREFLIGHT_FAILED: Expected partial unique index on public.user_payment(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL not found.';
  end if;

  select count(*) into v_dup_count
  from (
    select paymongo_payment_id
    from public.user_payment
    where paymongo_payment_id is not null
    group by paymongo_payment_id
    having count(*) > 1
  ) d;

  if v_dup_count > 0 then
    raise exception 'PREFLIGHT_FAILED: Found % duplicate non-null paymongo_payment_id values in public.user_payment.', v_dup_count;
  end if;

  select count(*) into v_bad_status_count
  from public.user_payment
  where status is null
     or status not in ('success', 'failed', 'pending', 'processing', 'cancelled', 'reconciliation_required');

  if v_bad_status_count > 0 then
    raise exception 'PREFLIGHT_FAILED: Found % public.user_payment rows with unexpected status values.', v_bad_status_count;
  end if;

  if to_regprocedure('public.cancel_appointment_hold(uuid)') is null then
    raise exception 'PREFLIGHT_FAILED: Existing public.cancel_appointment_hold(uuid) not found on MAIN.';
  end if;

  if to_regprocedure('public.fulfill_appointment_payment_atomic(text,text,uuid,uuid,numeric,text,text)') is null then
    raise exception 'PREFLIGHT_FAILED: Existing public.fulfill_appointment_payment_atomic(text,text,uuid,uuid,numeric,text,text) not found on MAIN.';
  end if;

  if to_regprocedure('public.trg_appointment_slot_guard()') is null then
    raise exception 'PREFLIGHT_FAILED: Expected public.trg_appointment_slot_guard() not found on MAIN.';
  end if;

  if to_regprocedure('public.prevent_doctor_cross_clinic_double_booking()') is null then
    raise exception 'PREFLIGHT_FAILED: Expected public.prevent_doctor_cross_clinic_double_booking() not found on MAIN.';
  end if;

  -- Guard against silently accepting an incompatible pre-existing payment_intent_orphan
  -- table (e.g., NOT NULL appointment_id, ON DELETE CASCADE FK, or missing unique key).
  if to_regclass('public.payment_intent_orphan') is not null then
    if exists (
      select 1
      from unnest(array[
        'orphan_id', 'appointment_id', 'paymongo_payment_id', 'amount', 'currency',
        'status', 'cancellation_error', 'claim_id', 'idempotency_key',
        'created_at', 'updated_at', 'resolved_at'
      ]) as req(col_name)
      where not exists (
        select 1
        from information_schema.columns ic
        where ic.table_schema = 'public'
          and ic.table_name = 'payment_intent_orphan'
          and ic.column_name = req.col_name
      )
    ) then
      raise exception 'PREFLIGHT_FAILED: Pre-existing public.payment_intent_orphan is missing one or more required columns.';
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payment_intent_orphan'
        and column_name = 'appointment_id'
        and udt_name = 'uuid'
        and is_nullable = 'YES'
    ) then
      raise exception 'PREFLIGHT_FAILED: Pre-existing public.payment_intent_orphan.appointment_id must be nullable uuid (ON DELETE SET NULL).';
    end if;

    if exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.payment_intent_orphan'::regclass
        and con.contype = 'f'
        and con.confrelid = 'public.patient_appointment'::regclass
        and con.confdeltype <> 'n'
    ) or not exists (
      select 1
      from pg_constraint con
      join pg_attribute a
        on a.attrelid = con.conrelid
       and a.attnum = con.conkey[1]
      where con.conrelid = 'public.payment_intent_orphan'::regclass
        and con.contype = 'f'
        and con.confrelid = 'public.patient_appointment'::regclass
        and array_length(con.conkey, 1) = 1
        and a.attname = 'appointment_id'
        and con.confdeltype = 'n'
    ) then
      raise exception 'PREFLIGHT_FAILED: Pre-existing public.payment_intent_orphan FK to patient_appointment must use ON DELETE SET NULL (not CASCADE).';
    end if;

    if not exists (
      select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid
       and a.attnum = i.indkey[0]
      where i.indrelid = 'public.payment_intent_orphan'::regclass
        and i.indisunique
        and i.indpred is null
        and i.indnatts = 1
        and a.attname = 'paymongo_payment_id'
    ) then
      raise exception 'PREFLIGHT_FAILED: Pre-existing public.payment_intent_orphan lacks required unique index/constraint on paymongo_payment_id.';
    end if;
  end if;
end $$;


-- =============================================================================
-- SECTION 1: Additive checkout_* columns, backfill, and CHECK on patient_appointment
-- =============================================================================

alter table public.patient_appointment
  add column if not exists checkout_status text default 'idle',
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_payment_method text,
  add column if not exists checkout_payload_hash text,
  add column if not exists checkout_uncertain_reason text,
  add column if not exists checkout_uncertain_at timestamptz,
  add column if not exists checkout_claim_id text,
  add column if not exists checkout_claim_expires_at timestamptz,
  add column if not exists checkout_idempotency_key text;

-- Scope trg_appointment_slot_guard & trg_doctor_cross_clinic_guard trigger
-- attachments BEFORE running backfill so checkout-only updates (both here and
-- at runtime in claim/commit/release/cancel checkout sync) do not invoke slot
-- reaping or cross-clinic conflict scans, while leaving both live MAIN trigger
-- functions, their security settings, search_path, and enabled state intact.

do $$
declare
  v_slot_enabled "char";
  v_cross_enabled "char";
begin
  select tgenabled into v_slot_enabled
  from pg_trigger
  where tgrelid = 'public.patient_appointment'::regclass
    and tgname = 'trg_appointment_slot_guard'
    and not tgisinternal;

  if v_slot_enabled is not null then
    drop trigger if exists trg_appointment_slot_guard on public.patient_appointment;

    create trigger trg_appointment_slot_guard
      before insert or update of
        appointment_id,
        clinic_id,
        assigned_doctor_id,
        "date",
        "time",
        batch_time,
        status,
        doctor_status,
        payment_status,
        payment_hold_expires_at
      on public.patient_appointment
      for each row
      execute function public.trg_appointment_slot_guard();

    if v_slot_enabled = 'D' then
      alter table public.patient_appointment
        disable trigger trg_appointment_slot_guard;
    end if;
  end if;

  select tgenabled into v_cross_enabled
  from pg_trigger
  where tgrelid = 'public.patient_appointment'::regclass
    and tgname = 'trg_doctor_cross_clinic_guard'
    and not tgisinternal;

  if v_cross_enabled is not null then
    drop trigger if exists trg_doctor_cross_clinic_guard on public.patient_appointment;

    create trigger trg_doctor_cross_clinic_guard
      before insert or update of
        appointment_id,
        clinic_id,
        assigned_doctor_id,
        "date",
        "time",
        batch_time,
        status,
        doctor_status,
        payment_status,
        payment_hold_expires_at
      on public.patient_appointment
      for each row
      execute function public.prevent_doctor_cross_clinic_double_booking();

    if v_cross_enabled = 'D' then
      alter table public.patient_appointment
        disable trigger trg_doctor_cross_clinic_guard;
    end if;
  end if;
end $$;

-- Backfill checkout state.
-- A paid appointment is committed.
-- Cancellation/expiration/rejection takes priority over generic references.
-- HOLD-* references are reservation identifiers, not payment evidence.
-- SIM-* references are excluded from committed classification.

update public.patient_appointment
set checkout_status = case
  when payment_status = 'paid' then 'committed'

  when payment_status in ('cancelled', 'expired')
       or status in ('cancelled', 'rejected') then 'cancelled'

  when payment_reference is not null
       and payment_reference not in ('', 'NONE')
       and payment_reference not like 'SIM-%'
       and upper(payment_reference) not like 'HOLD-%' then 'committed'

  else 'idle'
end
where (checkout_status is null or checkout_status = 'idle')
  and (
    checkout_status is null
    or payment_status = 'paid'
    or (
      payment_reference is not null
      and payment_reference not in ('', 'NONE')
      and payment_reference not like 'SIM-%'
      and upper(payment_reference) not like 'HOLD-%'
    )
    or payment_status in ('cancelled', 'expired')
    or status in ('cancelled', 'rejected')
  );

alter table public.patient_appointment
  alter column checkout_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_patient_appointment_checkout_status'
      and conrelid = 'public.patient_appointment'::regclass
  ) then
    alter table public.patient_appointment
      add constraint chk_patient_appointment_checkout_status
      check (
        checkout_status in (
          'idle',
          'in_flight',
          'uncertain',
          'committed',
          'cancelled',
          'reconciliation_required'
        )
      );
  end if;
end $$;


-- =============================================================================
-- SECTION 2: Narrow replacement of user_payment_status_check ONLY
--            Preserves all 96 'success' records and all unrelated constraints.
--            Does NOT add updated_at or modify existing unique indexes.
-- =============================================================================
alter table public.user_payment
  drop constraint if exists user_payment_status_check;

alter table public.user_payment
  add constraint user_payment_status_check
  check (status in ('success', 'failed', 'pending', 'processing', 'cancelled', 'reconciliation_required'))
  not valid;

alter table public.user_payment
  validate constraint user_payment_status_check;

-- =============================================================================
-- SECTION 3: Scoped Checkout Column Protection Trigger
--            Leaves trg_appointment_protect_payment & trg_protect_appointment_payment_fields
--            completely untouched. Does NOT honor app.internal_payment_context.
-- =============================================================================
create or replace function public.trg_protect_appointment_checkout_fields()
returns trigger
language plpgsql
-- Intentionally SECURITY INVOKER so current_user reflects active role even under SET LOCAL ROLE
set search_path = public
as $$
declare
  v_is_service_role boolean;
  v_is_dba_session boolean;
begin
  -- Authentic PostgREST service_role JWT
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  if v_is_service_role then
    return NEW;
  end if;

  -- Direct DBA / maintenance SQL session (never PostgREST authenticator, never SET LOCAL ROLE)
  v_is_dba_session := (
    current_user in ('postgres', 'supabase_admin')
    and session_user in ('postgres', 'supabase_admin')
    and nullif(current_setting('request.jwt.claim.role', true), '') is null
  );
  if v_is_dba_session then
    return NEW;
  end if;

  -- Deliberately ignores app.internal_payment_context and is_admin() so client or
  -- authenticated-RPC sessions cannot bypass checkout_* immutability guarantees.

  if TG_OP = 'INSERT' then
    if NEW.checkout_status is null then
      NEW.checkout_status := 'idle';
    elsif NEW.checkout_status <> 'idle' then
      raise exception 'ERR_FORBIDDEN: Direct initialization of checkout_status to % is prohibited.', NEW.checkout_status;
    end if;

    if NEW.checkout_claim_id is not null or
       NEW.checkout_claim_expires_at is not null or
       NEW.checkout_attempt_id is not null or
       NEW.checkout_idempotency_key is not null or
       NEW.checkout_payload_hash is not null or
       NEW.checkout_payment_method is not null or
       NEW.checkout_uncertain_reason is not null or
       NEW.checkout_uncertain_at is not null then
      raise exception 'ERR_FORBIDDEN: Direct initialization of checkout state machine fields is prohibited.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.checkout_status is distinct from OLD.checkout_status or
       NEW.checkout_claim_id is distinct from OLD.checkout_claim_id or
       NEW.checkout_claim_expires_at is distinct from OLD.checkout_claim_expires_at or
       NEW.checkout_attempt_id is distinct from OLD.checkout_attempt_id or
       NEW.checkout_idempotency_key is distinct from OLD.checkout_idempotency_key or
       NEW.checkout_payload_hash is distinct from OLD.checkout_payload_hash or
       NEW.checkout_payment_method is distinct from OLD.checkout_payment_method or
       NEW.checkout_uncertain_reason is distinct from OLD.checkout_uncertain_reason or
       NEW.checkout_uncertain_at is distinct from OLD.checkout_uncertain_at then
      raise exception 'ERR_FORBIDDEN: Direct client modification of checkout state is prohibited.';
    end if;
  end if;

  return NEW;
end;
$$;

revoke all on function public.trg_protect_appointment_checkout_fields() from public, anon, authenticated;

drop trigger if exists trg_appointment_protect_checkout_fields on public.patient_appointment;
create trigger trg_appointment_protect_checkout_fields
before insert or update on public.patient_appointment
for each row
execute function public.trg_protect_appointment_checkout_fields();

-- =============================================================================
-- SECTION 4: Append-only public.checkout_attempt_log audit table & RLS
-- =============================================================================
create table if not exists public.checkout_attempt_log (
  log_id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  attempt_id uuid not null,
  attempt_sequence integer not null default 1,
  claim_id text,
  intent_id text,
  idempotency_key text not null,
  payment_method text not null,
  payload_hash text not null,
  event text not null,
  status text not null,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_checkout_attempt_log_appt on public.checkout_attempt_log(appointment_id);
create index if not exists idx_checkout_attempt_log_attempt on public.checkout_attempt_log(attempt_id);
create index if not exists idx_checkout_attempt_log_key on public.checkout_attempt_log(idempotency_key);
create index if not exists idx_checkout_attempt_log_intent on public.checkout_attempt_log(intent_id) where intent_id is not null;

alter table public.checkout_attempt_log enable row level security;
revoke all on table public.checkout_attempt_log from public, anon, authenticated;
grant select, insert on table public.checkout_attempt_log to service_role;
revoke update, delete, truncate, references, trigger on table public.checkout_attempt_log from service_role;

drop policy if exists "checkout_attempt_log_service_role_select" on public.checkout_attempt_log;
create policy "checkout_attempt_log_service_role_select"
  on public.checkout_attempt_log
  for select
  to service_role
  using (true);

drop policy if exists "checkout_attempt_log_service_role_insert" on public.checkout_attempt_log;
create policy "checkout_attempt_log_service_role_insert"
  on public.checkout_attempt_log
  for insert
  to service_role
  with check (true);

-- =============================================================================
-- SECTION 5: public.claim_checkout_intent(uuid, text, text, text, integer)
--            Matches 5-arg call in supabase/functions/paymongo-payment/index.ts.
-- =============================================================================
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
  v_has_committed_intent boolean := false;
  v_prior_pay_status text;
  v_event_name text;
  v_next_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Checkout claim requires service_role authorization.'
    );
  end if;

  if p_appointment_id is null
     or p_claim_id is null or trim(p_claim_id) = ''
     or p_payment_method is null or trim(p_payment_method) = ''
     or p_payload_hash is null or trim(p_payload_hash) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID, claim ID, payment method, and payload hash are required.'
    );
  end if;

  v_lease := (greatest(coalesce(p_lease_seconds, 60), 5) || ' seconds')::interval;
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

  -- Explicitly block exempt appointments from entering checkout without changing appointment state
  if v_appt.payment_status = 'exempt' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_EXEMPT',
      'message', 'Appointment is payment-exempt and does not require checkout.'
    );
  end if;

  if v_appt.payment_status in ('cancelled', 'expired')
     or v_appt.status in ('cancelled', 'rejected', 'completed')
     or (v_appt.payment_hold_expires_at is not null and v_appt.payment_hold_expires_at <= v_now) then
    return jsonb_build_object('success', false, 'code', 'ERR_HOLD_EXPIRED', 'message', 'Reservation hold has expired or was cancelled.');
  end if;

  if v_appt.checkout_status = 'reconciliation_required' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_CHECKOUT_COMMITTED',
      'message', 'Checkout is pending administrative reconciliation.',
      'payment_reference', v_appt.payment_reference
    );
  end if;

  -- Active lease mutex & same-claim re-entry
  if v_appt.checkout_claim_id is not null
     and v_appt.checkout_claim_expires_at is not null
     and v_appt.checkout_claim_expires_at > v_now then
    if v_appt.checkout_claim_id = p_claim_id then
      select coalesce(max(attempt_sequence), 0) + 1 into v_seq
      from public.checkout_attempt_log
      where attempt_id = v_appt.checkout_attempt_id;

      insert into public.checkout_attempt_log (
        appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
        payment_method, payload_hash, event, status, reason
      ) values (
        p_appointment_id, v_appt.checkout_attempt_id, v_seq, p_claim_id, v_appt.payment_reference,
        coalesce(v_appt.checkout_idempotency_key, 'dermai_appt_' || p_appointment_id::text),
        p_payment_method, p_payload_hash,
        'reentry_renewed', v_appt.checkout_status, 'Active lease renewed by same claim holder.'
      );

      update public.patient_appointment
      set checkout_claim_expires_at = v_expires_at
      where appointment_id = p_appointment_id;

      return jsonb_build_object(
        'success', true,
        'code', 'OK',
        'appointment_id', p_appointment_id,
        'user_id', v_appt.user_id,
        'clinic_id', v_appt.clinic_id,
        'payment_amount', v_appt.payment_amount,
        'payment_status', v_appt.payment_status,
        'payment_reference', v_appt.payment_reference,
        'claim_id', p_claim_id,
        'attempt_id', v_appt.checkout_attempt_id,
        'idempotency_key', v_appt.checkout_idempotency_key,
        'checkout_idempotency_key', v_appt.checkout_idempotency_key,
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

  -- Crash recovery for expired in_flight lease
  if v_appt.checkout_status = 'in_flight'
     and (v_appt.checkout_claim_expires_at is null or v_appt.checkout_claim_expires_at <= v_now) then
    select coalesce(max(attempt_sequence), 0) + 1 into v_seq
    from public.checkout_attempt_log
    where attempt_id = v_appt.checkout_attempt_id;

    insert into public.checkout_attempt_log (
      appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
      payment_method, payload_hash, event, status, reason
    ) values (
      p_appointment_id, coalesce(v_appt.checkout_attempt_id, gen_random_uuid()), v_seq, v_appt.checkout_claim_id,
      coalesce(v_appt.checkout_idempotency_key, 'unknown'),
      coalesce(v_appt.checkout_payment_method, p_payment_method),
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

  v_has_committed_intent := (
    v_appt.checkout_status = 'committed'
    or (v_appt.payment_reference is not null
        and v_appt.payment_reference not in ('', 'NONE')
        and v_appt.payment_reference not like 'SIM-%'
        and upper(v_appt.payment_reference) not like 'HOLD-%')
  );

  -- Committed-intent re-entry: allows exclusive verification/reuse or recovery after gateway failure/cancellation
  if v_has_committed_intent then
    if v_appt.checkout_payment_method is not null and v_appt.checkout_payment_method <> p_payment_method then
      select status into v_prior_pay_status
      from public.user_payment
      where (paymongo_payment_id = v_appt.payment_reference
             or paymongo_payment_intent_id = v_appt.payment_reference)
        and (appointment_id is null or appointment_id = p_appointment_id)
      order by
        case when status in ('success', 'reconciliation_required') then 0 else 1 end,
        created_at desc
      limit 1;

      if coalesce(v_prior_pay_status, '') not in ('failed', 'cancelled') then
        return jsonb_build_object(
          'success', false,
          'code', 'ERR_METHOD_SWITCH_BLOCKED',
          'message', 'Cannot switch payment methods while a payment intent is still unresolved. Complete checkout, retry with the original method, or cancel first.',
          'pending_method', v_appt.checkout_payment_method,
          'payment_reference', v_appt.payment_reference
        );
      end if;
    end if;

    if v_appt.checkout_payload_hash is not null
       and (v_appt.checkout_payment_method is null or v_appt.checkout_payment_method = p_payment_method)
       and v_appt.checkout_payload_hash <> p_payload_hash then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_PAYLOAD_MISMATCH',
        'message', 'Payload parameters do not match the committed checkout attempt.',
        'attempt_id', v_appt.checkout_attempt_id
      );
    end if;

    v_attempt_id := coalesce(v_appt.checkout_attempt_id, gen_random_uuid());
    v_idempotency_key := coalesce(
      v_appt.checkout_idempotency_key,
      'dermai_appt_' || replace(p_appointment_id::text, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)
    );
    v_event_name := 'committed_reentry';
    v_next_status := 'committed';

  -- Uncertain attempt recovery within 24h gateway idempotency window
  elsif v_appt.checkout_status = 'uncertain' then
    if v_appt.checkout_uncertain_at is not null and (v_now - v_appt.checkout_uncertain_at) > interval '24 hours' then
      select coalesce(max(attempt_sequence), 0) + 1 into v_seq
      from public.checkout_attempt_log
      where attempt_id = v_appt.checkout_attempt_id;

      insert into public.checkout_attempt_log (
        appointment_id, attempt_id, attempt_sequence, claim_id, idempotency_key,
        payment_method, payload_hash, event, status, reason
      ) values (
        p_appointment_id, coalesce(v_appt.checkout_attempt_id, gen_random_uuid()), v_seq, p_claim_id,
        coalesce(v_appt.checkout_idempotency_key, 'unknown'), p_payment_method, p_payload_hash,
        'retention_expired', 'reconciliation_required', 'Attempt exceeded 24-hour gateway cache window.'
      );

      update public.patient_appointment
      set checkout_status = 'reconciliation_required'
      where appointment_id = p_appointment_id;

      return jsonb_build_object(
        'success', false,
        'code', 'ERR_IDEMPOTENCY_EXPIRED',
        'message', 'Checkout attempt exceeded the 24-hour gateway idempotency retention window and cannot be safely replayed. Please cancel this reservation or contact clinic support.',
        'uncertain_at', v_appt.checkout_uncertain_at
      );
    end if;

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

    if v_appt.checkout_payload_hash is not null and v_appt.checkout_payload_hash <> p_payload_hash then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_PAYLOAD_MISMATCH',
        'message', 'Payload parameters do not match the pending uncertain attempt.',
        'attempt_id', v_appt.checkout_attempt_id
      );
    end if;

    v_attempt_id := coalesce(v_appt.checkout_attempt_id, gen_random_uuid());
    v_idempotency_key := coalesce(
      v_appt.checkout_idempotency_key,
      'dermai_appt_' || replace(p_appointment_id::text, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)
    );
    v_event_name := 'retry_replayed';
    v_next_status := 'in_flight';

  -- Fresh attempt from idle / cancelled
  else
    v_attempt_id := gen_random_uuid();
    v_idempotency_key := 'dermai_appt_' || replace(p_appointment_id::text, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    v_event_name := 'claim_acquired';
    v_next_status := 'in_flight';
  end if;

  select coalesce(max(attempt_sequence), 0) + 1 into v_seq
  from public.checkout_attempt_log
  where attempt_id = v_attempt_id;

  insert into public.checkout_attempt_log (
    appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
    payment_method, payload_hash, event, status, reason
  ) values (
    p_appointment_id, v_attempt_id, v_seq, p_claim_id,
    case when v_has_committed_intent then v_appt.payment_reference else null end,
    v_idempotency_key, p_payment_method, p_payload_hash,
    v_event_name, v_next_status, 'Lease acquired for checkout intent processing.'
  );

  update public.patient_appointment
  set checkout_claim_id = p_claim_id,
      checkout_attempt_id = v_attempt_id,
      checkout_status = v_next_status,
      checkout_claim_expires_at = v_expires_at,
      checkout_idempotency_key = v_idempotency_key,
      checkout_payment_method = case
        when v_has_committed_intent and coalesce(v_prior_pay_status, '') not in ('failed', 'cancelled')
          then coalesce(v_appt.checkout_payment_method, p_payment_method)
        else p_payment_method
      end,
      checkout_payload_hash = case
        when v_has_committed_intent and coalesce(v_prior_pay_status, '') not in ('failed', 'cancelled')
          then coalesce(v_appt.checkout_payload_hash, p_payload_hash)
        else p_payload_hash
      end
  where appointment_id = p_appointment_id;

  return jsonb_build_object(
    'success', true,
    'code', 'OK',
    'appointment_id', p_appointment_id,
    'user_id', v_appt.user_id,
    'clinic_id', v_appt.clinic_id,
    'payment_amount', v_appt.payment_amount,
    'payment_status', v_appt.payment_status,
    'payment_reference', v_appt.payment_reference,
    'claim_id', p_claim_id,
    'attempt_id', v_attempt_id,
    'idempotency_key', v_idempotency_key,
    'checkout_idempotency_key', v_idempotency_key,
    'claim_expires_at', v_expires_at,
    'is_retry', (v_appt.checkout_status = 'uncertain' or v_has_committed_intent)
  );
end;
$$;

revoke all on function public.claim_checkout_intent(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_checkout_intent(uuid, text, text, text, integer) to service_role;

-- =============================================================================
-- SECTION 6: public.commit_checkout_intent(uuid, text, uuid, text, text, numeric, uuid, uuid)
--            - Validates expected fee & ownership before any writes
--            - Prevents duplicate user_payment rows via paymongo_payment_intent_id
--            - Reuses matching owned 'processing' / NULL-payment_id rows safely
--            - Matches MAIN's idx_user_payment_paymongo_payment_id partial index
--            - Never references updated_at; preserves 'success' & 'reconciliation_required'
--            - Rolls back ALL writes on any integrity failure
-- =============================================================================
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
  v_pay_rec record;
  v_target_user_id uuid;
  v_target_clinic_id uuid;
  v_match_count integer := 0;
  v_matched_pay_id uuid := null;
  v_matched_paymongo_payment_id text := null;
  v_matched_status text := null;
  v_matched_appt_id uuid := null;
  v_prior_ref_status text;
  v_rows integer := 0;
  v_pay_rows integer := 0;
  v_seq integer := 1;
  v_err_msg text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Checkout commit requires service_role authorization.'
    );
  end if;

  if p_appointment_id is null
     or p_claim_id is null or trim(p_claim_id) = ''
     or p_attempt_id is null
     or p_intent_id is null or trim(p_intent_id) = ''
     or p_method is null or trim(p_method) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Appointment ID, claim ID, attempt ID, intent ID, and payment method are required.'
    );
  end if;

  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <= 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_AMOUNT',
      'message', 'Payment amount must be strictly greater than zero.'
    );
  end if;

  select appointment_id, user_id, clinic_id, payment_amount, payment_status, status,
         payment_reference, checkout_claim_id, checkout_attempt_id, checkout_status,
         checkout_claim_expires_at, checkout_idempotency_key, checkout_payload_hash
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

  if v_appt.payment_status = 'exempt' then
    return jsonb_build_object('success', false, 'code', 'ERR_PAYMENT_EXEMPT', 'message', 'Appointment is payment-exempt and cannot commit payment.');
  end if;

  if v_appt.payment_status in ('cancelled', 'expired')
     or v_appt.status in ('cancelled', 'rejected', 'completed') then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_STATE', 'message', 'Appointment is cancelled, expired, rejected, or completed.');
  end if;

  if v_appt.checkout_status = 'reconciliation_required' then
    return jsonb_build_object('success', false, 'code', 'ERR_RECONCILIATION_REQUIRED', 'message', 'Checkout is pending administrative reconciliation.');
  end if;

  if v_appt.checkout_status not in ('in_flight', 'committed') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_CHECKOUT_STATE',
      'message', 'Checkout state must be in_flight or committed before intent commit.'
    );
  end if;

  if v_appt.checkout_claim_id is distinct from p_claim_id
     or v_appt.checkout_attempt_id is distinct from p_attempt_id
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

  if v_appt.payment_amount is null
     or v_appt.payment_amount <= 0
     or round(p_amount, 2) <> round(v_appt.payment_amount, 2) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_AMOUNT_MISMATCH',
      'message', 'Supplied payment amount does not match the appointment expected fee.',
      'expected_amount', v_appt.payment_amount,
      'supplied_amount', p_amount
    );
  end if;

  v_target_user_id := coalesce(p_user_id, v_appt.user_id);
  v_target_clinic_id := coalesce(p_clinic_id, v_appt.clinic_id);

  if v_appt.user_id is not null and p_user_id is not null and v_appt.user_id <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Checkout user does not match appointment owner.'
    );
  end if;

  if v_appt.clinic_id is not null and p_clinic_id is not null and v_appt.clinic_id <> p_clinic_id then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Checkout clinic does not match appointment clinic.'
    );
  end if;

  if v_appt.payment_reference is not null
     and v_appt.payment_reference like 'pi_%'
     and v_appt.payment_reference <> p_intent_id then
    select status into v_prior_ref_status
    from public.user_payment
    where (paymongo_payment_id = v_appt.payment_reference
           or paymongo_payment_intent_id = v_appt.payment_reference)
      and (appointment_id is null or appointment_id = p_appointment_id)
    order by
      case when status in ('success', 'reconciliation_required') then 0 else 1 end,
      created_at desc
    limit 1;

    if coalesce(v_prior_ref_status, 'processing') not in ('failed', 'cancelled') then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTENT_CONFLICT',
        'message', 'Existing active payment intent must be confirmed failed or cancelled before committing a new intent.'
      );
    end if;
  end if;

  if exists (
    select 1 from public.patient_appointment
    where payment_reference = p_intent_id
      and appointment_id <> p_appointment_id
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Payment intent is already linked to another appointment.'
    );
  end if;

  -- Serialize commits referencing the same p_intent_id across appointments because
  -- user_payment.paymongo_payment_intent_id does not have its own unique index on MAIN.
  perform pg_advisory_xact_lock(hashtext('user_payment_intent:' || p_intent_id));

  for v_pay_rec in
    select payment_id, appointment_id, user_id, clinic_id, status,
           paymongo_payment_id, paymongo_payment_intent_id
    from public.user_payment
    where paymongo_payment_id = p_intent_id
       or paymongo_payment_intent_id = p_intent_id
    order by payment_id
    for update
  loop
    v_match_count := v_match_count + 1;

    if v_pay_rec.appointment_id is not null and v_pay_rec.appointment_id <> p_appointment_id then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTEGRITY_MISMATCH',
        'message', 'Payment reference already belongs to a different appointment.'
      );
    end if;

    if v_target_user_id is not null and v_pay_rec.user_id is not null and v_pay_rec.user_id <> v_target_user_id then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTEGRITY_MISMATCH',
        'message', 'Payment reference already belongs to a different user.'
      );
    end if;

    if v_target_clinic_id is not null and v_pay_rec.clinic_id is not null and v_pay_rec.clinic_id <> v_target_clinic_id then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTEGRITY_MISMATCH',
        'message', 'Payment reference already belongs to a different clinic.'
      );
    end if;

    if v_pay_rec.status = 'success' then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_ALREADY_PAID',
        'message', 'Payment intent has already been fulfilled as successful.'
      );
    end if;

    if v_pay_rec.status = 'reconciliation_required' then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_RECONCILIATION_REQUIRED',
        'message', 'Payment ledger record requires administrative reconciliation and cannot be modified.'
      );
    end if;

    v_matched_pay_id := v_pay_rec.payment_id;
    v_matched_paymongo_payment_id := v_pay_rec.paymongo_payment_id;
    v_matched_status := v_pay_rec.status;
    v_matched_appt_id := v_pay_rec.appointment_id;
  end loop;

  if v_match_count > 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTENT_CONFLICT',
      'message', 'Multiple payment ledger rows already exist for this PaymentIntent ID.'
    );
  end if;

  -- Reject if an existing non-processing row matched via paymongo_payment_intent_id
  -- already carries a different non-null paymongo_payment_id (e.g. a real pay_* ID),
  -- while allowing safe in-place reuse of an owned 'processing' or NULL-payment_id row.
  if v_matched_pay_id is not null
     and v_matched_paymongo_payment_id is not null
     and v_matched_paymongo_payment_id <> p_intent_id
     and not (
       v_matched_status = 'processing'
       and v_matched_appt_id = p_appointment_id
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTENT_CONFLICT',
      'message', 'An existing payment ledger record with a different paymongo_payment_id already references this PaymentIntent.'
    );
  end if;

  -- Atomic subtransaction: any write failure rolls back patient_appointment, user_payment, and checkout_attempt_log
  begin
    update public.patient_appointment
    set payment_reference = p_intent_id,
        checkout_status = 'committed',
        checkout_claim_id = null,
        checkout_claim_expires_at = null,
        checkout_uncertain_at = null,
        checkout_uncertain_reason = null
    where appointment_id = p_appointment_id
      and checkout_claim_id = p_claim_id
      and checkout_attempt_id = p_attempt_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'ERR_COMMIT_FAILED: Failed to lock and commit appointment row.';
    end if;

    if v_matched_pay_id is not null then
      -- Reuse matching owned row directly without inserting a duplicate ledger row
      update public.user_payment
      set status = 'processing',
          paymongo_payment_id = coalesce(paymongo_payment_id, p_intent_id),
          paymongo_payment_intent_id = coalesce(paymongo_payment_intent_id, p_intent_id),
          reference_number = coalesce(reference_number, coalesce(paymongo_payment_id, p_intent_id)),
          appointment_id = coalesce(appointment_id, p_appointment_id),
          user_id = coalesce(user_id, v_target_user_id),
          clinic_id = coalesce(clinic_id, v_target_clinic_id)
      where payment_id = v_matched_pay_id
        and (appointment_id is null or appointment_id = p_appointment_id)
        and (user_id is null or v_target_user_id is null or user_id = v_target_user_id)
        and (clinic_id is null or v_target_clinic_id is null or clinic_id = v_target_clinic_id)
        and status not in ('success', 'reconciliation_required');

      get diagnostics v_pay_rows = row_count;
    else
      -- Matches MAIN's existing idx_user_payment_paymongo_payment_id partial index directly
      insert into public.user_payment (
        amount, payment_date, method, status, user_id,
        reference_number, paymongo_payment_id, paymongo_payment_intent_id,
        appointment_id, clinic_id, payment_type
      ) values (
        round(p_amount, 2), now(), p_method, 'processing', v_target_user_id,
        p_intent_id, p_intent_id, p_intent_id,
        p_appointment_id, v_target_clinic_id, 'appointment_consultation'
      )
      on conflict (paymongo_payment_id) where paymongo_payment_id is not null do update set
        status = case
          when public.user_payment.status in ('success', 'reconciliation_required')
            then public.user_payment.status
          else 'processing'
        end,
        paymongo_payment_intent_id = coalesce(public.user_payment.paymongo_payment_intent_id, excluded.paymongo_payment_intent_id),
        appointment_id = coalesce(public.user_payment.appointment_id, excluded.appointment_id),
        user_id = coalesce(public.user_payment.user_id, excluded.user_id),
        clinic_id = coalesce(public.user_payment.clinic_id, excluded.clinic_id)
      where (public.user_payment.appointment_id is null or public.user_payment.appointment_id = excluded.appointment_id)
        and (public.user_payment.user_id is null or excluded.user_id is null or public.user_payment.user_id = excluded.user_id)
        and (public.user_payment.clinic_id is null or excluded.clinic_id is null or public.user_payment.clinic_id = excluded.clinic_id)
        and public.user_payment.status not in ('success', 'reconciliation_required');

      get diagnostics v_pay_rows = row_count;
    end if;

    if v_pay_rows <> 1 then
      raise exception 'ERR_INTEGRITY_MISMATCH: Payment reference ownership or terminal-status conflict during ledger upsert.';
    end if;

    select coalesce(max(attempt_sequence), 0) + 1 into v_seq
    from public.checkout_attempt_log
    where attempt_id = p_attempt_id;

    insert into public.checkout_attempt_log (
      appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
      payment_method, payload_hash, event, status, reason
    ) values (
      p_appointment_id, p_attempt_id, v_seq, p_claim_id, p_intent_id,
      coalesce(v_appt.checkout_idempotency_key, 'unknown'),
      p_method,
      coalesce(v_appt.checkout_payload_hash, 'unknown'),
      'intent_committed', 'committed', 'Payment intent committed and tracked successfully.'
    );
  exception when others then
    get stacked diagnostics v_err_msg = message_text;
    -- All DML inside the subtransaction block above is automatically rolled back
    return jsonb_build_object(
      'success', false,
      'code', case
        when v_err_msg like 'ERR_COMMIT_FAILED%' then 'ERR_COMMIT_FAILED'
        else 'ERR_INTEGRITY_MISMATCH'
      end,
      'message', v_err_msg
    );
  end;

  return jsonb_build_object(
    'success', true,
    'code', 'OK',
    'appointment_id', p_appointment_id,
    'payment_reference', p_intent_id,
    'checkout_status', 'committed'
  );
end;
$$;

revoke all on function public.commit_checkout_intent(uuid, text, uuid, text, text, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_checkout_intent(uuid, text, uuid, text, text, numeric, uuid, uuid) to service_role;

-- =============================================================================
-- SECTION 7: public.release_checkout_claim(uuid, text)
--            Never resets 'uncertain', 'committed', or 'reconciliation_required'
--            attempts to 'idle' or erases idempotency/attempt/payload metadata.
-- =============================================================================
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
  v_is_reconciliation boolean := false;
  v_has_committed_intent boolean := false;
  v_is_uncertain boolean := false;
  v_target_status text;
  v_log_event text;
  v_log_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Checkout claim release requires service_role authorization.'
    );
  end if;

  if p_appointment_id is null or p_claim_id is null or trim(p_claim_id) = '' then
    return jsonb_build_object('success', false, 'code', 'ERR_INVALID_PARAMS', 'message', 'Appointment ID and claim ID are required.');
  end if;

  select appointment_id, checkout_claim_id, checkout_attempt_id, checkout_status,
         checkout_uncertain_at, checkout_uncertain_reason, payment_reference,
         checkout_idempotency_key, checkout_payment_method, checkout_payload_hash
  into v_appt
  from public.patient_appointment
  where appointment_id = p_appointment_id
  for update;

  if v_appt.appointment_id is null then
    return jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Appointment not found.');
  end if;

  if v_appt.checkout_claim_id is distinct from p_claim_id then
    return jsonb_build_object('success', false, 'code', 'ERR_CLAIM_MISMATCH', 'message', 'Caller does not own active claim lease.');
  end if;

  v_is_reconciliation := (v_appt.checkout_status = 'reconciliation_required');

  v_has_committed_intent := (
    v_appt.checkout_status = 'committed'
    or (v_appt.payment_reference is not null
        and v_appt.payment_reference not in ('', 'NONE')
        and v_appt.payment_reference not like 'SIM-%'
        and upper(v_appt.payment_reference) not like 'HOLD-%')
  );

  -- Detect both direct 'uncertain' state and uncertain attempts temporarily replayed as 'in_flight'
  v_is_uncertain := (
    v_appt.checkout_status = 'uncertain'
    or v_appt.checkout_uncertain_at is not null
    or v_appt.checkout_uncertain_reason is not null
    or (
      v_appt.checkout_attempt_id is not null
      and exists (
        select 1
        from public.checkout_attempt_log l
        where l.attempt_id = v_appt.checkout_attempt_id
          and (
            l.status = 'uncertain'
            or l.event in ('crash_detected', 'retry_replayed', 'uncertain_claim_released')
          )
      )
    )
  );

  if v_is_reconciliation then
    v_target_status := 'reconciliation_required';
    v_log_event := 'reconciliation_claim_released';
    v_log_reason := 'Released lease while preserving reconciliation_required state.';
  elsif v_has_committed_intent then
    v_target_status := 'committed';
    v_log_event := 'reentry_claim_released';
    v_log_reason := 'Released re-verification lease while preserving committed payment intent.';
  elsif v_is_uncertain then
    v_target_status := 'uncertain';
    v_log_event := 'uncertain_claim_released';
    v_log_reason := 'Released lease while preserving uncertain attempt state, idempotency key, and payload hash.';
  else
    v_target_status := 'idle';
    v_log_event := 'preflight_released';
    v_log_reason := 'Clean pre-uncertain preflight abort or deterministic gateway rejection.';
  end if;

  if v_appt.checkout_attempt_id is not null then
    select coalesce(max(attempt_sequence), 0) + 1 into v_seq
    from public.checkout_attempt_log
    where attempt_id = v_appt.checkout_attempt_id;

    insert into public.checkout_attempt_log (
      appointment_id, attempt_id, attempt_sequence, claim_id, intent_id, idempotency_key,
      payment_method, payload_hash, event, status, reason
    ) values (
      p_appointment_id, v_appt.checkout_attempt_id, v_seq, p_claim_id, v_appt.payment_reference,
      coalesce(v_appt.checkout_idempotency_key, 'preflight_none'),
      coalesce(v_appt.checkout_payment_method, 'unknown'),
      coalesce(v_appt.checkout_payload_hash, 'none'),
      v_log_event, v_target_status, v_log_reason
    );
  end if;

  if v_target_status in ('reconciliation_required', 'committed') then
    update public.patient_appointment
    set checkout_claim_id = null,
        checkout_claim_expires_at = null
    where appointment_id = p_appointment_id
      and checkout_claim_id = p_claim_id;
  elsif v_target_status = 'uncertain' then
    -- Preserve attempt_id, idempotency_key, payload_hash, payment_method, and uncertain metadata
    update public.patient_appointment
    set checkout_claim_id = null,
        checkout_claim_expires_at = null,
        checkout_status = 'uncertain',
        checkout_uncertain_at = coalesce(checkout_uncertain_at, now()),
        checkout_uncertain_reason = coalesce(checkout_uncertain_reason, 'claim_released_while_uncertain')
    where appointment_id = p_appointment_id
      and checkout_claim_id = p_claim_id;
  else
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
  end if;

  return jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'checkout_status', v_target_status
  );
end;
$$;

revoke all on function public.release_checkout_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.release_checkout_claim(uuid, text) to service_role;

-- =============================================================================
-- SECTION 8: Orphaned PaymentIntent tracking table & service_role-only RPCs
--            Required by paymongo-payment/index.ts (#L1735, #L1744, #L2093, #L2104, #L2109)
-- =============================================================================
create table if not exists public.payment_intent_orphan (
  orphan_id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.patient_appointment(appointment_id) on delete set null,
  paymongo_payment_id text not null unique,
  amount numeric not null check (amount > 0),
  currency text not null default 'PHP',
  status text not null default 'pending_cancellation',
  cancellation_error text,
  claim_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.payment_intent_orphan
  drop constraint if exists chk_payment_intent_orphan_status;

alter table public.payment_intent_orphan
  add constraint chk_payment_intent_orphan_status
  check (status in ('pending_cancellation', 'cancelled', 'failed_cancellation', 'reconciled'));

create index if not exists idx_payment_intent_orphan_appt on public.payment_intent_orphan(appointment_id);
create index if not exists idx_payment_intent_orphan_status on public.payment_intent_orphan(status);

alter table public.payment_intent_orphan enable row level security;
revoke all on table public.payment_intent_orphan from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_intent_orphan to service_role;

drop policy if exists "payment_intent_orphan_service_role_all" on public.payment_intent_orphan;
create policy "payment_intent_orphan_service_role_all"
  on public.payment_intent_orphan
  for all
  to service_role
  using (true)
  with check (true);

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
as $$
declare
  v_id uuid;
  v_existing_paymongo_id text;
  v_existing_appt uuid;
  v_row_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object('success', false, 'code', 'ERR_FORBIDDEN', 'message', 'service_role required.');
  end if;

  if p_appointment_id is null
     or p_paymongo_payment_id is null or trim(p_paymongo_payment_id) = ''
     or p_amount is null or p_amount <= 0 or round(p_amount, 2) <= 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Valid appointment ID, PayMongo payment ID, and strictly positive amount are required.'
    );
  end if;

  if not exists (
    select 1 from public.patient_appointment
    where appointment_id = p_appointment_id
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'message', 'Referenced appointment does not exist.'
    );
  end if;

  select paymongo_payment_id, appointment_id
  into v_existing_paymongo_id, v_existing_appt
  from public.payment_intent_orphan
  where paymongo_payment_id = p_paymongo_payment_id
  for update;

  if v_existing_paymongo_id is not null and v_existing_appt is distinct from p_appointment_id then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Orphaned PaymentIntent already belongs to another or deleted appointment.'
    );
  end if;

  insert into public.payment_intent_orphan (
    appointment_id, paymongo_payment_id, amount, currency, status,
    cancellation_error, claim_id, idempotency_key, created_at, updated_at
  ) values (
    p_appointment_id, p_paymongo_payment_id, round(p_amount, 2), 'PHP', 'pending_cancellation',
    p_cancellation_error, p_claim_id, p_idempotency_key, now(), now()
  )
  on conflict (paymongo_payment_id) do update set
    cancellation_error = coalesce(excluded.cancellation_error, public.payment_intent_orphan.cancellation_error),
    updated_at = now()
  where public.payment_intent_orphan.appointment_id = excluded.appointment_id
  returning orphan_id into v_id;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 or v_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INTEGRITY_MISMATCH',
      'message', 'Failed to record orphaned PaymentIntent due to appointment conflict.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'orphan_id', v_id,
    'paymongo_payment_id', p_paymongo_payment_id
  );
end;
$$;

revoke all on function public.record_orphaned_intent(uuid, text, numeric, text, text, text) from public, anon, authenticated;
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
as $$
declare
  v_row_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object('success', false, 'code', 'ERR_FORBIDDEN', 'message', 'service_role required.');
  end if;

  if p_paymongo_payment_id is null
     or trim(p_paymongo_payment_id) = ''
     or p_status is null
     or p_status not in ('pending_cancellation', 'cancelled', 'failed_cancellation', 'reconciled') then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Valid PayMongo payment ID and non-null allowed orphan status are required.'
    );
  end if;

  update public.payment_intent_orphan
  set status = p_status,
      cancellation_error = case when p_cancellation_error is not null then p_cancellation_error else cancellation_error end,
      updated_at = now(),
      resolved_at = case when p_status in ('cancelled', 'reconciled') then coalesce(resolved_at, now()) else resolved_at end
  where paymongo_payment_id = p_paymongo_payment_id;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_NOT_FOUND',
      'updated', false,
      'paymongo_payment_id', p_paymongo_payment_id,
      'message', 'Orphaned PaymentIntent record not found.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'updated', true,
    'paymongo_payment_id', p_paymongo_payment_id,
    'status', p_status
  );
end;
$$;

revoke all on function public.resolve_orphaned_intent(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_orphaned_intent(text, text, text) to service_role;

-- =============================================================================
-- SECTION 9: Service-role overload
--            public.cancel_appointment_hold(uuid, boolean, text default null, text default null)
--            Supports paymongo-payment/index.ts (#L2940) atomically:
--              - p_gateway_verified = true requires a valid p_verified_intent_id
--                owned by p_appointment_id (matching appointment.payment_reference
--                if pi_*, never belonging to another appointment) and terminal
--                p_verified_intent_status in ('cancelled', 'failed').
--              - p_gateway_verified = false permits cancellation ONLY when there
--                is no active/uncertain checkout state, no active payment ref,
--                and no pending/processing/success/reconciliation_required ledger row.
--              - Always protects 'success' & 'reconciliation_required' records.
--              - Rejects ANY unresolved pending/processing row not matching the
--                verified intent (so no pending/processing row is abandoned).
--              - On 1-arg cancel_appointment_hold(uuid) success, atomically sets
--                ONLY matching verified pending/processing rows to 'cancelled' or
--                'failed' and resolves checkout_status = 'cancelled' in one txn.
--            No DEFAULT on p_gateway_verified prevents ambiguity with and
--            preserves MAIN's 1-arg cancel_appointment_hold(uuid) and grants.
-- =============================================================================
drop function if exists public.cancel_appointment_hold(uuid, boolean);
drop function if exists public.cancel_appointment_hold(uuid, boolean, text);

create or replace function public.cancel_appointment_hold(
  p_appointment_id uuid,
  p_gateway_verified boolean,
  p_verified_intent_id text default null,
  p_verified_intent_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_pay record;
  v_gateway_verified boolean := false;
  v_raw_intent text := null;
  v_raw_intent_status text := null;
  v_verified_intent text := null;
  v_target_ledger_status text := null;
  v_has_gateway_ref boolean := false;
  v_has_pi_ref boolean := false;
  v_has_active_checkout_state boolean := false;
  v_intent_owned_by_appt boolean := false;
  v_settled_or_recon_count integer := 0;
  v_unverified_active_count integer := 0;
  v_verified_active_ids uuid[] := array[]::uuid[];
  v_res jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       session_user in ('postgres', 'supabase_admin')
       and nullif(current_setting('request.jwt.claim.role', true), '') is null
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'error', 'ERR_FORBIDDEN',
      'message', 'Gateway-verified hold cancellation requires service_role.'
    );
  end if;

  if p_appointment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'error', 'ERR_INVALID_PARAMS',
      'message', 'Missing appointment ID.'
    );
  end if;

  v_gateway_verified := (coalesce(p_gateway_verified, false) is true);
  v_raw_intent := nullif(trim(p_verified_intent_id), '');
  v_raw_intent_status := nullif(lower(trim(p_verified_intent_status)), '');

  if not v_gateway_verified then
    if v_raw_intent is not null or v_raw_intent_status is not null then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INVALID_PARAMS',
        'error', 'ERR_INVALID_PARAMS',
        'message', 'Verified intent parameters cannot be provided when p_gateway_verified is false.'
      );
    end if;
    v_verified_intent := null;
    v_target_ledger_status := null;
  else
    v_verified_intent := v_raw_intent;
    v_target_ledger_status := coalesce(v_raw_intent_status, 'cancelled');

    if v_verified_intent is not null and v_verified_intent !~ '^pi_[A-Za-z0-9_-]{1,128}$' then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INVALID_PARAMS',
        'error', 'ERR_INVALID_PARAMS',
        'message', 'Verified PaymentIntent ID must be a valid PayMongo pi_* identifier.'
      );
    end if;

    if v_target_ledger_status not in ('cancelled', 'failed') then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INVALID_PARAMS',
        'error', 'ERR_INVALID_PARAMS',
        'message', 'Verified PaymentIntent status must be terminal (cancelled or failed).'
      );
    end if;
  end if;

  select appointment_id, payment_status, payment_reference, checkout_status,
         checkout_claim_id, checkout_claim_expires_at,
         checkout_uncertain_at, checkout_uncertain_reason
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

  -- Lock relevant ledger rows after locking patient_appointment to prevent races
  for v_pay in
    select payment_id, status, paymongo_payment_id, paymongo_payment_intent_id
    from public.user_payment
    where appointment_id = p_appointment_id
      and status in ('pending', 'processing', 'success', 'reconciliation_required')
    for update
  loop
    if v_pay.status in ('success', 'reconciliation_required') then
      v_settled_or_recon_count := v_settled_or_recon_count + 1;
    elsif v_pay.status in ('pending', 'processing') then
      if v_gateway_verified
         and v_verified_intent is not null
         and (
           v_pay.paymongo_payment_id = v_verified_intent
           or v_pay.paymongo_payment_intent_id = v_verified_intent
         )
         and (
           v_pay.paymongo_payment_intent_id is null
           or v_pay.paymongo_payment_intent_id = v_verified_intent
         ) then
        v_verified_active_ids := array_append(v_verified_active_ids, v_pay.payment_id);
      else
        v_unverified_active_count := v_unverified_active_count + 1;
      end if;
    end if;
  end loop;

  -- Always protect settled ('success') and administrative reconciliation ('reconciliation_required') payments
  if v_settled_or_recon_count > 0 or v_appt.checkout_status = 'reconciliation_required' then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_PROCESSING',
      'error', 'ERR_PAYMENT_PROCESSING',
      'message', 'Payment has succeeded or is pending reconciliation; hold cannot be cancelled.'
    );
  end if;

  -- Reject if ANY pending/processing row does not belong to the exact verified intent
  -- (covers p_gateway_verified = false as well as older/unrelated rows under p_gateway_verified = true)
  if v_unverified_active_count > 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_PAYMENT_PROCESSING',
      'error', 'ERR_PAYMENT_PROCESSING',
      'message', 'An unresolved or unverified pending/processing payment exists for this appointment; hold cannot be cancelled.'
    );
  end if;

  v_has_gateway_ref := (
    v_appt.payment_reference is not null
    and v_appt.payment_reference not in ('', 'NONE')
    and v_appt.payment_reference not like 'SIM-%'
    and upper(v_appt.payment_reference) not like 'HOLD-%'
  );
  v_has_pi_ref := (
    v_appt.payment_reference is not null
    and left(v_appt.payment_reference, 3) = 'pi_'
  );
  v_has_active_checkout_state := (
    v_appt.checkout_status not in ('idle', 'cancelled')
    or v_appt.checkout_claim_id is not null
    or (v_appt.checkout_claim_expires_at is not null and v_appt.checkout_claim_expires_at > now())
    or v_appt.checkout_uncertain_at is not null
    or v_appt.checkout_uncertain_reason is not null
  );

  if not v_gateway_verified then
    -- Unverified cancellation is allowed ONLY with no active/uncertain checkout state,
    -- no active stored gateway reference, and no pending/processing/success/reconciliation_required ledger row.
    if v_has_active_checkout_state or v_has_gateway_ref then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_GATEWAY_CHECK_REQUIRED',
        'error', 'ERR_GATEWAY_CHECK_REQUIRED',
        'message', 'Authoritative gateway verification is required before cancelling an active or uncertain checkout hold.'
      );
    end if;
  else
    -- Verified cancellation requires the verified PayMongo pi_* intent ID belonging to this appointment
    if v_verified_intent is null then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_GATEWAY_CHECK_REQUIRED',
        'error', 'ERR_GATEWAY_CHECK_REQUIRED',
        'message', 'p_verified_intent_id is required when p_gateway_verified is true.'
      );
    end if;

    if v_has_pi_ref and v_verified_intent is distinct from v_appt.payment_reference then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_GATEWAY_CHECK_REQUIRED',
        'error', 'ERR_GATEWAY_CHECK_REQUIRED',
        'message', 'Verified PaymentIntent does not match the appointment payment reference.'
      );
    end if;

    if exists (
      select 1
      from public.user_payment
      where (paymongo_payment_id = v_verified_intent or paymongo_payment_intent_id = v_verified_intent)
        and appointment_id is distinct from p_appointment_id
    ) or exists (
      select 1
      from public.payment_intent_orphan
      where paymongo_payment_id = v_verified_intent
        and appointment_id is distinct from p_appointment_id
    ) then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_INTENT_OWNERSHIP_CONFLICT',
        'error', 'ERR_INTENT_OWNERSHIP_CONFLICT',
        'message', 'PaymentIntent belongs to another appointment; hold cannot be cancelled.'
      );
    end if;

    v_intent_owned_by_appt := (
      v_appt.payment_reference = v_verified_intent
      or exists (
        select 1
        from public.user_payment
        where appointment_id = p_appointment_id
          and (paymongo_payment_id = v_verified_intent or paymongo_payment_intent_id = v_verified_intent)
      )
    );

    if not v_intent_owned_by_appt then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_GATEWAY_CHECK_REQUIRED',
        'error', 'ERR_GATEWAY_CHECK_REQUIRED',
        'message', 'Verified PaymentIntent is not associated with this appointment.'
      );
    end if;
  end if;

  -- Delegate hold cancellation directly to MAIN's preserved 1-arg cancel_appointment_hold(uuid)
  v_res := public.cancel_appointment_hold(p_appointment_id);

  if coalesce((v_res->>'success')::boolean, false) is true then
    -- Atomically transition ONLY verified pending/processing rows matching p_verified_intent_id
    -- in the exact same transaction as appointment cancellation (rolls back if 1-arg fails)
    if coalesce(array_length(v_verified_active_ids, 1), 0) > 0 then
      update public.user_payment
      set status = v_target_ledger_status
      where payment_id = any(v_verified_active_ids)
        and appointment_id = p_appointment_id
        and status in ('pending', 'processing');
    end if;

    update public.patient_appointment
    set checkout_claim_id = null,
        checkout_claim_expires_at = null,
        checkout_uncertain_at = null,
        checkout_uncertain_reason = null,
        checkout_status = 'cancelled'
    where appointment_id = p_appointment_id;
  end if;

  return v_res;
end;
$$;

revoke all on function public.cancel_appointment_hold(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.cancel_appointment_hold(uuid, boolean, text, text) to service_role;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- PART 10: POST-MIGRATION READ-ONLY VERIFICATION QUERIES (Run after execution)
-- =============================================================================
/*
-- 1. Confirm all 9 checkout_% columns, NOT NULL, and CHECK constraint on patient_appointment
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patient_appointment'
  AND column_name LIKE 'checkout_%'
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid), convalidated
FROM pg_constraint
WHERE conrelid = 'public.patient_appointment'::regclass
  AND conname = 'chk_patient_appointment_checkout_status';

-- 2. Confirm 96 existing 'success' rows remain intact, no updated_at column added, and constraint validated
SELECT status, count(*) FROM public.user_payment GROUP BY 1 ORDER BY 2 DESC;
SELECT conname, pg_get_constraintdef(oid), convalidated
FROM pg_constraint
WHERE conrelid = 'public.user_payment'::regclass AND contype = 'c'
ORDER BY conname;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_payment' AND column_name = 'updated_at';

-- 3. Confirm triggers on patient_appointment (both existing triggers and scoped checkout/slot/cross-clinic triggers)
SELECT t.tgname, t.tgenabled, p.proname, p.prosecdef, pg_get_triggerdef(t.oid, true) AS trigger_def
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.patient_appointment'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- 4. Confirm new audit/orphan tables exist, RLS is enabled, and
--    payment_intent_orphan.appointment_id is nullable with ON DELETE SET NULL ('n')
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('checkout_attempt_log', 'payment_intent_orphan')
ORDER BY tablename;

SELECT c.column_name, c.is_nullable, c.udt_name, con.conname, con.confdeltype
FROM information_schema.columns c
LEFT JOIN pg_constraint con
  ON con.conrelid = 'public.payment_intent_orphan'::regclass
 AND con.contype = 'f'
 AND con.confrelid = 'public.patient_appointment'::regclass
WHERE c.table_schema = 'public'
  AND c.table_name = 'payment_intent_orphan'
  AND c.column_name = 'appointment_id';

-- 5. Confirm exact RPC signatures, SECURITY DEFINER, and service_role-only grants
--    (plus unchanged 1-arg cancel_appointment_hold(uuid) and fulfill_appointment_payment_atomic)
SELECT
  p.oid::regprocedure AS signature,
  p.prosecdef AS security_definer,
  p.proconfig AS config,
  coalesce((SELECT array_agg(acl::text ORDER BY acl::text) FROM unnest(p.proacl) acl), ARRAY['DEFAULT']) AS grants
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_checkout_intent',
    'commit_checkout_intent',
    'release_checkout_claim',
    'record_orphaned_intent',
    'resolve_orphaned_intent',
    'cancel_appointment_hold',
    'fulfill_appointment_payment_atomic',
    'trg_protect_appointment_checkout_fields'
  )
ORDER BY p.proname, signature::text;
*/

