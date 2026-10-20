-- ============================================================================
-- DermAI Migration: Patient Questionnaire (Review Only - Optional)
-- Migration ID: 20261019_add_patient_questionnaire.sql
--
-- STATUS: REVIEW ONLY. NOT AUTOMATICALLY APPLIED.
--
-- SCHEMA EVALUATION NOTE:
-- The existing DermAI database schema already includes:
--   1. `ai_scan_result.questionnaire_answers` (JSONB)
--   2. `patient_appointment.questionnaire_answers` (JSONB)
--   3. `ai_skin_answer` table (linked to analysis_id with RLS)
--
-- These existing columns and tables are SUFFICIENT for storing all 15 questionnaire
-- answers, rule-based disease mapping results, and safety alerts.
--
-- This migration script is provided as a non-destructive schema addition ONLY if
-- the project explicitly decides in the future to decouple standalone pre-screenings
-- that have no associated image scan.
-- ============================================================================

create table if not exists patient_questionnaire (
  submission_id       uuid primary key default gen_random_uuid(),
  user_id             uuid not null references "user"(user_id) on delete cascade,
  analysis_id         uuid references ai_scan_result(analysis_id) on delete set null,
  answers             jsonb not null,
  mapping_version     varchar(20) not null default '1.0.0',
  support_results     jsonb not null,
  supporting_findings text[] default array[]::text[],
  safety_alert_level  varchar(20) not null default 'none'
                      check (safety_alert_level in ('none', 'urgent', 'emergency')),
  safety_alert_info   jsonb,
  created_at          timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_patient_questionnaire_user_id on patient_questionnaire (user_id);
create index if not exists idx_patient_questionnaire_analysis_id on patient_questionnaire (analysis_id);
create index if not exists idx_patient_questionnaire_created_at on patient_questionnaire (created_at desc);

-- Enable Row Level Security (RLS)
alter table patient_questionnaire enable row level security;

-- RLS Policies preserving user privacy and clinic/admin access
drop policy if exists "questionnaire_owner_read" on patient_questionnaire;
create policy "questionnaire_owner_read" on patient_questionnaire
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists "questionnaire_owner_insert" on patient_questionnaire;
create policy "questionnaire_owner_insert" on patient_questionnaire
  for insert with check (user_id = auth.uid());

drop policy if exists "questionnaire_owner_delete" on patient_questionnaire;
create policy "questionnaire_owner_delete" on patient_questionnaire
  for delete using (user_id = auth.uid() or is_admin());

drop policy if exists "questionnaire_admin_all" on patient_questionnaire;
create policy "questionnaire_admin_all" on patient_questionnaire
  for all using (is_admin()) with check (is_admin());
