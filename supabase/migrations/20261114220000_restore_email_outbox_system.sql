-- ============================================================================
-- Migration: 20261114220000_restore_email_outbox_system.sql
-- Target: DermAI MAIN Supabase Project (yxteeadjgavejpiriewj)
-- Purpose: Minimal, isolated restoration of atomic email outbox & idempotency RPCs
--          with mandatory claim fencing token enforcement.
-- ============================================================================

-- 1. Table: public.email_outbox
CREATE TABLE IF NOT EXISTS public.email_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  email_type text NOT NULL,
  recipient_email text NOT NULL,
  user_id uuid REFERENCES public."user"(user_id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.patient_appointment(appointment_id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  claim_token uuid,
  last_attempt_at timestamptz,
  lease_expires_at timestamptz,
  error_details text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON public.email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_idempotency_key ON public.email_outbox(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_email_outbox_appointment_id ON public.email_outbox(appointment_id);

-- 3. Row Level Security
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to email outbox" ON public.email_outbox;
CREATE POLICY "Service role has full access to email outbox"
  ON public.email_outbox
  FOR ALL
  USING (coalesce(auth.role(), '') = 'service_role' OR is_admin())
  WITH CHECK (coalesce(auth.role(), '') = 'service_role' OR is_admin());

-- 4. RPC: claim_email_outbox (Generates & returns unique claim fencing token)
CREATE OR REPLACE FUNCTION public.claim_email_outbox(
  p_idempotency_key text,
  p_email_type text,
  p_recipient_email text,
  p_user_id uuid,
  p_appointment_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_now timestamptz := now();
  v_lease_expiry timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
  v_new_token uuid := gen_random_uuid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Unauthorized: Only service_role or admin can claim outbox tasks.'
    );
  END IF;

  IF p_idempotency_key IS NULL OR p_recipient_email IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Missing required parameters for email outbox claim.'
    );
  END IF;

  -- Step 1: Insert pending record if not present
  INSERT INTO public.email_outbox (
    idempotency_key, email_type, recipient_email, user_id, appointment_id, payload, status
  ) VALUES (
    p_idempotency_key, p_email_type, p_recipient_email, p_user_id, p_appointment_id, p_payload, 'pending'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Step 2: Acquire exclusive row lock
  SELECT * INTO v_row
  FROM public.email_outbox
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  -- Step 3: Skip if already sent
  IF v_row.status = 'sent' THEN
    RETURN jsonb_build_object(
      'success', true,
      'claim_acquired', false,
      'status', 'sent',
      'outbox_id', v_row.outbox_id,
      'message', 'Email has already been sent.'
    );
  END IF;

  -- Step 4: Skip if processing within active lease
  IF v_row.status = 'processing' AND v_row.lease_expires_at IS NOT NULL AND v_row.lease_expires_at > v_now THEN
    RETURN jsonb_build_object(
      'success', true,
      'claim_acquired', false,
      'status', 'processing',
      'outbox_id', v_row.outbox_id,
      'message', 'Email is currently being processed by another worker within lease window.'
    );
  END IF;

  -- Step 5: Dead-letter barrier
  IF (v_row.status = 'failed' OR (v_row.status = 'processing' AND v_row.lease_expires_at IS NOT NULL AND v_row.lease_expires_at <= v_now))
     AND v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.email_outbox
    SET status = 'failed',
        error_details = coalesce(error_details || ' | ', '') || 'Maximum delivery attempts exceeded (' || attempts::text || '/' || max_attempts::text || '). Moved to dead-letter state.',
        lease_expires_at = NULL,
        claim_token = NULL,
        updated_at = v_now
    WHERE outbox_id = v_row.outbox_id;

    RETURN jsonb_build_object(
      'success', false,
      'claim_acquired', false,
      'status', 'failed',
      'outbox_id', v_row.outbox_id,
      'message', 'Maximum delivery attempts exceeded. Moved to failed state.'
    );
  END IF;

  -- Step 6: Acquire claim with fresh fencing token
  UPDATE public.email_outbox
  SET status = 'processing',
      attempts = attempts + 1,
      claim_token = v_new_token,
      last_attempt_at = v_now,
      lease_expires_at = v_lease_expiry,
      updated_at = v_now
  WHERE outbox_id = v_row.outbox_id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_acquired', true,
    'status', 'processing',
    'outbox_id', v_row.outbox_id,
    'claim_token', v_new_token,
    'attempts', v_row.attempts + 1
  );
END;
$$;

-- 5. RPC: finalize_email_outbox (Strict claim token enforcement — no null bypass)
CREATE OR REPLACE FUNCTION public.finalize_email_outbox(
  p_outbox_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_claim_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_current_status text;
  v_rows_affected integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ERR_FORBIDDEN',
      'message', 'Unauthorized: Only service_role or admin can finalize outbox tasks.'
    );
  END IF;

  -- Strict Enforcement: Claim token is mandatory
  IF p_claim_token IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ERR_INVALID_PARAMS',
      'message', 'Missing required claim token for fenced outbox finalization.'
    );
  END IF;

  SELECT status INTO v_current_status
  FROM public.email_outbox
  WHERE outbox_id = p_outbox_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ERR_NOT_FOUND', 'message', 'Outbox task not found.');
  END IF;

  -- Terminal state check: An already 'sent' email can never be overwritten
  IF v_current_status = 'sent' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'sent',
      'message', 'Email is already finalized as sent. State preserved.'
    );
  END IF;

  -- Strict atomic conditional update: requires exact claim_token and status='processing'
  IF p_success THEN
    UPDATE public.email_outbox
    SET status = 'sent',
        sent_at = v_now,
        lease_expires_at = NULL,
        claim_token = NULL,
        error_details = NULL,
        updated_at = v_now
    WHERE outbox_id = p_outbox_id
      AND status = 'processing'
      AND claim_token = p_claim_token;
  ELSE
    UPDATE public.email_outbox
    SET status = 'failed',
        lease_expires_at = NULL,
        claim_token = NULL,
        error_details = p_error,
        updated_at = v_now
    WHERE outbox_id = p_outbox_id
      AND status = 'processing'
      AND claim_token = p_claim_token;
  END IF;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ERR_LEASE_LOST',
      'message', 'Finalization rejected: claim token mismatch, lease expired and claimed by another worker, or task already finalized.'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'status', CASE WHEN p_success THEN 'sent' ELSE 'failed' END);
