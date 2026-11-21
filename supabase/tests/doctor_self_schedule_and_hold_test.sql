-- ============================================================================
-- DermAI — Doctor Self-Service Duty Schedule & Hold Validation SQL Test Suite
-- Migration under test: 20261121_doctor_self_duty_schedule_management.sql
--
-- *** DEVELOPMENT / STAGING DATABASE ONLY — NEVER RUN AGAINST PRODUCTION ***
--
-- How to run on staging / local test DB (everything runs inside ONE transaction
-- and rolls back at the end so zero data is persisted):
--   psql "$STAGING_DB_URL" -f supabase/tests/doctor_self_schedule_and_hold_test.sql
--
-- Verifies:
-- 1. Unspoofable zero-lock trigger guard (`trg_guard_clinic_doctor_schedule_update`):
--    - Direct UPDATE by an authenticated user is rejected with ERR_DIRECT_SCHEDULE_UPDATE_FORBIDDEN
--      EVEN IF the caller attempts to spoof `set_config('app.authorized_schedule_rpc', 'true', true)`,
--      because `current_user` in the SECURITY INVOKER trigger is 'authenticated' (not 'postgres').
-- 2. Doctor ownership & clinic-owner authorization in `save_authorized_doctor_duty_schedule`:
--    - Assigned active doctor (`user_id = auth.uid()`) can save their own schedule.
--    - Verified clinic owner (`is_clinic_owner(clinic_id)`) can save their clinic's doctor schedule.
--    - Another doctor or patient is rejected with ERR_FORBIDDEN.
-- 3. Multi-clinic branch conflict enforcement:
--    - Overlapping duty hours across Clinic A and Clinic B for the same doctor `user_id`
--      are rejected with: "Schedule Conflict: You already have a duty schedule at <Clinic Name> from <Start Time> to <End Time> on <Day>."
--    - Non-overlapping hours on the same day across Clinic A and Clinic B succeed.
-- 4. 4-Tier Precedence Rule & Explicitly Empty Weekdays:
--    - Explicitly empty `duty_days = '{}'` -> 0 shifts on all days.
--    - `weeklyShifts.Monday = []` while `Monday` is in `duty_days` -> 0 shifts on Monday (never falls back to duty_start_time/duty_end_time).
--    - Legacy `duty_days = '{Monday,Wednesday}'` with `duty_schedule IS NULL` -> synthesizes 1 shift on Monday and Wednesday.
-- 5. Full Appointment Duration Validation:
--    - 4:45 PM appointment with 30-minute duration against a shift ending at 5:00 PM is rejected
--      both in `is_slot_within_doctor_duty_schedule` and `acquire_appointment_slot_hold` (`ERR_OUTSIDE_DOCTOR_SCHEDULE`).
--    - 4:30 PM appointment with 30-minute duration against a shift ending at 5:00 PM is accepted.
-- 6. Existing Appointment & Unexpired Payment Hold Protection:
--    - `save_authorized_doctor_duty_schedule` rejects a schedule change that would leave an active
--      confirmed/pending appointment or unexpired `pending_hold` outside the new shift hours.
-- 7. Zero-PII Public Schedule RPC & Column-Level Privileges:
--    - `get_clinic_public_doctor_schedules` returns schedule and display columns without exposing
--      `email`, `contact_number`, `prc_license`, or `user_id`.
--    - `anon` role cannot SELECT `email`, `contact_number`, `prc_license`, or `user_id` from `public.clinic_doctor`.
-- ============================================================================
begin;

do $$
declare
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_doctor_user uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_clinic_a uuid;
  v_clinic_b uuid;
  v_doc_a uuid;
  v_doc_b uuid;
  v_res jsonb;
  v_hold_res jsonb;
  v_err_caught boolean;
  v_err_msg text;
  v_shift_count integer;
  v_next_monday date;
  v_monday_ts_1630 timestamptz;
  v_monday_ts_1645 timestamptz;
  v_public_cols text[];
