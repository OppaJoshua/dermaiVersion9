-- ============================================================================
-- Safe Non-Destructive Rollback for Phase A & B Notification Migration
-- Status: PREPARED ONLY (DO NOT EXECUTE WITHOUT APPROVAL)
-- 
-- Guarantees:
--   1. ZERO DESTRUCTIVE OPERATIONS:
--      - NEVER drops public.user_notification.hidden_at column.
--      - Preserves every user's soft-delete status, timestamps, and history.
--      - NEVER drops or deletes any rows in public.user_notification.
--   2. Preserves User Visibility History:
--      - Reverting frontend code (IS_PHASE_A_MIGRATION_DEPLOYED = false) continues
--        to respect hidden notifications via local storage and hidden_at IS NULL filters.
--   3. Safely removes RPC functions if needed without altering underlying table data:
-- ============================================================================

-- Safely unschedule pg_cron job BEFORE removing functions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('dispatch-upcoming-doctor-reminders-every-5m');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Safely remove RPC functions if backend needs to be reverted
DROP FUNCTION IF EXISTS public.dispatch_upcoming_appointment_reminders();
DROP FUNCTION IF EXISTS public.dispatch_authorized_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.get_user_hidden_broadcast_ids();
DROP FUNCTION IF EXISTS public.hide_broadcast_for_user(UUID);
DROP FUNCTION IF EXISTS public.soft_delete_user_notification(UUID);
DROP FUNCTION IF EXISTS public.insert_user_notification_idempotent(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ);

-- Safely remove unique partial index if needed (does not affect any table data)
DROP INDEX IF EXISTS public.idx_user_notification_idempotency;

-- CRITICAL DATA PRESERVATION RULE:
-- We explicitly DO NOT drop the hidden_at column from public.user_notification.
-- Keeping hidden_at and idx_user_notification_hidden_at intact guarantees that users'
-- soft-delete preferences and timestamps are permanently preserved, and previously hidden
-- notifications are never accidentally re-exposed upon rollback.
