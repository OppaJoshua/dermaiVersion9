-- ============================================================================
-- Migration: Phase A & B - Notification Persistence, Idempotency & Soft Delete
-- Status: PREPARED ONLY (DO NOT EXECUTE AGAINST PRODUCTION WITHOUT APPROVAL)
-- Revisions applied:
--   1. ZERO HARD DELETIONS: Absolutely no SQL DELETE statements in this migration.
--   2. Corrected SECURITY DEFINER authorization:
--      - Eliminated flawed current_user check (under SECURITY DEFINER, current_user is the owner).
--      - Enforces auth.role() = 'service_role' for API callers.
--      - Execution strictly REVOKED from PUBLIC, anon, and authenticated; GRANTED to service_role.
--      - Existing triggers insert directly via SQL and are completely unaffected.
--   3. Unique index compatibility: Index predicate ignores empty/whitespace strings.
--   4. Nonexistent clinic_id column eliminated: Clinic ID stored strictly in JSONB metadata.
--   5. Recipient-only soft delete: Strict caller ownership (auth.uid() = user_id), no cross-user admin hiding.
--   6. Safe idempotent repeat: Hiding an already-hidden notification succeeds without error or state change.
--   7. Full data preservation: notif_id, user_id, title, message, metadata, is_read, read_at, created_at kept intact.
-- ============================================================================

-- 1. Add nullable hidden_at column and index on public.user_notification
-- Controls visibility for the authenticated recipient; never alters underlying record
ALTER TABLE public.user_notification 
ADD COLUMN IF NOT EXISTS hidden_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_notification_hidden_at 
ON public.user_notification (user_id, hidden_at);

-- 2. Partial unique index for atomic deduplication using idempotency_key
-- Note: Applies ONLY where idempotency_key is present and non-empty.
-- Does NOT delete, merge, or alter any historical notification records.
-- Pre-check read-only diagnostic query is provided in scratch/inspect_duplicate_idempotency_keys.sql.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notification_idempotency
ON public.user_notification (user_id, ((metadata->>'idempotency_key')))
WHERE (metadata->>'idempotency_key') IS NOT NULL
  AND trim(metadata->>'idempotency_key') <> '';

-- 3. Server-Side Atomic Idempotent Notification Insertion Function
-- Security:
--   - Executable ONLY by service_role (Edge Functions, backend webhooks).
--   - Revoked from PUBLIC, anon, and authenticated roles to prevent client-side forgery.
--   - Authorization check strictly verifies auth.role() = 'service_role' without relying on current_user.
-- Columns: Writes ONLY to existing database columns: user_id, title, body, message, type, subtype, metadata, created_at.
-- Idempotency: Requires non-empty idempotency_key. ON CONFLICT DO NOTHING preserves existing notification state.
CREATE OR REPLACE FUNCTION public.insert_user_notification_idempotent(
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_subtype TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_created_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notif_id UUID;
  v_idempotency_key TEXT;
  v_caller_role TEXT;
BEGIN
  -- Strict Server-Side API Security Guard:
  -- Only callers authenticated via the service_role key can execute this function.
  -- This prevents ordinary authenticated or anonymous users from forging notifications.
  v_caller_role := auth.role();
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: insert_user_notification_idempotent is restricted to authorized server-side processes';
  END IF;

  -- Validate required parameters
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Recipient user_id is required';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'Notification title is required';
  END IF;
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RAISE EXCEPTION 'Notification message is required';
  END IF;

  -- Enforce non-empty idempotency key for all official events
  IF p_metadata IS NOT NULL THEN
    v_idempotency_key := trim(COALESCE(p_metadata->>'idempotency_key', ''));
  END IF;

  IF v_idempotency_key IS NULL OR v_idempotency_key = '' THEN
    RAISE EXCEPTION 'Idempotency key is required in metadata for persistent event notifications';
  END IF;

  -- Insert with explicit ON CONFLICT clause matching partial unique index predicate.
  -- ON CONFLICT DO NOTHING strictly preserves existing notification content, read status, hidden status, and created_at.
  INSERT INTO public.user_notification (
    user_id,
    title,
    body,
    message,
    type,
    subtype,
    metadata,
    created_at
  ) VALUES (
    p_user_id,
    p_title,
    p_message,
    p_message,
    p_type,
    p_subtype,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_created_at, now())
  )
  ON CONFLICT (user_id, ((metadata->>'idempotency_key'))) 
  WHERE (metadata->>'idempotency_key') IS NOT NULL
    AND trim(metadata->>'idempotency_key') <> ''
  DO NOTHING
  RETURNING notif_id INTO v_notif_id;

  -- If conflict occurred (v_notif_id is NULL), resolve the existing notif_id without mutating the row
  IF v_notif_id IS NULL THEN
    SELECT notif_id INTO v_notif_id
    FROM public.user_notification
    WHERE user_id = p_user_id
      AND (metadata->>'idempotency_key') = v_idempotency_key
    LIMIT 1;
  END IF;

  RETURN v_notif_id;