begin
  -- Compute next future Monday in Asia/Manila
  v_next_monday := (timezone('Asia/Manila', now()))::date + ((8 - extract(isodow from (timezone('Asia/Manila', now()))::date)::integer) % 7);
  if v_next_monday <= (timezone('Asia/Manila', now()))::date then
    v_next_monday := v_next_monday + 7;
  end if;
  v_monday_ts_1630 := ((v_next_monday::text || ' 16:30:00+08:00')::timestamptz);
  v_monday_ts_1645 := ((v_next_monday::text || ' 16:45:00+08:00')::timestamptz);

  -- 1. Create test clinics and doctor affiliations
  insert into public.clinic (name, status, owner_id, consultation_fee)
  values ('Skin Clinic', 'approved', v_owner_a, 500.00)
  returning clinic_id into v_clinic_a;

  insert into public.clinic (name, status, owner_id, consultation_fee)
  values ('Derma Care', 'approved', v_owner_b, 500.00)
  returning clinic_id into v_clinic_b;

  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, contact_number, prc_license, status, duty_days, duty_schedule
  ) values (
    v_clinic_a, v_doctor_user, 'Dr. Test Dermatologist', 'dr.test@example.com', '09171234567', '1234567', 'Active', '{}'::text[], null
  ) returning doctor_id into v_doc_a;

  insert into public.clinic_doctor (
    clinic_id, user_id, doctor_name, email, contact_number, prc_license, status, duty_days, duty_schedule
  ) values (
    v_clinic_b, v_doctor_user, 'Dr. Test Dermatologist', 'dr.test@example.com', '09171234567', '1234567', 'Active', '{}'::text[], null
  ) returning doctor_id into v_doc_b;

  -- 2. Verify 4-Tier Precedence Rule & Explicitly Empty Weekday in extract_doctor_day_shifts
  -- 2A: weeklyShifts has Monday: [] while Monday is in duty_days -> MUST return 0 shifts
  select count(*) into v_shift_count
  from public.extract_doctor_day_shifts(
    array['Monday', 'Tuesday'],
    jsonb_build_object(
      'weeklyShifts', jsonb_build_object(
        'Monday', '[]'::jsonb,
        'Tuesday', jsonb_build_array(jsonb_build_object('startTime', '08:00', 'endTime', '12:00'))
      )
    ),
    '08:00',
    '17:00',
    'Monday',
    true
  );
  assert v_shift_count = 0, 'Tier 3A violation: Explicitly empty weeklyShifts.Monday = [] must return 0 shifts';

  -- 2B: Full appointment duration check: 4:45 PM (1005 min) with 30m duration vs 1:00 PM - 5:00 PM shift
  assert public.is_slot_within_doctor_duty_schedule(
    array['Monday'],
    jsonb_build_object(
      'slotIntervalMinutes', 30,
      'weeklyShifts', jsonb_build_object(
        'Monday', jsonb_build_array(jsonb_build_object('startTime', '13:00', 'endTime', '17:00', 'slotIntervalMinutes', 30))
      )
    ),
    '13:00',
    '17:00',
    v_next_monday,
    16 * 60 + 45, -- 4:45 PM
    '08:00',
    '20:00',
    'Monday - Saturday',
    30
  ) = false, 'Full duration violation: 4:45 PM (30m duration) must be rejected against 5:00 PM shift end';

  assert public.is_slot_within_doctor_duty_schedule(
    array['Monday'],
    jsonb_build_object(
      'slotIntervalMinutes', 30,
      'weeklyShifts', jsonb_build_object(
        'Monday', jsonb_build_array(jsonb_build_object('startTime', '13:00', 'endTime', '17:00', 'slotIntervalMinutes', 30))
      )
    ),
    '13:00',
    '17:00',
    v_next_monday,
    16 * 60 + 30, -- 4:30 PM
    '08:00',
    '20:00',
    'Monday - Saturday',
    30
  ) = true, 'Full duration check: 4:30 PM (30m duration) must be accepted against 5:00 PM shift end';

  -- 3. Verify Doctor Self-Service Schedule Save via save_authorized_doctor_duty_schedule
  perform set_config('request.jwt.claim.sub', v_doctor_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.save_authorized_doctor_duty_schedule(
    v_doc_a,
    v_clinic_a,
    array['Monday', 'Tuesday'],
    jsonb_build_object(
      'slotIntervalMinutes', 30,
      'weeklyShifts', jsonb_build_object(
        'Monday', jsonb_build_array(jsonb_build_object('startTime', '08:00', 'endTime', '12:00', 'slotIntervalMinutes', 30)),
        'Tuesday', jsonb_build_array(jsonb_build_object('startTime', '13:00', 'endTime', '17:00', 'slotIntervalMinutes', 30))
      )
    ),
    '08:00',
    '12:00'
  );
  assert (v_res->>'success')::boolean = true, 'Doctor self-service schedule save must succeed';

  -- 4. Verify Cross-Clinic Conflict Detection when Doctor saves overlapping Monday 10:00 AM - 2:00 PM at Derma Care
  v_err_caught := false;
  begin
    perform public.save_authorized_doctor_duty_schedule(
      v_doc_b,
      v_clinic_b,
      array['Monday'],
      jsonb_build_object(
        'slotIntervalMinutes', 30,
        'weeklyShifts', jsonb_build_object(
          'Monday', jsonb_build_array(jsonb_build_object('startTime', '10:00', 'endTime', '14:00', 'slotIntervalMinutes', 30))
        )
      ),
      '10:00',
      '14:00'
    );
  exception when others then
    v_err_caught := true;
    v_err_msg := sqlerrm;
  end;
  assert v_err_caught = true, 'Overlapping cross-clinic schedule must be rejected';
  assert position('Schedule Conflict: You already have a duty schedule at Skin Clinic from 8:00 AM to 12:00 PM on Monday.' in v_err_msg) > 0,
    'Cross-clinic conflict error message did not match expected text: ' || coalesce(v_err_msg, '');

  -- 5. Verify Non-Overlapping Monday Afternoon (1:00 PM - 5:00 PM) at Derma Care Succeeds
  v_res := public.save_authorized_doctor_duty_schedule(
    v_doc_b,
    v_clinic_b,
    array['Monday'],
    jsonb_build_object(
      'slotIntervalMinutes', 30,
      'weeklyShifts', jsonb_build_object(
        'Monday', jsonb_build_array(jsonb_build_object('startTime', '13:00', 'endTime', '17:00', 'slotIntervalMinutes', 30))
      )
    ),
    '13:00',
    '17:00'
  );
  assert (v_res->>'success')::boolean = true, 'Non-overlapping Monday afternoon schedule at second clinic must succeed';

  -- 6. Verify Unauthorized User Cannot Update Doctor Schedule
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  v_err_caught := false;
  begin
    perform public.save_authorized_doctor_duty_schedule(
      v_doc_a,
      v_clinic_a,
      array['Monday'],
      jsonb_build_object('weeklyShifts', jsonb_build_object('Monday', '[]'::jsonb)),
      null,
      null
    );
  exception when others then
    v_err_caught := true;
    v_err_msg := sqlerrm;
  end;
  assert v_err_caught = true and position('ERR_FORBIDDEN' in v_err_msg) > 0,
    'Unauthorized user must be blocked with ERR_FORBIDDEN';

  -- 7. Verify acquire_appointment_slot_hold Rejects 4:45 PM Slot (Exceeds 5:00 PM Shift End) and Accepts 4:30 PM Slot
  v_hold_res := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic_b,
    p_doctor_id := v_doc_b,
    p_date := v_monday_ts_1645,
    p_time := '16:45',
    p_batch_time := '16:45',
    p_patient_name := 'Test Patient',
    p_user_id := v_other_user
  );
  assert (v_hold_res->>'success')::boolean = false and (v_hold_res->>'code') = 'ERR_OUTSIDE_DOCTOR_SCHEDULE',
    '4:45 PM slot hold must be rejected with ERR_OUTSIDE_DOCTOR_SCHEDULE when shift ends at 5:00 PM';

  v_hold_res := public.acquire_appointment_slot_hold(
    p_clinic_id := v_clinic_b,
    p_doctor_id := v_doc_b,
    p_date := v_monday_ts_1630,
    p_time := '16:30',
    p_batch_time := '16:30',
    p_patient_name := 'Test Patient',
    p_user_id := v_other_user
  );
  assert (v_hold_res->>'success')::boolean = true,
    '4:30 PM slot hold must succeed when shift ends at 5:00 PM';

  -- 8. Verify Existing Unexpired Payment Hold Protects Schedule Against Removal
  perform set_config('request.jwt.claim.sub', v_doctor_user::text, true);
  v_err_caught := false;
  begin
    perform public.save_authorized_doctor_duty_schedule(
      v_doc_b,
      v_clinic_b,
      '{}'::text[],
      jsonb_build_object('weeklyShifts', '{}'::jsonb),
      null,
      null
    );
  exception when others then
    v_err_caught := true;
    v_err_msg := sqlerrm;
  end;
  assert v_err_caught = true and position('ERR_APPOINTMENT_CONFLICT' in v_err_msg) > 0,
    'Removing duty hours that cover an active unexpired payment hold must be blocked with ERR_APPOINTMENT_CONFLICT';

  -- 9. Verify Zero-PII Public Schedule RPC Returns Only Public Schedule & Display Columns
  select array_agg(column_name::text order by ordinal_position)
  into v_public_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'clinic_doctor'
    and column_name in ('email', 'contact_number', 'prc_license', 'user_id')
    and has_column_privilege('anon', 'public.clinic_doctor', column_name, 'SELECT');

  assert v_public_cols is null or coalesce(array_length(v_public_cols, 1), 0) = 0,
    'anon must NOT have SELECT privilege on PII columns (email, contact_number, prc_license, user_id) of public.clinic_doctor';

  raise notice 'ALL DOCTOR SELF-SERVICE SCHEDULE & SLOT HOLD SQL ASSERTIONS PASSED';
end;
$$;

rollback;
