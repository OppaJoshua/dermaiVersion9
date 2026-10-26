-- ============================================================================
-- Migration: Add system_setting table for Admin Preferences & Platform Config
-- ============================================================================

begin;

create table if not exists public.system_setting (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.system_setting enable row level security;

-- Policies
drop policy if exists "Anyone can read system settings" on public.system_setting;
create policy "Anyone can read system settings"
  on public.system_setting for select
  to public
  using (true);

drop policy if exists "Authenticated users can update system settings" on public.system_setting;
create policy "Authenticated users can update system settings"
  on public.system_setting for all
  to authenticated
  using (true)
  with check (true);

-- Seed default preference values if they don't already exist
insert into public.system_setting (key, value, description)
values
  ('email_alerts_new_clinic_applications', 'true'::jsonb, 'Send email notifications to admin when a new clinic registers'),
  ('platform_contact_email', '"dermaisupport@gmail.com"'::jsonb, 'Administrator destination email for platform alerts')
on conflict (key) do nothing;

commit;