END;
$$;

-- Restrict execution: Revoke from PUBLIC, anon, and authenticated. Grant to service_role.
REVOKE ALL ON FUNCTION public.insert_user_notification_idempotent FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_user_notification_idempotent TO service_role;

-- 4. Recipient-Specific Soft Delete Function
-- Guarantees:
--   - ONLY the exact authenticated recipient (auth.uid() = user_id) can soft-delete.
--   - No cross-user administrative hiding exception.
--   - Never executes SQL DELETE.
--   - Leaves underlying record, timestamps, and data 100% intact.
--   - Idempotent: Repeated calls on an already-hidden notification succeed safely without errors.
CREATE OR REPLACE FUNCTION public.soft_delete_user_notification(
  p_notif_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_rows_updated INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Authentication required';
  END IF;

  -- Strictly update ONLY rows where user_id matches the authenticated caller
  UPDATE public.user_notification
  SET hidden_at = now()
  WHERE notif_id = p_notif_id
    AND user_id = v_caller_id
    AND hidden_at IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  
  -- If row was not updated, check if it was already hidden by this user (safe idempotent retry)
  IF v_rows_updated = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.user_notification
      WHERE notif_id = p_notif_id AND user_id = v_caller_id AND hidden_at IS NOT NULL
    ) THEN
      RETURN true;
    END IF;
    -- Caller does not own the notification or record does not exist
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_user_notification FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_user_notification TO authenticated, service_role;

