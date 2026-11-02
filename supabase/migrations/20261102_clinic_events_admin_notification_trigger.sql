-- ============================================================================
-- Migration: Add trigger for admin notification on Clinic Registration / Application
-- Dispatches "New Clinic Application Submitted" notifications under "clinic" category
-- whenever a new clinic registers or submits an application for platform approval.
-- ============================================================================

begin;

-- Function: create admin notification when clinic registers in clinic table
create or replace function public.notify_admin_on_new_clinic_application()
returns trigger as $$
declare
  v_admin_record record;
  v_clinic_name text;
  v_body text;
  v_metadata jsonb;
begin
  -- 1. Trigger condition: fire on INSERT (if status is 'pending', 'submitted', or null)
  -- or on UPDATE when status transitions to 'pending' or 'submitted'
  if TG_OP = 'UPDATE' and OLD.status = NEW.status then
    return NEW;
  end if;

  if NEW.status is not null and NEW.status not in ('pending', 'submitted') then
    return NEW;
  end if;

  v_clinic_name := trim(coalesce(NEW.name, 'New Clinic'));
  if lower(v_clinic_name) not ilike 'clinic %' then
    v_body := 'Clinic ' || v_clinic_name || ' has submitted a new application for platform approval.';
  else
    v_body := v_clinic_name || ' has submitted a new application for platform approval.';
  end if;

  v_metadata := jsonb_build_object(
    'clinic_id', NEW.clinic_id,
    'clinic_name', v_clinic_name,
    'category', 'clinic',
    'link', '/admin/clinic-management',
    'logo_url', NEW.logo_url,
    'priority', 'high'
  );

  -- 2. Dispatch to all active admin accounts
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
      'clinic',
      'new_clinic_application',
      'New Clinic Application Submitted',
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

-- Trigger on clinic
drop trigger if exists trg_notify_admin_on_new_clinic_application on public.clinic;
create trigger trg_notify_admin_on_new_clinic_application
after insert or update on public.clinic
for each row
execute function public.notify_admin_on_new_clinic_application();

commit;

