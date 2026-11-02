-- ============================================================================
-- Migration: Add read_at and id alias to public.user_notification
-- Ensures manual click persistence of notification read state across sessions.
-- ============================================================================

ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS read_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'user_notification' 
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.user_notification ADD COLUMN id uuid;
    UPDATE public.user_notification SET id = notif_id WHERE id IS NULL;
    ALTER TABLE public.user_notification ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;