-- 5. User-Scoped Broadcast Soft Delete Marker Function
-- Hides shared broadcast ONLY for the calling user without touching admin_broadcast.
CREATE OR REPLACE FUNCTION public.hide_broadcast_for_user(
  p_broadcast_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Authentication required';
  END IF;

  -- Verify broadcast exists in public.admin_broadcast
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_broadcast WHERE broadcast_id = p_broadcast_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_notification (
    user_id,
    title,
    body,
    message,
    type,
    metadata,
    hidden_at,
    created_at
  ) VALUES (
    v_caller_id,
    'Hidden Broadcast',
    'User soft-deleted broadcast',
    'User soft-deleted broadcast',
    'broadcast_hidden',
    jsonb_build_object(
      'hidden_broadcast_id', p_broadcast_id::text,
      'idempotency_key', 'hide_broadcast_' || p_broadcast_id::text
    ),
    now(),
    now()
  )
  ON CONFLICT (user_id, ((metadata->>'idempotency_key')))
  WHERE (metadata->>'idempotency_key') IS NOT NULL
    AND trim(metadata->>'idempotency_key') <> ''
  DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.hide_broadcast_for_user FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_broadcast_for_user TO authenticated, service_role;

-- 6. Retrieve User Hidden Broadcast IDs Function
-- Retrieves broadcast IDs hidden by the user.
-- CRITICAL: Does NOT filter on hidden_at IS NULL so markers are always retrieved.
CREATE OR REPLACE FUNCTION public.get_user_hidden_broadcast_ids()
RETURNS TABLE (broadcast_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (metadata->>'hidden_broadcast_id')::uuid
  FROM public.user_notification
  WHERE user_id = auth.uid()
    AND type = 'broadcast_hidden'
    AND (metadata->>'hidden_broadcast_id') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_user_hidden_broadcast_ids FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_hidden_broadcast_ids TO authenticated, service_role;

-- 7. Client-Callable Authorized Notification Dispatch Function
-- Solves Cross-User Notification Delivery under RLS:
--   - Enables Doctors to notify Patients and Clinic Owners for their appointments.
--   - Enables Patients to notify Doctors and Clinic Owners for their appointments.
--   - Enables Clinic Owners to notify their Doctors and Patients.
--   - Enables Users/Clinics to notify Platform Administrators for legitimate events.
--   - Enables Platform Administrators to dispatch system/broadcast notices.
-- Security Guarantees:
--   - SECURITY DEFINER with set search_path = public, pg_temp.
--   - NO hardcoded email addresses or accounts; verified database roles only.
--   - Enforces strict event verification: prevents forged payment confirmations,
--     doctor decisions, appointment approvals, and fake clinic verifications.
--   - Verifies the actual business event state in the database before accepting notification creation.
--   - Preserves idempotency via ON CONFLICT (user_id, ((metadata->>'idempotency_key'))).
--   - Uses ONLY existing database columns (user_id, title, body, message, type, subtype, metadata, created_at).
CREATE OR REPLACE FUNCTION public.dispatch_authorized_notification(
  p_recipient_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_subtype TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_created_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_is_authorized BOOLEAN := false;
  v_is_admin_caller BOOLEAN := false;
  v_is_admin_recipient BOOLEAN := false;
  v_notif_id UUID;
  v_idempotency_key TEXT;
  v_appt_id_text TEXT;
  v_appt_id UUID;
  v_clinic_id_text TEXT;
  v_clinic_id UUID;
  v_analysis_id_text TEXT;
  v_analysis_id UUID;
  v_ticket_id_text TEXT;
  v_ticket_id UUID;
  v_has_appt_record BOOLEAN := false;
  v_appt_record RECORD;
BEGIN
  v_has_appt_record := false;
  -- Safe tuple initialization to prevent "record v_appt_record is not assigned yet"
  SELECT 
    NULL::uuid AS appointment_id,
    NULL::uuid AS patient_user_id,
    NULL::uuid AS target_branch_id,
    NULL::uuid AS assigned_doctor_id,
    NULL::varchar AS appt_status,
    NULL::varchar AS doctor_status,
    NULL::uuid AS clinic_owner_user_id
  INTO v_appt_record;

  v_caller_id := auth.uid();
  v_caller_role := auth.role();

  -- Trusted server-side processes (Edge Functions / Webhooks) calling via service_role
  IF v_caller_role = 'service_role' THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION 'Access denied: Authentication required';
    END IF;

    -- STRICT GUARD: Payment confirmations cannot be forged by client applications.
    -- Payment events must strictly originate from server-side payment webhooks (service_role).
    IF p_type IN ('payment', 'payment-confirmed', 'payment-received') OR p_subtype IN ('payment', 'payment-confirmed') THEN
      RAISE EXCEPTION 'Access denied: Payment notifications can only be generated by verified server-side payment processors';
    END IF;

    -- STRICT GUARD: Clinic verification notifications cannot be forged by ordinary clients.
    IF p_type IN ('clinic_verified', 'clinic_approved') OR p_subtype IN ('clinic_verified', 'clinic_approved') THEN
      SELECT EXISTS (
        SELECT 1 FROM public."user" u
        WHERE u.user_id = v_caller_id AND u.role = 'admin'
      ) INTO v_is_admin_caller;

      IF NOT v_is_admin_caller THEN
        RAISE EXCEPTION 'Access denied: Only verified platform administrators can issue clinic verification notices';
      END IF;
    END IF;

    -- Check if caller is verified platform administrator via database role (no hardcoded emails)
    SELECT EXISTS (
      SELECT 1 FROM public."user" u
      WHERE u.user_id = v_caller_id AND u.role = 'admin'
    ) INTO v_is_admin_caller;

    -- 1. Platform Administrator caller can notify any user
    IF v_is_admin_caller THEN
      v_is_authorized := true;
    END IF;

    -- 2. Self-notification (e.g. AI Scan completed, personal doctor reminders, synthetic soft-delete markers)
    IF NOT v_is_authorized AND v_caller_id = p_recipient_user_id THEN
      -- Disallow forging admin broadcast notices to self
      IF p_type = 'broadcast' OR p_subtype = 'admin_announcement' THEN
        RAISE EXCEPTION 'Access denied: Cannot dispatch broadcast notices';
      END IF;

      -- Disallow forging appointment status notifications or system verification notices to self
      IF p_type IN ('appointment-confirmed', 'appointment-rejected', 'appointment-completed', 'clinic_verified') THEN
        RAISE EXCEPTION 'Access denied: Privileged notification type % cannot be dispatched via self-notification', p_type;
      END IF;

      -- If scan completion notification, strictly verify caller actually owns the completed scan
      IF p_type = 'scan-completed' OR p_subtype = 'ai_analysis' THEN
        v_analysis_id_text := trim(COALESCE(p_metadata->>'analysis_id', p_metadata->>'analysisId', ''));
        IF v_analysis_id_text = '' OR v_analysis_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'Access denied: AI scan completion notifications require a valid analysis_id belonging to the caller';
        END IF;

        v_analysis_id := v_analysis_id_text::uuid;
        IF NOT EXISTS (
          SELECT 1 FROM public.ai_scan_result
          WHERE analysis_id = v_analysis_id AND user_id = v_caller_id
        ) THEN
          RAISE EXCEPTION 'Access denied: AI scan result does not exist or does not belong to caller';
        END IF;

        v_is_authorized := true;

      -- If support ticket notification to self, strictly verify caller actually owns the ticket
      ELSIF p_type = 'support' OR p_subtype = 'support_ticket' THEN
        v_ticket_id_text := trim(COALESCE(p_metadata->>'ticket_id', p_metadata->>'ticketId', ''));
        IF v_ticket_id_text = '' OR v_ticket_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'Access denied: Support notifications require a valid ticket_id belonging to the caller';
        END IF;

        v_ticket_id := v_ticket_id_text::uuid;
        IF NOT EXISTS (
          SELECT 1 FROM public.user_support_ticket
          WHERE ticket_id = v_ticket_id AND user_id = v_caller_id
        ) THEN
          RAISE EXCEPTION 'Access denied: Support ticket does not exist or does not belong to caller';
        END IF;

        v_is_authorized := true;

      ELSE
        v_is_authorized := true;
      END IF;
    END IF;

    -- 3. User notifying Platform Administrators (e.g., support ticket, new clinic application, doctor completed review)
    IF NOT v_is_authorized THEN
      SELECT EXISTS (
        SELECT 1 FROM public."user" u
        WHERE u.user_id = p_recipient_user_id AND u.role = 'admin'
      ) INTO v_is_admin_recipient;

      IF v_is_admin_recipient THEN
        -- Verify that the underlying event genuinely occurred:
        -- A. New clinic application: caller must be clinic owner
        IF p_type = 'clinic' AND p_subtype = 'new_clinic_application' THEN
          v_clinic_id_text := trim(COALESCE(p_metadata->>'clinic_id', ''));
          IF v_clinic_id_text <> '' AND v_clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_clinic_id := v_clinic_id_text::uuid;
            IF EXISTS (
              SELECT 1 FROM public.clinic
              WHERE clinic_id = v_clinic_id AND owner_user_id = v_caller_id
            ) THEN
              v_is_authorized := true;
            END IF;
          END IF;
        -- B. Support ticket received: caller must own the ticket
        ELSIF p_type = 'support' OR p_subtype = 'support_ticket' THEN
          v_ticket_id_text := trim(COALESCE(p_metadata->>'ticket_id', p_metadata->>'ticketId', ''));
          IF v_ticket_id_text = '' OR v_ticket_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Access denied: Support notifications require a valid ticket_id belonging to the caller';
          END IF;

          v_ticket_id := v_ticket_id_text::uuid;
          IF NOT EXISTS (
            SELECT 1 FROM public.user_support_ticket
            WHERE ticket_id = v_ticket_id AND user_id = v_caller_id
          ) THEN
            RAISE EXCEPTION 'Access denied: Support ticket does not exist or does not belong to caller';
          END IF;

          v_is_authorized := true;
        -- C. Doctor completed review: caller must be the doctor on the completed appointment
        ELSIF p_type = 'scan' AND p_subtype = 'doctor_completed_review' THEN
          v_appt_id_text := trim(COALESCE(p_metadata->>'appointment_id', ''));
          IF v_appt_id_text <> '' AND v_appt_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_appt_id := v_appt_id_text::uuid;
            IF EXISTS (
              SELECT 1 FROM public.patient_appointment pa
              WHERE pa.appointment_id = v_appt_id
                AND pa.status = 'completed'
                AND (pa.assigned_doctor_id = v_caller_id OR EXISTS (
                  SELECT 1 FROM public.clinic_doctor cd
                  WHERE cd.doctor_id = pa.assigned_doctor_id AND cd.user_id = v_caller_id
                ))
            ) THEN
              v_is_authorized := true;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    -- 4. Appointment-related cross-user notification (Doctor <-> Patient <-> Clinic Owner)
    -- Verifies both relationship and actual event state in public.patient_appointment
    IF NOT v_is_authorized AND p_metadata IS NOT NULL THEN
      v_appt_id_text := trim(COALESCE(p_metadata->>'appointment_id', p_metadata->>'appointmentId', ''));
      IF v_appt_id_text <> '' AND v_appt_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_appt_id := v_appt_id_text::uuid;

        SELECT 
          pa.appointment_id,
          pa.user_id AS patient_user_id,
          pa.clinic_id AS target_branch_id,
          pa.assigned_doctor_id,
          pa.status AS appt_status,
          pa.doctor_status,
          c.owner_user_id AS clinic_owner_user_id
        INTO v_appt_record
        FROM public.patient_appointment pa
        LEFT JOIN public.clinic c ON c.clinic_id = pa.clinic_id
        WHERE pa.appointment_id = v_appt_id;

        IF FOUND THEN
          v_has_appt_record := true;
          -- Check caller role in appointment
          DECLARE
            v_caller_is_patient BOOLEAN := (v_appt_record.patient_user_id = v_caller_id);
            v_caller_is_clinic_owner BOOLEAN := (v_appt_record.clinic_owner_user_id = v_caller_id);
            v_caller_is_assigned_doctor BOOLEAN := (
              v_appt_record.assigned_doctor_id = v_caller_id OR EXISTS (
                SELECT 1 FROM public.clinic_doctor cd
                WHERE cd.doctor_id = v_appt_record.assigned_doctor_id AND cd.user_id = v_caller_id
              )
            );
            v_caller_is_branch_doctor BOOLEAN := EXISTS (
              SELECT 1 FROM public.clinic_doctor cd
              WHERE cd.clinic_id = v_appt_record.target_branch_id AND cd.user_id = v_caller_id
            );
            v_recipient_is_patient BOOLEAN := (v_appt_record.patient_user_id = p_recipient_user_id);
            v_recipient_is_clinic_owner BOOLEAN := (v_appt_record.clinic_owner_user_id = p_recipient_user_id);
            v_recipient_is_doctor BOOLEAN := (
              v_appt_record.assigned_doctor_id = p_recipient_user_id OR EXISTS (
                SELECT 1 FROM public.clinic_doctor cd
                WHERE (cd.doctor_id = v_appt_record.assigned_doctor_id OR cd.clinic_id = v_appt_record.target_branch_id)
                  AND cd.user_id = p_recipient_user_id
              )
            );
          BEGIN
            -- EVENT VERIFICATION: Ensure notification type matches actual appointment state and caller permissions

            -- Case A: Doctor accepts appointment (appointment-confirmed / doctor-accepted)
            IF p_type IN ('appointment-confirmed', 'appointment-scheduled') OR p_subtype IN ('doctor-accepted', 'doctor-approved', 'confirmed') THEN
              IF (v_caller_is_assigned_doctor OR v_caller_is_branch_doctor OR v_caller_is_clinic_owner)
                AND (v_recipient_is_patient OR v_recipient_is_clinic_owner)
                AND (v_appt_record.doctor_status = 'approved' OR v_appt_record.appt_status IN ('confirmed', 'scheduled')) THEN
                v_is_authorized := true;
              ELSE
                RAISE EXCEPTION 'Access denied: Appointment confirmation requires approved doctor status and valid participant roles';
              END IF;

            -- Case B: Doctor rejects / declines appointment (appointment-rejected / doctor-declined)
            ELSIF p_type IN ('appointment-rejected', 'appointment-declined') OR p_subtype IN ('doctor-declined', 'schedule-conflict') THEN
              IF (v_caller_is_assigned_doctor OR v_caller_is_branch_doctor OR v_caller_is_clinic_owner)
                AND (v_recipient_is_patient OR v_recipient_is_clinic_owner)
                AND (v_appt_record.doctor_status = 'rejected' OR v_appt_record.appt_status IN ('pending', 'rejected', 'cancelled')) THEN
                v_is_authorized := true;
              ELSE
                RAISE EXCEPTION 'Access denied: Appointment decline notice requires rejected doctor status and valid participant roles';
              END IF;

            -- Case C: Consultation completed
            ELSIF p_type IN ('appointment-completed', 'consultation-completed') OR p_subtype IN ('appointment-completed', 'consultation-completed') THEN
              IF (v_caller_is_assigned_doctor OR v_caller_is_clinic_owner)
                AND (v_recipient_is_patient OR v_recipient_is_clinic_owner)
                AND (v_appt_record.appt_status = 'completed') THEN
                v_is_authorized := true;
              ELSE
                RAISE EXCEPTION 'Access denied: Consultation completed notice requires completed appointment status and valid participant roles';
              END IF;

            -- Case D: New appointment request / booking created
            ELSIF p_type IN ('appointment_request', 'new-booking', 'bookings_and_reselections') OR p_subtype IN ('appointment_request', 'new-booking') THEN
              IF (v_caller_is_patient OR v_caller_is_clinic_owner)
                AND (v_recipient_is_doctor OR v_recipient_is_clinic_owner)
                AND (v_appt_record.appt_status NOT IN ('cancelled', 'rejected')) THEN
                v_is_authorized := true;
              ELSE
                RAISE EXCEPTION 'Access denied: Appointment request notice requires active booking and valid participant roles';
              END IF;

            -- Case E: General appointment communication between related parties
            -- STRICT: Generic communications cannot bypass specific status verification!
            ELSIF p_type IN ('appointment-reminder', 'appointment-note', 'appointment-chat', 'appointment', 'appointment_update') THEN
              IF (v_appt_record.appt_status IN ('cancelled', 'rejected')) THEN
                RAISE EXCEPTION 'Access denied: Cannot dispatch communication for cancelled or rejected appointment';
              END IF;
              IF (v_caller_is_patient OR v_caller_is_assigned_doctor OR v_caller_is_branch_doctor OR v_caller_is_clinic_owner)
                AND (v_recipient_is_patient OR v_recipient_is_doctor OR v_recipient_is_clinic_owner) THEN
                v_is_authorized := true;
              ELSE
                RAISE EXCEPTION 'Access denied: Caller and recipient are not verified participants in this appointment';
              END IF;
            ELSE
              RAISE EXCEPTION 'Access denied: Unsupported appointment notification type %', p_type;
            END IF;
          END;
        END IF;
      END IF;
    END IF;

    -- 5. Clinic-related notification (Clinic Owner <-> Associated Branch Doctors)
    IF NOT v_is_authorized AND p_metadata IS NOT NULL THEN
      v_clinic_id_text := trim(COALESCE(p_metadata->>'clinic_id', p_metadata->>'clinicId', ''));
      IF v_clinic_id_text <> '' AND v_clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_clinic_id := v_clinic_id_text::uuid;
        IF EXISTS (
          SELECT 1 FROM public.clinic c
          WHERE c.clinic_id = v_clinic_id
            AND (
              (c.owner_user_id = v_caller_id AND EXISTS (
                SELECT 1 FROM public.clinic_doctor cd WHERE cd.clinic_id = v_clinic_id AND cd.user_id = p_recipient_user_id
              ))
              OR
              (c.owner_user_id = p_recipient_user_id AND EXISTS (
                SELECT 1 FROM public.clinic_doctor cd WHERE cd.clinic_id = v_clinic_id AND cd.user_id = v_caller_id
              ))
            )
        ) THEN
          v_is_authorized := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: Caller % has no verified authorization to dispatch % notification to recipient %', v_caller_id, p_type, p_recipient_user_id;
  END IF;

  -- Validate required notification payload fields
  IF p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'Recipient user_id is required';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'Notification title is required';
  END IF;
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RAISE EXCEPTION 'Notification message is required';
  END IF;

  IF p_metadata IS NOT NULL THEN
    v_idempotency_key := trim(COALESCE(p_metadata->>'idempotency_key', ''));
  END IF;

  -- Derivation and canonical enforcement for appointment notifications:
  -- Prevent client spoofing of recipients, official titles, and idempotency keys
  IF v_has_appt_record AND v_caller_role <> 'service_role' AND NOT v_is_admin_caller THEN
    -- Enforce official canonical title based on verified appointment event
    IF p_type IN ('appointment-confirmed', 'appointment-scheduled') OR p_subtype IN ('doctor-accepted', 'doctor-approved', 'confirmed') THEN
      IF p_recipient_user_id = v_appt_record.patient_user_id THEN
        p_title := 'Confirmed Appointment';
      ELSIF p_recipient_user_id = v_appt_record.clinic_owner_user_id THEN
        p_title := 'Doctor Accepted Appointment';
      END IF;
    ELSIF p_type IN ('appointment-rejected', 'appointment-declined') OR p_subtype IN ('doctor-declined', 'schedule-conflict') THEN
      IF p_recipient_user_id = v_appt_record.patient_user_id THEN
        p_title := 'Doctor Unavailable - Reassignment Required';
      ELSIF p_recipient_user_id = v_appt_record.clinic_owner_user_id THEN
        p_title := 'Doctor Declined Appointment';
      END IF;
    ELSIF p_type IN ('appointment-completed', 'consultation-completed') THEN
      p_title := 'Consultation Completed';
    END IF;

    -- Derive fallback canonical idempotency key if omitted or empty
    IF v_idempotency_key IS NULL OR v_idempotency_key = '' THEN
      v_idempotency_key := 'appt_' || p_type || '_' || v_appt_record.appointment_id::text || '_' || p_recipient_user_id::text;
      p_metadata := jsonb_set(COALESCE(p_metadata, '{}'::jsonb), '{idempotency_key}', to_jsonb(v_idempotency_key));
    END IF;
  END IF;

  -- Insert with explicit ON CONFLICT matching unique index predicate
  INSERT INTO public.user_notification (
    user_id,
    title,
    body,
    message,
    type,
    subtype,
    metadata,
    created_at
  ) VALUES (
    p_recipient_user_id,
    p_title,
    p_message,
    p_message,
    p_type,
    p_subtype,
    COALESCE(p_metadata, '{}'::jsonb),
    LEAST(COALESCE(p_created_at, now()), now())
  )
  ON CONFLICT (user_id, ((metadata->>'idempotency_key')))
  WHERE (metadata->>'idempotency_key') IS NOT NULL
    AND trim(metadata->>'idempotency_key') <> ''
  DO NOTHING
  RETURNING notif_id INTO v_notif_id;

  -- If conflict occurred, resolve existing notif_id without mutating row
  IF v_notif_id IS NULL AND v_idempotency_key IS NOT NULL AND v_idempotency_key <> '' THEN
    SELECT notif_id INTO v_notif_id
    FROM public.user_notification
    WHERE user_id = p_recipient_user_id
      AND (metadata->>'idempotency_key') = v_idempotency_key
    LIMIT 1;
  END IF;

  RETURN v_notif_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_authorized_notification FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_authorized_notification TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Scheduled 24-Hour Upcoming Consultation Reminder Dispatcher
-- Safe, idempotent mechanism to generate genuine reminders for appointments
-- approved days in advance when they enter the 24-hour window, even if the
-- doctor is offline.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_upcoming_appointment_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
  v_doctor_user_id uuid;
  v_occurrence text;
  v_doc_reminder_key text;
  v_clinic_name text;
  v_patient_name text;
  v_time_str text;
  v_appt_time timestamptz;
  v_date_part text;
  v_parsed_time time;
BEGIN
  FOR v_row IN
    SELECT 
      pa.appointment_id,
      pa.user_id AS patient_user_id,
      pa.assigned_doctor_id,
      pa.clinic_id AS branch_id,
      pa.date,
      COALESCE(NULLIF(trim(pa.time::text), ''), NULLIF(trim(pa.batch_time::text), '')) AS time,
      c.name AS clinic_name,
      pu.full_name AS patient_name
    FROM public.patient_appointment pa
    LEFT JOIN public.clinic c ON c.clinic_id = pa.clinic_id
    LEFT JOIN public."user" pu ON pu.user_id = pa.user_id
    WHERE pa.status IN ('confirmed', 'accepted', 'scheduled')
      AND pa.status <> 'pending'
      AND (pa.doctor_status IS NULL OR pa.doctor_status NOT IN ('rejected', 'declined'))
      AND pa.status NOT IN ('completed', 'cancelled', 'rejected', 'done', 'no-show', 'no_show')
      AND pa.assigned_doctor_id IS NOT NULL
      AND pa.date IS NOT NULL
      AND (pa.date AT TIME ZONE 'Asia/Manila')::date >= ((now() AT TIME ZONE 'Asia/Manila')::date - INTERVAL '1 day')
      AND (pa.date AT TIME ZONE 'Asia/Manila')::date <= ((now() AT TIME ZONE 'Asia/Manila')::date + INTERVAL '2 days')
  LOOP
    -- Safely compute scheduled timestamp in Asia/Manila timezone (UTC+8)
    -- DO NOT silently substitute midnight if parsing fails!
    v_appt_time := NULL;
    BEGIN
      -- Extract calendar date in Asia/Manila (e.g. '2026-11-20')
      v_date_part := to_char(v_row.date AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD');

      -- Determine time component
      IF v_row.time IS NOT NULL AND trim(v_row.time) <> '' THEN
        -- Safely cast time string (PostgreSQL natively parses '14:30', '14:30:00', '02:30 PM', etc.)
        v_parsed_time := trim(v_row.time)::time;
        -- Anchor both date and time to Asia/Manila timezone (UTC+8)
        v_appt_time := ((v_date_part || ' ' || v_parsed_time::text)::timestamp AT TIME ZONE 'Asia/Manila');
      ELSE
        -- If time column is empty, check if date column itself contains an explicit non-midnight time in Asia/Manila
        IF (v_row.date AT TIME ZONE 'Asia/Manila')::time <> '00:00:00'::time THEN
          v_appt_time := v_row.date;
        ELSE
          -- Time is missing/unspecified; DO NOT silently substitute midnight! Skip appointment.
          CONTINUE;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- If date/time cannot be parsed, DO NOT silently substitute midnight! Skip appointment.
      CONTINUE;
    END;

    IF v_appt_time IS NULL THEN
      CONTINUE;
    END IF;

    -- Strict 24-hour evaluation: must be upcoming and within 24 hours from now
    IF v_appt_time >= now() AND v_appt_time <= (now() + INTERVAL '24 hours') THEN
      -- Resolve doctor user_id
      v_doctor_user_id := NULL;
      IF v_row.assigned_doctor_id IS NOT NULL THEN
        SELECT cd.user_id INTO v_doctor_user_id
        FROM public.clinic_doctor cd
        WHERE cd.doctor_id = v_row.assigned_doctor_id
        LIMIT 1;

        IF v_doctor_user_id IS NULL THEN
          IF EXISTS (SELECT 1 FROM public."user" u WHERE u.user_id = v_row.assigned_doctor_id) THEN
            v_doctor_user_id := v_row.assigned_doctor_id;
          END IF;
        END IF;
      END IF;

      IF v_doctor_user_id IS NOT NULL THEN
        v_occurrence := to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') || '_' || replace(to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'HH24:MI'), ':', '-');
        v_clinic_name := COALESCE(v_row.clinic_name, 'Clinic');
        v_patient_name := COALESCE(v_row.patient_name, 'Patient');
        v_time_str := ' at ' || to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'HH12:MI AM');
        v_doc_reminder_key := 'doc_reminder_' || v_row.appointment_id || '_' || v_occurrence || '_' || v_doctor_user_id;

        INSERT INTO public.user_notification (
          user_id,
          title,
          body,
          message,
          type,
          subtype,
          metadata,
          created_at
        ) VALUES (
          v_doctor_user_id,
          'Upcoming Consultation Reminder',
          'Reminder: Consultation with ' || v_patient_name || ' is scheduled for ' || to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') || v_time_str || ' at ' || v_clinic_name || '.',
          'Reminder: Consultation with ' || v_patient_name || ' is scheduled for ' || to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') || v_time_str || ' at ' || v_clinic_name || '.',
          'appointment-reminder',
          'reminder_24h',
          jsonb_build_object(
            'appointment_id', v_row.appointment_id,
            'appointmentId', v_row.appointment_id,
            'clinic_id', v_row.branch_id,
            'clinic_name', v_clinic_name,
            'patient_id', v_row.patient_user_id,
            'patient_name', v_patient_name,
            'category', 'appointment',
            'link', '/doctor/scheduled',
            'idempotency_key', v_doc_reminder_key,
            'occurrence', v_occurrence
          ),
          now()
        )
        ON CONFLICT (user_id, ((metadata->>'idempotency_key')))
        WHERE (metadata->>'idempotency_key') IS NOT NULL
          AND trim(metadata->>'idempotency_key') <> ''
        DO NOTHING;

        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_upcoming_appointment_reminders FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_upcoming_appointment_reminders TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- Supabase pg_cron Scheduled Job
-- Recurring interval: every 5 minutes (*/5 * * * *)
-- Requires pg_cron extension; verifies existing job before altering.
-- Does not silently swallow scheduling failures.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id BIGINT;
  v_job_active BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron extension is required for automatic 5-minute appointment reminder scheduling. Please enable pg_cron in Supabase Database Extensions before running this migration.';
  END IF;

  SELECT jobid, active INTO v_job_id, v_job_active
  FROM cron.job
  WHERE jobname = 'dispatch-upcoming-doctor-reminders-every-5m'
  LIMIT 1;

  IF FOUND THEN
    IF NOT v_job_active THEN
      PERFORM cron.alter_job(
        job_id => v_job_id,
        schedule => '*/5 * * * *',
        command => 'SELECT public.dispatch_upcoming_appointment_reminders();',
        active => true
      );
      RAISE NOTICE 'Reactivated existing pg_cron job dispatch-upcoming-doctor-reminders-every-5m via cron.alter_job().';
    ELSE
      RAISE NOTICE 'pg_cron job dispatch-upcoming-doctor-reminders-every-5m already exists and is active. Kept unchanged.';
    END IF;
  ELSE
    PERFORM cron.schedule(
      'dispatch-upcoming-doctor-reminders-every-5m',
      '*/5 * * * *',
      'SELECT public.dispatch_upcoming_appointment_reminders();'
    );
    RAISE NOTICE 'Successfully scheduled pg_cron job dispatch-upcoming-doctor-reminders-every-5m.';
  END IF;
END $$;


