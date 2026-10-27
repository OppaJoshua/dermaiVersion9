-- ============================================================================
-- Migration: Fix user_notification RLS policies & support ticket notification payload
-- ============================================================================

-- 1. Ensure columns exist on user_notification
ALTER TABLE public.user_notification ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS subtype varchar(50);
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 2. Ensure RLS policies exist on user_notification so Patients, Doctors, and Clinics can read and receive notifications
DROP POLICY IF EXISTS "notif_user_read" ON public.user_notification;
CREATE POLICY "notif_user_read" ON public.user_notification
  FOR SELECT
  USING (user_id = auth.uid() OR is_admin() OR auth.role() = 'anon');

DROP POLICY IF EXISTS "notif_insert_auth" ON public.user_notification;
CREATE POLICY "notif_insert_auth" ON public.user_notification
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "notif_user_update" ON public.user_notification;
CREATE POLICY "notif_user_update" ON public.user_notification
  FOR UPDATE
  USING (user_id = auth.uid() OR is_admin() OR auth.role() = 'anon')
  WITH CHECK (user_id = auth.uid() OR is_admin() OR auth.role() = 'anon');

DROP POLICY IF EXISTS "notif_user_delete" ON public.user_notification;
CREATE POLICY "notif_user_delete" ON public.user_notification
  FOR DELETE
  USING (user_id = auth.uid() OR is_admin() OR auth.role() = 'anon');

-- 3. Synchronize body and message fields automatically
CREATE OR REPLACE FUNCTION public.sync_user_notification_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.body IS NULL AND NEW.message IS NOT NULL THEN
    NEW.body := NEW.message;
  ELSIF NEW.message IS NULL AND NEW.body IS NOT NULL THEN
    NEW.message := NEW.body;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_notification_fields ON public.user_notification;
CREATE TRIGGER trg_sync_user_notification_fields
BEFORE INSERT OR UPDATE ON public.user_notification
FOR EACH ROW EXECUTE FUNCTION public.sync_user_notification_fields();

-- 4. Expose public.notifications view with INSTEAD OF INSERT trigger
CREATE OR REPLACE VIEW public.notifications AS
SELECT 
  notif_id AS id,
  notif_id,
  user_id,
  type,
  subtype,
  title,
  body,
  COALESCE(message, body) AS message,
  metadata,
  is_read,
  created_at
FROM public.user_notification;

GRANT ALL ON public.notifications TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_insert_notifications_view()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_notification (
    user_id,
    type,
    subtype,
    title,
    body,
    message,
    metadata,
    is_read
  ) VALUES (
    NEW.user_id,
    COALESCE(NEW.type, 'TICKET_UPDATE'),
    NEW.subtype,
    NEW.title,
    COALESCE(NEW.body, NEW.message),
    COALESCE(NEW.message, NEW.body),
    NEW.metadata,
    COALESCE(NEW.is_read, false)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_insert_notifications_view ON public.notifications;
CREATE TRIGGER trg_insert_notifications_view
INSTEAD OF INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.handle_insert_notifications_view();
