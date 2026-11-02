-- ============================================================================
-- Migration: Update 'Alternate Doctor Selected' notification logic & relational join
-- Adds patient_id foreign key, exposes profiles / patients views with
-- first_name, last_name, avatar_url, profile_picture, and routes notifications
-- under bookings_and_reselections.
-- ============================================================================

-- 1. Ensure patient_id column and foreign key on public.user_notification
ALTER TABLE public.user_notification 
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public."user"(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_notification_patient_id ON public.user_notification (patient_id);

-- 2. Expose public.profiles view with first_name, last_name, avatar_url, profile_picture
CREATE OR REPLACE VIEW public.profiles AS 
  SELECT 
    user_id,
    user_id AS patient_id,
    user_id AS id,
    full_name,
    split_part(trim(full_name), ' ', 1) AS first_name,
    nullif(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 1)), '') AS last_name,
    avatar_url,
    avatar_url AS profile_picture,
    email,
    role,
    district,
    district AS municipality,
    address,
    account_status,
    created_at
  FROM public."user";

GRANT SELECT ON public.profiles TO anon, authenticated, service_role;

-- 3. Expose public.patients view with first_name, last_name, avatar_url, profile_picture
CREATE OR REPLACE VIEW public.patients AS 
  SELECT 
    user_id,
    user_id AS patient_id,
    user_id AS id,
    full_name,
    split_part(trim(full_name), ' ', 1) AS first_name,
    nullif(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 1)), '') AS last_name,
    avatar_url,
    avatar_url AS profile_picture,
    email,
    role,
    district,
    address,
    account_status,
    created_at
  FROM public."user"
  WHERE role = 'patient' OR role IS NULL;

GRANT SELECT ON public.patients TO anon, authenticated, service_role;

-- 4. Recreate public.notifications view with patient_id
CREATE OR REPLACE VIEW public.notifications AS
SELECT 
  notif_id AS id,
  notif_id,
  clinic_id,
  user_id,
  patient_id,
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

-- 5. Trigger for inserting directly into notifications view with patient_id
CREATE OR REPLACE FUNCTION public.handle_insert_notifications_view()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_notification (
    user_id,
    clinic_id,
    patient_id,
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
    COALESCE(NEW.patient_id, (NEW.metadata->>'patient_id')::uuid),
    COALESCE(NEW.type, 'bookings_and_reselections'),
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

-- 6. Remediate existing 'Alternate Doctor Selected' notifications
UPDATE public.user_notification
SET 
  type = 'bookings_and_reselections',
  body = REPLACE(body, 'Patient Patient', 'Patient')
WHERE 
  subtype = 'alternate_doctor_selected' 
  OR title = 'Alternate Doctor Selected'
  OR type = 'doctor_actions';

