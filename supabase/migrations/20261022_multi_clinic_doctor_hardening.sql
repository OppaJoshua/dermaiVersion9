-- Phase 1: Database Hardening
-- 1. Ensure clean affiliations per doctor per clinic
-- (Deletes duplicates keeping the latest row if any exist)
DELETE FROM clinic_doctor a
USING clinic_doctor b
WHERE a.doctor_id < b.doctor_id
  AND a.user_id = b.user_id
  AND a.clinic_id = b.clinic_id
  AND a.user_id IS NOT NULL;

-- 2. Prevent future duplicate affiliations
ALTER TABLE clinic_doctor
  DROP CONSTRAINT IF EXISTS uq_clinic_doctor_user_clinic;

ALTER TABLE clinic_doctor
  ADD CONSTRAINT uq_clinic_doctor_user_clinic UNIQUE (user_id, clinic_id);

-- 3. Speed up affiliation queries by user_id
CREATE INDEX IF NOT EXISTS idx_clinic_doctor_user_id 
  ON clinic_doctor(user_id) 
  WHERE user_id IS NOT NULL;

-- 4. Install Cross-Clinic Collision Prevention Trigger
CREATE OR REPLACE FUNCTION prevent_doctor_cross_clinic_double_booking()
RETURNS TRIGGER AS $$
DECLARE
  v_doctor_user_id uuid;
  v_conflict_count int;
BEGIN
  -- Retrieve doctor's universal user identity
  SELECT user_id INTO v_doctor_user_id 
  FROM clinic_doctor 
  WHERE doctor_id = NEW.assigned_doctor_id;

  -- Verify no active overlapping booking exists at ANY clinic for this doctor
  IF v_doctor_user_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM patient_appointment pa
    JOIN clinic_doctor cd ON cd.doctor_id = pa.assigned_doctor_id
    WHERE cd.user_id = v_doctor_user_id
      AND pa.appointment_id != NEW.appointment_id
      AND pa.date = NEW.date
      AND pa.time = NEW.time
      AND pa.status NOT IN ('cancelled', 'rejected');

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'Doctor is already scheduled for an appointment at another branch at this date and time.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_doctor_cross_booking ON patient_appointment;

CREATE TRIGGER trg_check_doctor_cross_booking
  BEFORE INSERT OR UPDATE OF date, time, assigned_doctor_id, status
  ON patient_appointment
  FOR EACH ROW
  EXECUTE FUNCTION prevent_doctor_cross_clinic_double_booking();
