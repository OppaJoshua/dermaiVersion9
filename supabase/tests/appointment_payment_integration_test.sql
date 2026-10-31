-- ============================================================================
-- DermAI — Appointment Payment Database Integration Test Suite
-- Target: Development Supabase Instance (NOT PRODUCTION)
--
-- How to run:
--   Execute this script in the Supabase SQL Editor or via psql on a DEVELOPMENT database.
--   Every test block asserts expected database state and raises an EXCEPTION on failure.
-- ============================================================================

\echo '=== Starting DermAI Appointment Payment Database Integration Tests ==='

do $$
declare
  v_test_clinic_id uuid;
  v_test_user_id uuid;
  v_competitor_user_id uuid;
  v_test_doctor_id uuid;
  v_appt_id uuid;
  v_hold_res jsonb;
  v_retry_res jsonb;
  v_comp_res jsonb;
  v_pay_res jsonb;
  v_clean_res jsonb;
  v_row record;
  v_pay_row record;
  v_err_thrown boolean;
begin
  \echo '1. Setting up mock development fixtures...';

  -- Create or fetch test user
  select user_id into v_test_user_id from "user" limit 1;
  if v_test_user_id is null then
    insert into "user" (email, name, role)
    values ('test_patient@example.com', 'Test Patient', 'patient')
    returning user_id into v_test_user_id;
  end if;

  -- Create or fetch competitor user
  select user_id into v_competitor_user_id from "user" where user_id <> v_test_user_id limit 1;
  if v_competitor_user_id is null then
    insert into "user" (email, name, role)
    values ('competitor_patient@example.com', 'Competitor Patient', 'patient')
    returning user_id into v_competitor_user_id;
  end if;

  -- Create or fetch test clinic
  select clinic_id into v_test_clinic_id from clinic limit 1;
  if v_test_clinic_id is null then
    insert into clinic (name, consultation_fee, status, verified)
    values ('Test Dermatologic Clinic', 650.00, 'approved', true)
    returning clinic_id into v_test_clinic_id;
  end if;

  -- Fetch or create test doctor
  select doctor_id into v_test_doctor_id from clinic_doctor where clinic_id = v_test_clinic_id limit 1;

  \echo '2. Verifying app_feature_flag server gate...';
  -- Ensure feature flag table exists
  perform 1 from app_feature_flag where flag_name = 'enable_simulated_appointment_payment';
  if not found then
    raise exception 'TEST FAILED: app_feature_flag table or flag missing.';
  end if;

  -- Temporarily enable simulated payments for integration testing
  update app_feature_flag
  set enabled = true
  where flag_name = 'enable_simulated_appointment_payment';

  \echo '3. Testing acquire_appointment_slot_hold RPC contract & slot reservation...';
  -- Set auth context to test user
  perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);

  v_hold_res := acquire_appointment_slot_hold(
    p_clinic_id := v_test_clinic_id,
    p_doctor_id := v_test_doctor_id,
    p_date := now() + interval '3 days',
    p_time := '10:00:00',
    p_patient_name := 'Test Patient',
    p_patient_email := 'test_patient@example.com',
    p_emergency_contact_name := 'Emergency Contact',
    p_emergency_contact_phone := '09170000000',
    p_emergency_contact_relationship := 'Family',
    p_notes := 'Integration test appointment hold',
    p_hold_duration_minutes := 10,
    p_user_id := v_test_user_id
  );

  if (v_hold_res->>'success')::boolean is not true then
    raise exception 'TEST FAILED: acquire_appointment_slot_hold returned failure: %', v_hold_res;
  end if;

  v_appt_id := (v_hold_res->>'appointment_id')::uuid;

  select * into v_row from patient_appointment where appointment_id = v_appt_id;
  if v_row.payment_status <> 'pending_hold' then
    raise exception 'TEST FAILED: payment_status expected pending_hold, got %', v_row.payment_status;
  end if;
  if v_row.queue_number is not null then
    raise exception 'TEST FAILED: queue_number must be null during pending_hold, got %', v_row.queue_number;
  end if;
  if v_row.schedule_sent_to_doctor is not false then
    raise exception 'TEST FAILED: schedule_sent_to_doctor must be false during pending_hold';
  end if;

  \echo '4. Testing idempotent retry by the same user...';
  v_retry_res := acquire_appointment_slot_hold(
    p_clinic_id := v_test_clinic_id,
    p_doctor_id := v_test_doctor_id,
    p_date := now() + interval '3 days',
    p_time := '10:00:00',
    p_patient_name := 'Test Patient',
    p_hold_duration_minutes := 10,
    p_user_id := v_test_user_id
  );

  if (v_retry_res->>'appointment_id')::uuid <> v_appt_id then
    raise exception 'TEST FAILED: Idempotent retry generated duplicate appointment!';
  end if;
  if (v_retry_res->>'is_existing_hold')::boolean is not true then
    raise exception 'TEST FAILED: is_existing_hold expected true on retry';
  end if;

  \echo '5. Testing competing reservation rejection for occupied slot...';
  -- Set auth context to competitor user
  perform set_config('request.jwt.claim.sub', v_competitor_user_id::text, true);

  v_comp_res := acquire_appointment_slot_hold(
    p_clinic_id := v_test_clinic_id,
    p_doctor_id := v_test_doctor_id,
    p_date := now() + interval '3 days',
    p_time := '10:00:00',
    p_patient_name := 'Competitor Patient',
    p_hold_duration_minutes := 10,
    p_user_id := v_competitor_user_id
  );

  if (v_comp_res->>'success')::boolean is true then
    raise exception 'TEST FAILED: Competing booking was allowed on an active hold!';
  end if;
  if v_comp_res->>'code' <> 'ERR_SLOT_UNAVAILABLE' then
    raise exception 'TEST FAILED: Expected ERR_SLOT_UNAVAILABLE, got %', v_comp_res->>'code';
  end if;

  \echo '6. Testing trg_protect_appointment_payment_fields invariant protection...';
  -- Reset auth context to test user
  perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);

  v_err_thrown := false;
  begin
    -- Direct client update attempting to declare payment success
    update patient_appointment
    set payment_status = 'paid'
    where appointment_id = v_appt_id;
  exception when others then
    v_err_thrown := true;
  end;

  if not v_err_thrown then
    raise exception 'TEST FAILED: Trigger failed to block direct untrusted payment_status update to paid!';
  end if;

  \echo '7. Testing process_simulated_appointment_payment success transition...';
  v_pay_res := process_simulated_appointment_payment(
    p_appointment_id := v_appt_id,
    p_simulated_outcome := 'success',
    p_simulated_method := 'Test GCash'
  );

  if (v_pay_res->>'success')::boolean is not true then
    raise exception 'TEST FAILED: process_simulated_appointment_payment returned failure: %', v_pay_res;
  end if;

  select * into v_row from patient_appointment where appointment_id = v_appt_id;
  if v_row.payment_status <> 'paid' then
    raise exception 'TEST FAILED: payment_status expected paid, got %', v_row.payment_status;
  end if;
  if v_row.queue_number is null or v_row.queue_number <= 0 then
    raise exception 'TEST FAILED: queue_number was not assigned on payment success';
  end if;
  if v_row.schedule_sent_to_doctor is not true then
    raise exception 'TEST FAILED: schedule_sent_to_doctor must be true after payment';
  end if;

  -- Verify ledger insertion into user_payment
  select * into v_pay_row from user_payment where appointment_id = v_appt_id;
  if v_pay_row.payment_id is null then
    raise exception 'TEST FAILED: user_payment ledger entry was not recorded!';
  end if;
  if v_pay_row.payment_type <> 'appointment_consultation_simulated' then
    raise exception 'TEST FAILED: user_payment expected appointment_consultation_simulated, got %', v_pay_row.payment_type;
  end if;
  if v_pay_row.status <> 'success' then
    raise exception 'TEST FAILED: user_payment status expected success, got %', v_pay_row.status;
  end if;

  \echo '8. Testing release_expired_appointment_holds JSONB contract...';
  v_clean_res := release_expired_appointment_holds();
  if (v_clean_res->>'success')::boolean is not true then
    raise exception 'TEST FAILED: release_expired_appointment_holds must return { success: true }';
  end if;

  \echo '9. Testing protection of paid appointments from hold cancellation...';
  -- Set auth context to test user
  perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);
  v_comp_res := cancel_appointment_hold(v_appt_id);
  if (v_comp_res->>'success')::boolean is true then
    raise exception 'TEST FAILED: cancel_appointment_hold must fail on paid appointment!';
  end if;
  if v_comp_res->>'code' <> 'ERR_ALREADY_PAID' then
    raise exception 'TEST FAILED: Expected ERR_ALREADY_PAID, got %', v_comp_res->>'code';
  end if;

  \echo '10. Testing stale webhook conditional update zero-row detection...';
  -- Create a second hold that will be cancelled prior to webhook update
  v_hold_res := acquire_appointment_slot_hold(
    p_clinic_id := v_test_clinic_id,
    p_doctor_id := v_test_doctor_id,
    p_date := now() + interval '4 days',
    p_time := '14:00:00',
    p_patient_name := 'Stale Test Patient',
    p_hold_duration_minutes := 10,
    p_user_id := v_test_user_id
  );
  declare
    v_stale_appt_id uuid := (v_hold_res->>'appointment_id')::uuid;
    v_stale_cancel_res jsonb;
    v_rows_affected integer := 0;
  begin
    -- Patient cancels hold before webhook executes
    v_stale_cancel_res := cancel_appointment_hold(v_stale_appt_id);
    if (v_stale_cancel_res->>'success')::boolean is not true then
      raise exception 'TEST FAILED: cancel_appointment_hold failed for stale test: %', v_stale_cancel_res;
    end if;

    -- Webhook attempts atomic conditional update
    update patient_appointment
    set payment_status = 'paid',
        payment_reference = 'pay_stale_test_999'
    where appointment_id = v_stale_appt_id
      and payment_status in ('pending_hold', 'failed');
    get diagnostics v_rows_affected = row_count;

    if v_rows_affected <> 0 then
      raise exception 'TEST FAILED: Conditional update must affect 0 rows on cancelled appointment, got %', v_rows_affected;
    end if;

    -- Verify appointment status remains cancelled (never reactivated)
    select * into v_row from patient_appointment where appointment_id = v_stale_appt_id;
    if v_row.payment_status <> 'cancelled' then
      raise exception 'TEST FAILED: Stale appointment payment_status was modified! Expected cancelled, got %', v_row.payment_status;
    end if;

    -- Clean up stale test record
    delete from patient_appointment where appointment_id = v_stale_appt_id;
  end;

  \echo '11. Testing user_payment reconciliation_required status and unique idempotency...';
  declare
    v_recon_pay_id uuid;
    v_dup_error boolean := false;
  begin
    insert into user_payment (
      amount, payment_date, method, status, user_id,
      paymongo_payment_id, payment_type
    ) values (
      650.00, now(), 'gcash', 'reconciliation_required', v_test_user_id,
      'pay_recon_uniq_test_123', 'appointment_consultation'
    ) returning payment_id into v_recon_pay_id;

    -- Test duplicate insert must violate unique constraint
    begin
      insert into user_payment (
        amount, payment_date, method, status, user_id,
        paymongo_payment_id, payment_type
      ) values (
        650.00, now(), 'gcash', 'success', v_test_user_id,
        'pay_recon_uniq_test_123', 'appointment_consultation'
      );
    exception when unique_violation then
      v_dup_error := true;
    end;

    if not v_dup_error then
      raise exception 'TEST FAILED: Unique constraint on user_payment(paymongo_payment_id) failed to block duplicate!';
    end if;

    -- Clean up reconciliation test payment
    delete from user_payment where payment_id = v_recon_pay_id;
  end;

  \echo '13. Testing fulfill_appointment_payment_atomic currency validation (reject non-PHP)...';
  declare
    v_curr_res jsonb;
  begin
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_curr_res := fulfill_appointment_payment_atomic(
      p_paymongo_payment_id := 'pay_test_curr_1',
      p_payment_intent_id := 'pi_test_curr_1',
      p_appointment_id := v_appt_id,
      p_user_id := v_test_user_id,
      p_amount := 650.00,
      p_payment_method := 'gcash',
      p_currency := 'USD'
    );
    if (v_curr_res->>'success')::boolean is not false or v_curr_res->>'code' <> 'ERR_INVALID_CURRENCY' then
      raise exception 'TEST FAILED: Non-PHP currency must be rejected with ERR_INVALID_CURRENCY, got %', v_curr_res;
    end if;
  end;

  \echo '14. Testing fulfill_appointment_payment_atomic underpayment rejection...';
  declare
    v_underpay_res jsonb;
  begin
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_underpay_res := fulfill_appointment_payment_atomic(
      p_paymongo_payment_id := 'pay_test_underpay_1',
      p_payment_intent_id := 'pi_test_underpay_1',
      p_appointment_id := v_appt_id,
      p_user_id := v_test_user_id,
      p_amount := 1.00,
      p_payment_method := 'gcash',
      p_currency := 'PHP'
    );
    if (v_underpay_res->>'success')::boolean is not false or v_underpay_res->>'code' <> 'ERR_INSUFFICIENT_AMOUNT' then
      raise exception 'TEST FAILED: Underpayment must be rejected with ERR_INSUFFICIENT_AMOUNT, got %', v_underpay_res;
    end if;
  end;

  \echo '15. Testing fulfill_appointment_payment_atomic explicit overpayment tracking...';
  declare
    v_overpay_appt_id uuid;
    v_overpay_res jsonb;
    v_overpay_row record;
  begin
    -- Create fresh hold for overpayment test
    perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);
    v_hold_res := acquire_appointment_slot_hold(
      p_clinic_id := v_test_clinic_id,
      p_doctor_id := v_test_doctor_id,
      p_date := now() + interval '5 days',
      p_time := '11:00:00',
      p_patient_name := 'Overpay Patient',
      p_hold_duration_minutes := 10,
      p_user_id := v_test_user_id
    );
    v_overpay_appt_id := (v_hold_res->>'appointment_id')::uuid;

    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_overpay_res := fulfill_appointment_payment_atomic(
      p_paymongo_payment_id := 'pay_test_overpay_1',
      p_payment_intent_id := 'pi_test_overpay_1',
      p_appointment_id := v_overpay_appt_id,
      p_user_id := v_test_user_id,
      p_amount := 800.00,
      p_payment_method := 'gcash',
      p_currency := 'PHP'
    );
    if (v_overpay_res->>'success')::boolean is not true or (v_overpay_res->>'is_overpayment')::boolean is not true then
      raise exception 'TEST FAILED: Overpayment must succeed with is_overpayment = true, got %', v_overpay_res;
    end if;

    select * into v_overpay_row from patient_appointment where appointment_id = v_overpay_appt_id;
    if v_overpay_row.clinic_note not like '%OVERPAYMENT DETECTED%' then
      raise exception 'TEST FAILED: Overpayment note missing in clinic_note: %', v_overpay_row.clinic_note;
    end if;

    -- Cleanup overpayment test
    delete from user_payment where appointment_id = v_overpay_appt_id;
    delete from patient_appointment where appointment_id = v_overpay_appt_id;
  end;

  \echo '16. Testing claim_email_outbox and finalize_email_outbox lifecycle...';
  declare
    v_claim_res jsonb;
    v_dupe_claim jsonb;
    v_fin_res jsonb;
    v_outbox_id uuid;
  begin
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_claim_res := claim_email_outbox(
      p_idempotency_key := 'appointment_receipt:pay_test_outbox_1',
      p_email_type := 'appointment_receipt',
      p_recipient_email := 'test_patient@example.com',
      p_user_id := v_test_user_id,
      p_appointment_id := v_appt_id,
      p_payload := '{"amount": 650}'::jsonb,
      p_lease_seconds := 120
    );
    if (v_claim_res->>'success')::boolean is not true or (v_claim_res->>'claim_acquired')::boolean is not true then
      raise exception 'TEST FAILED: Initial claim_email_outbox must succeed, got %', v_claim_res;
    end if;
    v_outbox_id := (v_claim_res->>'outbox_id')::uuid;

    -- Concurrent claim while lease is active must be denied
    v_dupe_claim := claim_email_outbox(
      p_idempotency_key := 'appointment_receipt:pay_test_outbox_1',
      p_email_type := 'appointment_receipt',
      p_recipient_email := 'test_patient@example.com',
      p_user_id := v_test_user_id,
      p_appointment_id := v_appt_id,
      p_payload := '{"amount": 650}'::jsonb
    );
    if (v_dupe_claim->>'claim_acquired')::boolean is not false then
      raise exception 'TEST FAILED: Duplicate claim within lease must be denied, got %', v_dupe_claim;
    end if;

    -- Finalize outbox
    v_fin_res := finalize_email_outbox(
      p_outbox_id := v_outbox_id,
      p_success := true
    );
    if (v_fin_res->>'success')::boolean is not true then
      raise exception 'TEST FAILED: finalize_email_outbox failed, got %', v_fin_res;
    end if;

    -- Cleanup outbox test
    delete from email_outbox where outbox_id = v_outbox_id;
  end;

  \echo '17. Teardown: Clean up test appointment records...';
  delete from user_payment where appointment_id = v_appt_id;
  delete from patient_appointment where appointment_id = v_appt_id;

  -- Reset feature flag to false (secure default)
  update app_feature_flag
  set enabled = false
  where flag_name = 'enable_simulated_appointment_payment';

  \echo '=== ALL DATABASE INTEGRATION ASSERTIONS PASSED SUCCESSFULLY! ===';
end $$;
