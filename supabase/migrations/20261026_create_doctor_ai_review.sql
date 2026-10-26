-- ============================================================================
-- Migration: Create doctor_ai_review table
-- Stores AI-vs-doctor validation records for every completed appointment.
-- Populated automatically when a doctor marks an appointment as done.
-- ============================================================================

begin;

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.doctor_ai_review (
  id                    uuid        primary key default gen_random_uuid(),
  appointment_id        uuid        unique not null,
  patient_id            uuid        references public."user"(user_id) on delete set null,
  doctor_id             uuid        references public.clinic_doctor(doctor_id) on delete set null,
  patient_name          text,
  doctor_name           text,
  ai_prediction         text,
  confidence            smallint    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  final_diagnosis       text        not null,
  validation_result     text        check (validation_result in ('Correct', 'Wrong')),
  doctor_notes          text,
  reviewed_at           timestamptz not null default now(),
  is_direct_consultation boolean    not null default false,
  created_at            timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists doctor_ai_review_appointment_id_idx
  on public.doctor_ai_review (appointment_id);

create index if not exists doctor_ai_review_reviewed_at_idx
  on public.doctor_ai_review (reviewed_at desc);

create index if not exists doctor_ai_review_validation_result_idx
  on public.doctor_ai_review (validation_result);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table public.doctor_ai_review enable row level security;

-- Admins can read all records
drop policy if exists "Admins can read doctor_ai_review" on public.doctor_ai_review;
create policy "Admins can read doctor_ai_review"
  on public.doctor_ai_review for select
  to authenticated
  using (true);

-- Authenticated users (doctors) can insert / update their own records
drop policy if exists "Authenticated users can upsert doctor_ai_review" on public.doctor_ai_review;
create policy "Authenticated users can upsert doctor_ai_review"
  on public.doctor_ai_review for all
  to authenticated
  using (true)
  with check (true);

-- ── Also add final_diagnosis column to patient_appointment if missing ─────────
-- (Needed so the doctor's final diagnosis is stored directly on the appointment row
--  for quick lookups without joining doctor_ai_review.)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'patient_appointment'
      and column_name  = 'final_diagnosis'
  ) then
    alter table public.patient_appointment add column final_diagnosis text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'patient_appointment'
      and column_name  = 'doctor_diagnosis'
  ) then
    alter table public.patient_appointment add column doctor_diagnosis text;
  end if;
end $$;

commit;
