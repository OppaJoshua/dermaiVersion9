-- ============================================================================
-- DermAI — Slot Hold Authority Database Integration Tests
-- Migration under test: 20261031_slot_hold_authority_and_visibility.sql
--
-- *** DEVELOPMENT / STAGING DATABASE ONLY — NEVER RUN AGAINST PRODUCTION ***
--
-- How to run (staging SQL editor or psql). Everything runs inside ONE
-- transaction that is ROLLED BACK at the end, so no data is kept:
--   psql "$STAGING_DB_URL" -f supabase/tests/slot_hold_authority_test.sql
--
-- Scope Distinction:
--   1. SINGLE-SESSION TRANSACTIONAL SQL TESTS (this script):
--      Verifies trigger attachment in pg_trigger, functional invariants,
--      bidirectional doctor/unassigned conflict rules, conflict ordering when
--      both caller and another patient hold slots at the same time, same-user
--      idempotent retry without extending payment_hold_expires_at, valid
--      failed-hold retry before expiry without extending expiration,
--      database-clock expiration, unreaped expired hold receiving a late
--      payment (transitioning to status = 'cancelled', payment_status = 'expired'),
--      alternate-doctor reselection (doctor_status = 'rejected' -> 'pending-review')
--      recomputing queue_number without ERR_FORBIDDEN (including onto a slot with
--      an unreaped expired hold), doctor-rejected appointment not blocking another
--      patient's booking and payment fulfillment, paid fulfillment assigning a
--      non-null queue_number, owner cancellation + rebooking, db_now output,
--      BOOKED slot exclusivity and conflict rejection, and non-leakage/authorization of
--      app.internal_payment_context across acquire_appointment_slot_hold,
--      cancel_appointment_hold, and release_expired_appointment_holds.
--      NOTE: Because a single DO $$ ... $$ block executes within one PostgreSQL
--      backend session and pg_advisory_xact_lock is session-reentrant, a
--      single-session script cannot test multi-session lock contention or
--      deadlock freedom under parallel connections.
--   2. GENUINE MULTI-SESSION CONCURRENCY TESTS (requires 2 parallel connections):
--      To verify advisory-lock serialization and deadlock freedom on staging,
--      run two parallel psql sessions:
--        Session 1: BEGIN; SELECT acquire_appointment_slot_hold(...); -- hold open
--        Session 2: BEGIN; SELECT acquire_appointment_slot_hold(...); -- blocks on lock
--      And concurrently invoke fulfill_appointment_payment_atomic in Session 1
--      while Session 2 calls acquire_appointment_slot_hold on the same slot.
--
-- STATUS: Static SQL test script — not executed in the local development
-- workspace (no live PostgreSQL / Supabase connection in sandbox).
-- ============================================================================
begin;

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

rollback;