END;
$$;

-- 6. RPC: claim_next_email_outbox_batch (Dual-route batch claim with fencing tokens)
CREATE OR REPLACE FUNCTION public.claim_next_email_outbox_batch(
  p_batch_size integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_lease_expiry timestamptz := v_now + (p_lease_seconds || ' seconds')::interval;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT is_admin() THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: Only service_role or admin can claim outbox batches.';
  END IF;

  -- Sweep expired processing records reaching max attempts directly to 'failed'
  UPDATE public.email_outbox
  SET status = 'failed',
      error_details = coalesce(error_details || ' | ', '') || 'Processing lease expired after reaching maximum attempts (' || attempts::text || '/' || max_attempts::text || '). Moved to dead-letter state.',
      lease_expires_at = NULL,
      claim_token = NULL,
      updated_at = v_now
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= v_now
    AND attempts >= max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT o.outbox_id
    FROM public.email_outbox o
    LEFT JOIN public.patient_appointment a ON a.appointment_id = o.appointment_id
    WHERE (
      o.status = 'pending'
      OR (o.status = 'failed' AND o.attempts < o.max_attempts)
      OR (o.status = 'processing' AND o.lease_expires_at IS NOT NULL AND o.lease_expires_at <= v_now AND o.attempts < o.max_attempts)
    )
    AND o.status <> 'sent'
    AND (
      -- Route 1: Appointment Receipts (Preserves existing appointment payment guards)
      (
        o.appointment_id IS NOT NULL 
        AND a.appointment_id IS NOT NULL 
        AND a.payment_status = 'paid' 
        AND a.status NOT IN ('cancelled', 'rejected')
      )
      OR
      -- Route 2: Subscription Receipts
      (
        o.appointment_id IS NULL 
        AND o.email_type = 'subscription_payment_receipt'
      )
    )
    ORDER BY o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.email_outbox u
  SET status = 'processing',
      attempts = attempts + 1,
      claim_token = gen_random_uuid(),
      last_attempt_at = v_now,
      lease_expires_at = v_lease_expiry,
      updated_at = v_now
  FROM candidate c
  WHERE u.outbox_id = c.outbox_id
  RETURNING u.*;
END;
$$;

-- 7. Permissions: Restrict execution strictly to service_role
REVOKE ALL ON FUNCTION public.claim_email_outbox(text, text, text, uuid, uuid, jsonb, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(text, text, text, uuid, uuid, jsonb, integer) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_email_outbox(uuid, boolean, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_email_outbox(uuid, boolean, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_next_email_outbox_batch(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_email_outbox_batch(integer, integer) TO service_role;

