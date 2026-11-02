-- ============================================================================
-- Migration: Add clinic_id to notifications & support Bookings & Reselections RLS
-- Allows reading notifications where auth.uid() matches logged-in user or clinic admin.
-- ============================================================================

-- 1. Ensure clinic_id column and index exist on public.user_notification
ALTER TABLE public.user_notification ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinic(clinic_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_user_notification_clinic_id ON public.user_notification (clinic_id);

-- 2. Ensure RLS is enabled on public.user_notification
ALTER TABLE public.user_notification ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies: Allow reading where auth.uid() matches logged-in user or clinic admin
DROP POLICY IF EXISTS "notif_user_read" ON public.user_notification;
CREATE POLICY "notif_user_read" ON public.user_notification
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      clinic_id IS NOT NULL 
      AND (
        public.is_clinic_owner(clinic_id)
        OR EXISTS (
          SELECT 1 FROM public.clinic c
          WHERE c.clinic_id = user_notification.clinic_id
            AND (
              c.owner_user_id = auth.uid()
              OR (
                c.email IS NOT NULL 
                AND EXISTS (
                  SELECT 1 FROM public."user" u 
                  WHERE u.user_id = auth.uid() 
                    AND lower(trim(u.email)) = lower(trim(c.email))
                )
              )
            )
        )
      )
    )
    OR public.is_admin()
    OR auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "notif_user_update" ON public.user_notification;
CREATE POLICY "notif_user_update" ON public.user_notification
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (clinic_id IS NOT NULL AND public.is_clinic_owner(clinic_id))
    OR public.is_admin()
    OR auth.role() = 'anon'
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (clinic_id IS NOT NULL AND public.is_clinic_owner(clinic_id))
    OR public.is_admin()
    OR auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "notif_insert_auth" ON public.user_notification;
CREATE POLICY "notif_insert_auth" ON public.user_notification
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "notif_user_delete" ON public.user_notification;
CREATE POLICY "notif_user_delete" ON public.user_notification
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR (clinic_id IS NOT NULL AND public.is_clinic_owner(clinic_id))
    OR public.is_admin()
    OR auth.role() = 'anon'
  );

-- 4. Expose public.notifications view with clinic_id & triggers
DO $$
BEGIN
  -- If notifications is a view, recreate it with clinic_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    CREATE OR REPLACE VIEW public.notifications AS
    SELECT 
      notif_id AS id,
      notif_id,
      clinic_id,
      user_id,
      type,
      subtype,
      title,
      body,
      COALESCE(message, body) AS message,
      metadata,
      is_read,
      created_at,
      read_at
    FROM public.user_notification;

    GRANT ALL ON public.notifications TO anon, authenticated, service_role;
  END IF;
END $$;

-- 5. Trigger for inserting directly into notifications view
CREATE OR REPLACE FUNCTION public.handle_insert_notifications_view()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_notification (
    user_id,
    clinic_id,
    type,
    subtype,
    title,
    body,
    message,
    metadata,
    is_read,
    created_at
  ) VALUES (
    COALESCE(NEW.user_id, auth.uid()),
    NEW.clinic_id,
    COALESCE(NEW.type, 'booking_created'),
    NEW.subtype,
    NEW.title,
    COALESCE(NEW.body, NEW.message),
    COALESCE(NEW.message, NEW.body),
    NEW.metadata,
    COALESCE(NEW.is_read, false),
    COALESCE(NEW.created_at, now())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_insert_notifications_view ON public.notifications;
CREATE TRIGGER trg_insert_notifications_view
INSTEAD OF INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.handle_insert_notifications_view();

-- 6. Trigger for updating notifications view (e.g. marking read)
CREATE OR REPLACE FUNCTION public.handle_update_notifications_view()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.user_notification
  SET
    is_read = NEW.is_read,
    read_at = CASE WHEN NEW.is_read AND OLD.is_read = false THEN now() ELSE NEW.read_at END
  WHERE notif_id = OLD.notif_id OR id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_notifications_view ON public.notifications;
CREATE TRIGGER trg_update_notifications_view
INSTEAD OF UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.handle_update_notifications_view();

-- 7. Add publication for realtime updates
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notification;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

