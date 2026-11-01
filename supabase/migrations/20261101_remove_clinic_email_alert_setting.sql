-- Migration: Remove email_alerts_new_clinic_applications from system_setting
begin;

delete from public.system_setting
where key = 'email_alerts_new_clinic_applications';

commit;

