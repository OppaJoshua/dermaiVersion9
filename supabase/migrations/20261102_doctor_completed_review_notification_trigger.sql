-- ============================================================================
-- Migration: Add trigger for admin notification on Doctor Completed Review
-- Dispatches "Doctor Completed Review" notifications under "scan" category
-- only AFTER a doctor completes a consultation and submits a final diagnosis.
-- ============================================================================

begin;

-- Function: create admin notification when doctor completes review in doctor_ai_review
create or replace function public.notify_admin_on_doctor_completed_review()
returns trigger as $$
declare
  v_admin_record record;
  v_doc_name text;
  v_patient_name text;
  v_body text;
  v_metadata jsonb;
begin
  -- 1. Trigger condition: ONLY fire when final_diagnosis is present and non-empty
  if NEW.final_diagnosis is null or trim(NEW.final_diagnosis) = '' then
    return NEW;
  end if;

  -- 2. Format Doctor Name: ensure "Dr. [Doctor Name]" without duplication
  v_doc_name := trim(coalesce(NEW.doctor_name, 'Doctor'));
  if lower(v_doc_name) = 'doctor' then
    v_doc_name := 'Doctor';
  elsif not (v_doc_name ilike 'dr.%' or v_doc_name ilike 'dr %') then
    v_doc_name := 'Dr. ' || v_doc_name;
  end if;

  v_patient_name := coalesce(NEW.patient_name, 'Patient');

  -- 3. Notification Content:
  -- "Dr. [Doctor Name] completed the review for [Patient Name]. Final Diagnosis: [Final Diagnosis]"
  v_body := v_doc_name || ' completed the review for ' || v_patient_name || '. Final Diagnosis: ' || NEW.final_diagnosis;

  v_metadata := jsonb_build_object(
    'appointment_id', NEW.appointment_id,
    'category', 'scan',
    'link', '/admin/doctor-ai-review',
    'doctor_name', v_doc_name,
    'patient_name', v_patient_name,
    'final_diagnosis', NEW.final_diagnosis,
    'ai_prediction', NEW.ai_prediction,
    'confidence', NEW.confidence,
    'priority', 'normal'
  );

  -- 4. Dispatch to all active admin accounts
  for v_admin_record in 
    select user_id from public."user" 
    where role = 'admin' or email = 'dermaisupport@gmail.com'
  loop
    insert into public.user_notification (
      user_id,
      type,
      subtype,
      title,
      body,
      message,
      metadata,
      is_read,
      created_at
    ) values (
      v_admin_record.user_id,
      'scan',
      'doctor_completed_review',
      'Doctor Completed Review',
      v_body,
      v_body,
      v_metadata,
      false,
      now()
    );
  end loop;

  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger on doctor_ai_review
drop trigger if exists trg_notify_admin_on_doctor_completed_review on public.doctor_ai_review;
create trigger trg_notify_admin_on_doctor_completed_review
after insert or update on public.doctor_ai_review
for each row
execute function public.notify_admin_on_doctor_completed_review();

-- Also handle patient_appointment updates (when appointment status is completed with final_diagnosis)
create or replace function public.notify_admin_on_patient_appointment_completed()
returns trigger as $$
declare
  v_admin_record record;
  v_doc_name text;
  v_patient_name text;
  v_diag text;
  v_body text;
  v_metadata jsonb;
begin
  -- Only trigger when status is 'completed' and final_diagnosis / doctor_note diagnosis is provided
  v_diag := coalesce(NEW.final_diagnosis, NEW.doctor_diagnosis);
  if v_diag is null and NEW.doctor_note is not null then
    v_diag := substring(NEW.doctor_note from 'Diagnosis:\s*([^|\n]+)');
    if v_diag is null then
      v_diag := NEW.doctor_note;
    end if;
  end if;

  if NEW.status = 'completed' and v_diag is not null and trim(v_diag) <> '' and coalesce(NEW.doctor_status, '') <> 'pending-review' then
    -- Check if a notification for this appointment was already dispatched to avoid duplicates
    if not exists (
      select 1 from public.user_notification 
      where metadata->>'appointment_id' = NEW.appointment_id::text 
        and subtype = 'doctor_completed_review'
    ) then
      -- Resolve doctor name
      select coalesce(doctor_name, 'Doctor') into v_doc_name
      from public.clinic_doctor
      where doctor_id = NEW.assigned_doctor_id;

      v_doc_name := trim(coalesce(v_doc_name, 'Doctor'));
      if lower(v_doc_name) = 'doctor' then
        v_doc_name := 'Doctor';
      elsif not (v_doc_name ilike 'dr.%' or v_doc_name ilike 'dr %') then
        v_doc_name := 'Dr. ' || v_doc_name;
      end if;

      v_patient_name := coalesce(NEW.patient_name, 'Patient');

      v_body := v_doc_name || ' completed the review for ' || v_patient_name || '. Final Diagnosis: ' || v_diag;

      v_metadata := jsonb_build_object(
        'appointment_id', NEW.appointment_id,
        'category', 'scan',
        'link', '/admin/doctor-ai-review',
        'doctor_name', v_doc_name,
        'patient_name', v_patient_name,
        'final_diagnosis', v_diag,
        'ai_prediction', NEW.ai_condition_name,
        'confidence', NEW.ai_confidence,
        'priority', 'normal'
      );

      for v_admin_record in 
        select user_id from public."user" 
        where role = 'admin' or email = 'dermaisupport@gmail.com'
      loop
        insert into public.user_notification (
          user_id,
          type,
          subtype,
          title,
          body,
          message,
          metadata,
          is_read,
          created_at
        ) values (
          v_admin_record.user_id,
          'scan',
          'doctor_completed_review',
          'Doctor Completed Review',
          v_body,
          v_body,
          v_metadata,
          false,
          now()
        );
      end loop;
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_admin_on_patient_appointment_completed on public.patient_appointment;
create trigger trg_notify_admin_on_patient_appointment_completed
after update on public.patient_appointment
for each row
execute function public.notify_admin_on_patient_appointment_completed();

commit;
