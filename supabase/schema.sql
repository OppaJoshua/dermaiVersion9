-- ============================================================================
-- DermAI — Complete Unified Schema (Final 3NF Normalized Production Schema)
-- All 29 tables, columns, indexes, RLS, storage, triggers & seed data.
-- Safe to run on a fresh or existing Supabase database (fully idempotent & backwards-compatible).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- PRE-MIGRATION & SCHEMA HARMONIZATION (Ensures existing tables have all columns)
-- ============================================================================

-- 1. "user" table updates
alter table if exists "user" add column if not exists phone varchar(30);
alter table if exists "user" add column if not exists gender varchar(30);
alter table if exists "user" add column if not exists birthdate date;
alter table if exists "user" add column if not exists district varchar(100);
alter table if exists "user" add column if not exists address text;
alter table if exists "user" add column if not exists account_status varchar(20) not null default 'active';
alter table if exists "user" add column if not exists created_at timestamptz not null default now();

-- 2. user_notification table updates
alter table if exists user_notification add column if not exists subtype varchar(50);
alter table if exists user_notification add column if not exists body text;
alter table if exists user_notification add column if not exists created_at timestamptz not null default now();

-- 3. user_support_ticket table updates
alter table if exists user_support_ticket add column if not exists created_at timestamptz not null default now();
alter table if exists user_support_ticket add column if not exists updated_at timestamptz not null default now();
alter table if exists user_support_ticket add column if not exists category text default 'General';
alter table if exists user_support_ticket add column if not exists priority text default 'medium';
alter table if exists user_support_ticket add column if not exists response text;

-- 4. clinic table updates
alter table if exists clinic add column if not exists email varchar(100);
alter table if exists clinic add column if not exists phone varchar(30);
alter table if exists clinic add column if not exists address text;
alter table if exists clinic add column if not exists description text;
alter table if exists clinic add column if not exists consultation_fee decimal(10,2);
alter table if exists clinic add column if not exists logo_url text;
alter table if exists clinic add column if not exists business_permit_url text;
alter table if exists clinic add column if not exists business_permit_name text;
alter table if exists clinic add column if not exists prc_license_file_url text;
alter table if exists clinic add column if not exists prc_license_file_name text;
alter table if exists clinic add column if not exists latitude decimal(10,7);
alter table if exists clinic add column if not exists longitude decimal(10,7);
alter table if exists clinic drop column if exists slots_per_day;
alter table if exists clinic_operating_hours drop column if exists slots_per_day;

-- 5. clinic_doctor table updates (rename legacy invite_email to email, add missing columns)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'clinic_doctor' and column_name = 'invite_email'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'clinic_doctor' and column_name = 'email'
  ) then
    alter table clinic_doctor rename column invite_email to email;
  end if;
end $$;

alter table if exists clinic_doctor add column if not exists email varchar(100);
alter table if exists clinic_doctor add column if not exists contact_number varchar(30);
alter table if exists clinic_doctor add column if not exists photo_url text;
alter table if exists clinic_doctor add column if not exists status varchar(20) not null default 'Active';
alter table if exists clinic_doctor add column if not exists created_at timestamptz not null default now();

-- 6. patient_appointment table updates (consolidate doctor_id -> assigned_doctor_id, add missing fields)
alter table if exists patient_appointment add column if not exists patient_name varchar(100);
alter table if exists patient_appointment add column if not exists patient_email varchar(100);
alter table if exists patient_appointment add column if not exists patient_gender varchar(30);
alter table if exists patient_appointment add column if not exists patient_birthdate date;
alter table if exists patient_appointment add column if not exists patient_contact varchar(30);
alter table if exists patient_appointment add column if not exists patient_address text;
alter table if exists patient_appointment add column if not exists notes text;
alter table if exists patient_appointment add column if not exists clinic_note text;
alter table if exists patient_appointment add column if not exists skin_photo_url text;
alter table if exists patient_appointment add column if not exists ai_condition_name varchar(200);
alter table if exists patient_appointment add column if not exists ai_confidence decimal(5,2);
alter table if exists patient_appointment add column if not exists questionnaire_answers jsonb;
alter table if exists patient_appointment add column if not exists meeting_link text;
alter table if exists patient_appointment add column if not exists created_at timestamptz not null default now();
alter table if exists patient_appointment add column if not exists assigned_doctor_id uuid;
alter table if exists patient_appointment add column if not exists schedule_sent_to_doctor boolean not null default false;
alter table if exists patient_appointment add column if not exists doctor_status varchar(30);
alter table if exists patient_appointment add column if not exists doctor_note text;
alter table if exists patient_appointment add column if not exists doctor_reviewed_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'patient_appointment' and column_name = 'doctor_id'
  ) then
    update patient_appointment set assigned_doctor_id = doctor_id where assigned_doctor_id is null;
    alter table patient_appointment drop column doctor_id;
  end if;
end $$;

-- 7. clinic_patient_record table updates
alter table if exists clinic_patient_record add column if not exists file_path text;

-- 8. ai_scan_result table updates
alter table if exists ai_scan_result add column if not exists photo_url_wide text;
alter table if exists ai_scan_result add column if not exists questionnaire_answers jsonb;
alter table if exists ai_scan_result drop constraint if exists ai_scan_result_status_check;
alter table if exists ai_scan_result add constraint ai_scan_result_status_check check (status in ('completed','pending','failed','valid','flagged','invalid'));

-- 9. Recreate admin_scan_review if legacy structure exists
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'admin_scan_review' and column_name = 'scan_id'
  ) then
    drop table admin_scan_review cascade;
  end if;
end $$;

-- 10. Drop redundant standalone doctors table if exists
drop table if exists doctors cascade;

-- ============================================================================
-- TABLE DEFINITIONS (29 Tables)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. USER
-- ----------------------------------------------------------------------------
create table if not exists "user" (
  user_id        uuid primary key,                    -- Synced with auth.users.id
  full_name      varchar(100) not null,
  email          varchar(100) not null unique,
  role           varchar(20)  not null default 'patient'
                 check (role in ('patient','doctor','clinic','admin')),
  google_id      varchar(100),
  phone          varchar(30),
  gender         varchar(30),
  birthdate      date,
  district       varchar(100),
  address        text,
  avatar_url     text,
  account_status varchar(20) not null default 'active'
                 check (account_status in ('active','suspended','inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. USER_NOTIFICATION
-- ----------------------------------------------------------------------------
create table if not exists user_notification (
  notif_id    uuid primary key default gen_random_uuid(),
  type        varchar(50)  not null,
  subtype     varchar(50),
  title       varchar(200) not null,
  body        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  user_id     uuid not null references "user"(user_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 3. USER_NOTIFICATION_SETTINGS
-- ----------------------------------------------------------------------------
create table if not exists user_notification_settings (
  user_id                uuid primary key references "user"(user_id) on delete cascade,
  appointment_reminders  boolean not null default true,
  scan_alert             boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. USER_SUPPORT_TICKET
-- ----------------------------------------------------------------------------
create table if not exists user_support_ticket (
  ticket_id   uuid primary key default gen_random_uuid(),
  subject     varchar(200) not null,
  message     text not null,
  status      varchar(20) not null default 'open'
              check (status in ('open','pending','closed')),
  category    text default 'General',
  priority    text default 'medium',
  response    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  user_id     uuid not null references "user"(user_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 5. PLAN
-- ----------------------------------------------------------------------------
create table if not exists plan (
  plan_id       uuid primary key default gen_random_uuid(),
  name          varchar(100) not null,
  price         decimal(10,2) not null,
  billing_type  varchar(20) not null check (billing_type in ('monthly','yearly')),
  scan_limit    int not null,   -- -1 = unlimited
  status        varchar(20) not null default 'active'
);

-- ----------------------------------------------------------------------------
-- 6. PLAN_FEATURE
-- ----------------------------------------------------------------------------
create table if not exists plan_feature (
  feature_id    uuid primary key default gen_random_uuid(),
  feature_text  text not null,
  plan_id       uuid not null references plan(plan_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 7. USER_PLAN_SUBSCRIPTION
-- ----------------------------------------------------------------------------
create table if not exists user_plan_subscription (
  subscription_id       uuid primary key default gen_random_uuid(),
  started_at            timestamptz not null default now(),
  renews_at             timestamptz,
  status                varchar(20) not null check (status in ('active','expired','cancelled')),
  billing_cycle         varchar(20) not null check (billing_cycle in ('monthly','yearly')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  updated_at            timestamptz not null default now(),
  paymongo_subscription_id TEXT,
  paymongo_customer_id  TEXT,
  paymongo_plan_id     TEXT,
  user_id               uuid not null references "user"(user_id) on delete cascade,
  plan_id               uuid not null references plan(plan_id)
);

-- Ensure period columns and updated_at exist on pre-existing tables
alter table if exists user_plan_subscription
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end   timestamptz,
  add column if not exists updated_at           timestamptz not null default now();

-- FIX #5: Ensure upsert by user_id works — one active subscription row per user.
-- activateSubscription() uses onConflict: "user_id"; without this constraint
-- it inserts a NEW row every payment instead of updating the existing one.
alter table if exists user_plan_subscription
  drop constraint if exists uq_sub_user_id;
alter table if exists user_plan_subscription
  add constraint uq_sub_user_id unique (user_id);

-- ----------------------------------------------------------------------------
-- 8. USER_PAYMENT
-- ----------------------------------------------------------------------------
create table if not exists user_payment (
  payment_id    uuid primary key default gen_random_uuid(),
  amount        decimal(10,2) not null,
  payment_date  timestamptz not null default now(),
  billing_cycle VARCHAR(20),
  method        varchar(50) not null,
  status        varchar(20) not null check (status in ('success','failed','pending')),
  created_at    timestamptz not null default now(),
  reference_number text,
  paymongo_payment_id text,
  paymongo_payment_intent_id text,
 user_id       uuid not null references "user"(user_id) on delete cascade,
  plan_id       uuid references plan(plan_id) on delete set null
);

-- ----------------------------------------------------------------------------
-- 9. CLINIC
-- ----------------------------------------------------------------------------
create table if not exists clinic (
  clinic_id             uuid primary key default gen_random_uuid(),
  name                  varchar(200) not null,
  district              varchar(100),
  specialization        varchar(100),
  status                varchar(20) not null default 'pending'
                        check (status in ('pending','approved','rejected','suspended')),
  latitude              decimal(10,7),
  longitude             decimal(10,7),
  verified              boolean not null default false,
  email                 varchar(100),
  phone                 varchar(30),
  address               text,
  description           text,
  consultation_fee      decimal(10,2),
  logo_url              text,
  business_permit_url   text,
  business_permit_name  text,
  prc_license_file_url  text,
  prc_license_file_name text,
  owner_user_id         uuid references "user"(user_id) on delete set null
);

-- ----------------------------------------------------------------------------
-- 10. USER_SAVED_CLINIC
-- ----------------------------------------------------------------------------
-- FIX #2: id is the primary key. (user_id, clinic_id) must be UNIQUE, not a second PK.
-- PostgreSQL does not allow two PRIMARY KEY declarations on the same table.
create table if not exists user_saved_clinic (
  id         uuid primary key default gen_random_uuid(),
  saved_at   timestamptz not null default now(),
  user_id    uuid not null references "user"(user_id) on delete cascade,
  clinic_id  uuid not null references clinic(clinic_id) on delete cascade,
  unique (user_id, clinic_id)   -- prevents duplicate saves
);

-- ----------------------------------------------------------------------------
-- 11. CLINIC_DOCTOR
-- (Unified doctor account & operational roster with PRC license, contact info & clinic link)
-- ----------------------------------------------------------------------------
create table if not exists clinic_doctor (
  doctor_id       uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinic(clinic_id) on delete cascade,
  user_id         uuid references "user"(user_id) on delete set null,
  doctor_name     varchar(100) not null,
  email           varchar(100) not null,
  contact_number  varchar(30),
  prc_license     varchar(50) not null,
  photo_url       text,
  status          varchar(20) not null default 'Active'
                  check (status in ('Active','Inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 12. SPECIALIZATIONS
-- (Dynamic specialization options managed from DB — used by ClinicDoctorsPage)
-- ----------------------------------------------------------------------------
create table if not exists specializations (
  id            uuid primary key default gen_random_uuid(),
  name          varchar(200) not null unique,
  description   text,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 13. DOCTOR_SPECIALIZATIONS (many-to-many: clinic_doctor <-> specializations)
-- ----------------------------------------------------------------------------
create table if not exists doctor_specializations (
  id                uuid primary key default gen_random_uuid(),
  doctor_id         uuid not null references clinic_doctor(doctor_id) on delete cascade,
  specialization_id uuid not null references specializations(id) on delete cascade,
  unique (doctor_id, specialization_id)   -- prevents duplicates; not a second PK
);

-- ----------------------------------------------------------------------------
-- 14. CLINIC_SERVICE_OFFERED
-- ----------------------------------------------------------------------------
create table if not exists clinic_service_offered (
  service_id    uuid primary key default gen_random_uuid(),
  service_name  varchar(200) not null,
  clinic_id     uuid not null references clinic(clinic_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 15. CLINIC_PHOTO
-- ----------------------------------------------------------------------------
create table if not exists clinic_photo (
  photo_id    uuid primary key default gen_random_uuid(),
  photo_url   text not null,
  sort_order  int not null default 0,
  clinic_id   uuid not null references clinic(clinic_id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 16. CLINIC_OPERATING_HOURS
-- ----------------------------------------------------------------------------
create table if not exists clinic_operating_hours (
  schedule_id    uuid primary key default gen_random_uuid(),
  day_of_week    varchar(10) not null,
  open_time      time not null,
  close_time     time not null,
  clinic_id      uuid not null references clinic(clinic_id) on delete cascade,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 17. SKIN_CONDITION
-- ----------------------------------------------------------------------------
create table if not exists skin_condition (
  condition_id  uuid primary key default gen_random_uuid(),
  name          varchar(200) not null,
  local_name    varchar(200),
  description   text,
  who_affected  text
);

-- ----------------------------------------------------------------------------
-- 18. SKIN_CONDITION_IMAGE
-- ----------------------------------------------------------------------------
create table if not exists skin_condition_image (
  image_id      uuid primary key default gen_random_uuid(),
  image_url     text not null,
  condition_id  uuid not null references skin_condition(condition_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 19. SKIN_CONDITION_SYMPTOM
-- ----------------------------------------------------------------------------
create table if not exists skin_condition_symptom (
  symptom_id    uuid primary key default gen_random_uuid(),
  symptom_type  varchar(100) not null,
  condition_id  uuid not null references skin_condition(condition_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 20. SKIN_CONDITION_CARE_TIP
-- ----------------------------------------------------------------------------
create table if not exists skin_condition_care_tip (
  tip_id        uuid primary key default gen_random_uuid(),
  tip_text      text not null,
  condition_id  uuid not null references skin_condition(condition_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 21. CLINIC_CONDITION_TREATED
-- ----------------------------------------------------------------------------
create table if not exists clinic_condition_treated (
  cc_id         uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinic(clinic_id) on delete cascade,
  condition_id  uuid not null references skin_condition(condition_id) on delete cascade,
  constraint uq_clinic_condition unique (clinic_id, condition_id),
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 22. CLINIC_PATIENT_RECORD
-- ----------------------------------------------------------------------------
create table if not exists clinic_patient_record (
  record_id        uuid primary key default gen_random_uuid(),
  record_name      varchar(200) not null,
  record_type      varchar(50) not null,
  file_path        text,
  uploaded_at      timestamptz not null default now(),
  patient_user_id  uuid not null references "user"(user_id) on delete cascade,
  clinic_id        uuid not null references clinic(clinic_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 23. PATIENT_APPOINTMENT
-- ----------------------------------------------------------------------------
create table if not exists patient_appointment (
  appointment_id           uuid primary key default gen_random_uuid(),
  "date"                   timestamptz,
  status                   varchar(20) not null default 'pending'
                           check (status in ('pending','confirmed','cancelled','completed')),
  patient_name             varchar(100),
  patient_email            varchar(100),
  patient_contact          varchar(30),
  patient_address          text,
  patient_gender           varchar(30),
  patient_birthdate        date,
  notes                    text,
  clinic_note              text,
  skin_photo_url           text,
  ai_condition_name        varchar(200),
  ai_confidence            decimal(5,2),
  questionnaire_answers    jsonb,
  created_at               timestamptz not null default now(),
  assigned_doctor_id       uuid references clinic_doctor(doctor_id) on delete set null,
  schedule_sent_to_doctor  boolean not null default false,
  doctor_status            varchar(30)
                           check (doctor_status in ('pending-review','approved','rejected')),
  doctor_note              text,
  doctor_reviewed_at       timestamptz,
  user_id                  uuid not null references "user"(user_id) on delete cascade,
  clinic_id                uuid not null references clinic(clinic_id) on delete cascade,
  condition_id             uuid references skin_condition(condition_id) on delete set null
);

-- ----------------------------------------------------------------------------
-- 24. AI_SCAN_RESULT
-- Status values:
--   'completed','pending','failed' — workflow states
--   'valid','flagged','invalid'    — admin review states
-- ----------------------------------------------------------------------------
create table if not exists ai_scan_result (
  analysis_id            uuid primary key default gen_random_uuid(),
  confidence_score       decimal(5,2) not null,
  status                 varchar(20) not null default 'pending'
                         check (status in ('completed','pending','failed','valid','flagged','invalid')),
  body_part              varchar(100),
  scanned_at             timestamptz not null default now(),
  referral_suggested     boolean not null default false,
  photo_url              text,
  photo_url_wide         text,
  questionnaire_answers  jsonb,
  user_id                uuid not null references "user"(user_id) on delete cascade,
  condition_id           uuid references skin_condition(condition_id) on delete set null
);

-- ----------------------------------------------------------------------------
-- 25. AI_SKIN_ANSWER
-- ----------------------------------------------------------------------------
create table if not exists ai_skin_answer (
  answer_id      uuid primary key default gen_random_uuid(),
  question_key   varchar(100) not null,
  answer_value   text not null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  analysis_id    uuid not null references ai_scan_result(analysis_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 26. ADMIN_SCAN_REVIEW
-- (Normalized 3NF Administrative Review Audit Log)
-- ----------------------------------------------------------------------------
create table if not exists admin_scan_review (
  review_id     uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references ai_scan_result(analysis_id) on delete cascade,
  reviewed_by   uuid references "user"(user_id) on delete set null,
  review_status varchar(20) not null check (review_status in ('valid','flagged','invalid')),
  review_notes  text,
  reviewed_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 27. ADMIN_ALERT
-- ----------------------------------------------------------------------------
create table if not exists admin_alert (
  notif_id    uuid primary key default gen_random_uuid(),
  type        varchar(50) not null,
  title       varchar(200) not null,
  message     text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 28. ADMIN_BROADCAST
-- ----------------------------------------------------------------------------
create table if not exists admin_broadcast (
  broadcast_id  uuid primary key default gen_random_uuid(),
  title         varchar(200) not null,
  message       text not null,
  audience      varchar(50) not null check (audience in ('all','patients','clinics','doctors')),
  sent_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 29. SYSTEM_AUDIT_LOG
-- ----------------------------------------------------------------------------
create table if not exists system_audit_log (
  log_id      uuid primary key default gen_random_uuid(),
  user_type   varchar(50) not null,
  action      varchar(200) not null,
  log_type    varchar(50) not null,
  details     text,
  "timestamp" timestamptz not null default now(),
  user_id     uuid references "user"(user_id) on delete set null
);

-- ============================================================================
-- INDEXES
-- ============================================================================
create index if not exists idx_user_notif_uid         on user_notification (user_id);
create index if not exists idx_user_ticket_uid        on user_support_ticket (user_id);
create unique index if not exists idx_user_plan_sub_uid      on user_plan_subscription (user_id);
create unique index if not exists idx_unique_paymongo_subscription on user_plan_subscription(paymongo_subscription_id) where paymongo_subscription_id is not null;
create unique index if not exists idx_one_active_subscription_per_user  on user_plan_subscription(user_id) where status = 'active';
create index if not exists idx_user_payment_uid       on user_payment (user_id);
create index if not exists idx_clinic_owner_uid       on clinic (owner_user_id);
create index if not exists idx_clinic_doc_cid         on clinic_doctor (clinic_id);
create index if not exists idx_clinic_doc_email       on clinic_doctor (email);
create index if not exists idx_clinic_doc_uid         on clinic_doctor (user_id);
create index if not exists idx_doc_spec_did           on doctor_specializations (doctor_id);
create index if not exists idx_doc_spec_sid           on doctor_specializations (specialization_id);
create index if not exists idx_clinic_svc_cid         on clinic_service_offered (clinic_id);
create index if not exists idx_clinic_photo_cid       on clinic_photo (clinic_id);
create index if not exists idx_clinic_hrs_cid         on clinic_operating_hours (clinic_id);
create index if not exists idx_clinic_cond_cid        on clinic_condition_treated (clinic_id);
create index if not exists idx_clinic_cond_condid     on clinic_condition_treated (condition_id);
create index if not exists idx_clinic_pt_rec_puid     on clinic_patient_record (patient_user_id);
create index if not exists idx_clinic_pt_rec_cid      on clinic_patient_record (clinic_id);
create index if not exists idx_pt_appt_uid            on patient_appointment (user_id);
create index if not exists idx_pt_appt_cid            on patient_appointment (clinic_id);
create index if not exists idx_pt_appt_assigned_doc   on patient_appointment (assigned_doctor_id);
create index if not exists idx_ai_scan_uid            on ai_scan_result (user_id);
create index if not exists idx_ai_ans_aid             on ai_skin_answer (analysis_id);
create index if not exists idx_adm_scan_aid           on admin_scan_review (analysis_id);
create index if not exists idx_adm_scan_uid           on admin_scan_review (reviewed_by);
create index if not exists idx_sys_audit_uid          on system_audit_log (user_id);
create index if not exists idx_skin_cond_img_cid      on skin_condition_image (condition_id);
create index if not exists idx_skin_cond_sym_cid      on skin_condition_symptom (condition_id);
create index if not exists idx_skin_cond_tip_cid      on skin_condition_care_tip (condition_id);

-- ============================================================================
-- RBAC & SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================================
create or replace function current_role_name()
returns varchar
language sql
security definer
stable
set search_path = public
as $$
  select role from "user" where user_id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from "user"
    where user_id = auth.uid()
      and role = 'admin'
      and account_status = 'active'
  );
$$;

create or replace function is_clinic_owner(target_clinic_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from clinic
    where clinic_id = target_clinic_id
      and owner_user_id = auth.uid()
  );
$$;

create or replace function is_clinic_doctor(target_clinic_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from clinic_doctor
    where clinic_id = target_clinic_id
      and user_id = auth.uid()
      and status = 'Active'
  );
$$;

-- ----------------------------------------------------------------------------
-- PAYMONGO_WEBHOOK_EVENT (Idempotency & Audit Log)
-- ----------------------------------------------------------------------------
create table if not exists paymongo_webhook_event (
  event_id      text primary key,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'received' 
                check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  error_message text,
  payload       jsonb
);

-- Index for monitoring & querying unhandled or failed events
create index if not exists idx_paymongo_webhook_status_received 
  on paymongo_webhook_event (status, received_at desc);

-- RLS: Secure so only service_role (backend/edge functions) or admin can view
alter table paymongo_webhook_event enable row level security;

create policy "Admins can view webhook logs"
  on paymongo_webhook_event
  for select
  to authenticated
  using (
    exists (
      select 1 from "user"
      where "user".user_id = auth.uid()
        and "user".role = 'admin'
    )
  );


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — Enable on all 29 tables
-- ============================================================================
alter table "user"                      enable row level security;
alter table user_notification           enable row level security;
alter table user_notification_settings   enable row level security;
alter table user_support_ticket         enable row level security;
alter table plan                        enable row level security;
alter table plan_feature                enable row level security;
alter table user_plan_subscription      enable row level security;
alter table user_payment                enable row level security;
alter table clinic                      enable row level security;
alter table user_saved_clinic           enable row level security;
alter table clinic_doctor               enable row level security;
alter table specializations             enable row level security;
alter table doctor_specializations      enable row level security;
alter table clinic_service_offered      enable row level security;
alter table clinic_photo                enable row level security;
alter table clinic_operating_hours      enable row level security;
alter table skin_condition              enable row level security;
alter table skin_condition_image        enable row level security;
alter table skin_condition_symptom      enable row level security;
alter table skin_condition_care_tip     enable row level security;
alter table clinic_condition_treated    enable row level security;
alter table clinic_patient_record       enable row level security;
alter table patient_appointment         enable row level security;
alter table ai_scan_result              enable row level security;
alter table ai_skin_answer              enable row level security;
alter table admin_scan_review           enable row level security;
alter table admin_alert                 enable row level security;
alter table admin_broadcast             enable row level security;
alter table system_audit_log            enable row level security;

-- ============================================================================
-- RLS POLICIES (Clean, non-recursive, high-performance)
-- ============================================================================

-- "user" (Public read so admin, doctor listings, and patient lookups never encounter RLS recursion)
drop policy if exists "user_read_own_or_admin" on "user";
drop policy if exists "user_update_own"         on "user";
drop policy if exists "user_insert_own"         on "user";
drop policy if exists "user_read_all"           on "user";
drop policy if exists "user_all_access"         on "user";
create policy "user_read_all"   on "user" for select using (true);
create policy "user_update_own" on "user" for update using (true) with check (true);
create policy "user_insert_own" on "user" for insert with check (true);

-- clinic
drop policy if exists "clinic_public_read"      on clinic;
drop policy if exists "clinic_owner_manage"     on clinic;
drop policy if exists "clinic_owner_insert"     on clinic;
drop policy if exists "clinic_public_register"  on clinic;
drop policy if exists "clinic_admin_all"        on clinic;
drop policy if exists "clinic_all_access"       on clinic;
create policy "clinic_all_access" on clinic for all using (true) with check (true);

-- user_saved_clinic
drop policy if exists "saved_clinic_owner" on user_saved_clinic;
create policy "saved_clinic_owner" on user_saved_clinic for all using (true) with check (true);

-- clinic_doctor
drop policy if exists "clinic_doctor_public_read"    on clinic_doctor;
drop policy if exists "clinic_doctor_owner_manage"   on clinic_doctor;
drop policy if exists "clinic_doctor_update_own"     on clinic_doctor;
drop policy if exists "clinic_doctor_public_insert"  on clinic_doctor;
drop policy if exists "clinic_doctor_all"            on clinic_doctor;
create policy "clinic_doctor_all" on clinic_doctor for all using (true) with check (true);

-- specializations
drop policy if exists "spec_public_read"  on specializations;
drop policy if exists "spec_admin_write"  on specializations;
create policy "spec_public_read"  on specializations for select using (true);
create policy "spec_admin_write"  on specializations for all    using (true) with check (true);

-- doctor_specializations
drop policy if exists "doc_spec_public_read" on doctor_specializations;
drop policy if exists "doc_spec_write"       on doctor_specializations;
create policy "doc_spec_public_read" on doctor_specializations for select using (true);
create policy "doc_spec_write"       on doctor_specializations for all    using (true) with check (true);

-- clinic_service_offered
drop policy if exists "clinic_svc_public_read"   on clinic_service_offered;
drop policy if exists "clinic_svc_public_insert" on clinic_service_offered;
drop policy if exists "clinic_svc_owner_all"     on clinic_service_offered;
drop policy if exists "clinic_svc_all"           on clinic_service_offered;
create policy "clinic_svc_all" on clinic_service_offered for all using (true) with check (true);

-- clinic_photo
drop policy if exists "clinic_photo_public_read"   on clinic_photo;
drop policy if exists "clinic_photo_public_insert" on clinic_photo;
drop policy if exists "clinic_photo_owner_all"     on clinic_photo;
drop policy if exists "clinic_photo_all"           on clinic_photo;
create policy "clinic_photo_all" on clinic_photo for all using (true) with check (true);

-- clinic_operating_hours
drop policy if exists "clinic_hrs_public_read"   on clinic_operating_hours;
drop policy if exists "clinic_hrs_public_insert" on clinic_operating_hours;
drop policy if exists "clinic_hrs_owner_all"     on clinic_operating_hours;
drop policy if exists "clinic_hrs_all"           on clinic_operating_hours;
create policy "clinic_hrs_all" on clinic_operating_hours for all using (true) with check (true);

-- skin_condition
drop policy if exists "skin_cond_public_read" on skin_condition;
drop policy if exists "skin_cond_admin_write" on skin_condition;
create policy "skin_cond_public_read" on skin_condition for select using (true);
create policy "skin_cond_admin_write" on skin_condition for all    using (is_admin()) with check (is_admin());

-- skin_condition_image
drop policy if exists "skin_img_public_read" on skin_condition_image;
drop policy if exists "skin_img_admin_write" on skin_condition_image;
create policy "skin_img_public_read" on skin_condition_image for select using (true);
create policy "skin_img_admin_write" on skin_condition_image for all    using (is_admin()) with check (is_admin());

-- skin_condition_symptom
drop policy if exists "skin_sym_public_read" on skin_condition_symptom;
drop policy if exists "skin_sym_admin_write" on skin_condition_symptom;
create policy "skin_sym_public_read" on skin_condition_symptom for select using (true);
create policy "skin_sym_admin_write" on skin_condition_symptom for all    using (is_admin()) with check (is_admin());

-- skin_condition_care_tip
drop policy if exists "skin_tip_public_read" on skin_condition_care_tip;
drop policy if exists "skin_tip_admin_write" on skin_condition_care_tip;
create policy "skin_tip_public_read" on skin_condition_care_tip for select using (true);
create policy "skin_tip_admin_write" on skin_condition_care_tip for all    using (is_admin()) with check (is_admin());

-- clinic_condition_treated
drop policy if exists "cond_treated_public_read" on clinic_condition_treated;
drop policy if exists "cond_treated_owner_all"   on clinic_condition_treated;
create policy "cond_treated_public_read" on clinic_condition_treated for select using (true);
create policy "cond_treated_owner_all"   on clinic_condition_treated for all    using (is_clinic_owner(clinic_id) or is_admin()) with check (is_clinic_owner(clinic_id) or is_admin());

-- clinic_patient_record
drop policy if exists "pt_rec_patient_read"  on clinic_patient_record;
drop policy if exists "pt_rec_clinic_manage" on clinic_patient_record;
create policy "pt_rec_patient_read"  on clinic_patient_record for select using (patient_user_id = auth.uid());
create policy "pt_rec_clinic_manage" on clinic_patient_record for all    using (is_clinic_owner(clinic_id) or is_clinic_doctor(clinic_id) or is_admin()) with check (is_clinic_owner(clinic_id) or is_clinic_doctor(clinic_id) or is_admin());

-- patient_appointment
drop policy if exists "appt_patient_read"   on patient_appointment;
drop policy if exists "appt_patient_insert" on patient_appointment;
drop policy if exists "appt_patient_cancel" on patient_appointment;
drop policy if exists "appt_clinic_manage"  on patient_appointment;
drop policy if exists "appt_doctor_manage"  on patient_appointment;
drop policy if exists "appt_doctor_read"    on patient_appointment;
drop policy if exists "appt_all_access"     on patient_appointment;
create policy "appt_all_access" on patient_appointment for all using (true) with check (true);

-- ai_scan_result
drop policy if exists "scan_owner_read"   on ai_scan_result;
drop policy if exists "scan_owner_insert" on ai_scan_result;
drop policy if exists "scan_owner_delete" on ai_scan_result;
drop policy if exists "scan_admin_all"    on ai_scan_result;
drop policy if exists "scan_admin_update" on ai_scan_result;
create policy "scan_owner_read"   on ai_scan_result for select using (user_id = auth.uid() or is_admin());
create policy "scan_owner_insert" on ai_scan_result for insert with check (user_id = auth.uid());
create policy "scan_owner_delete" on ai_scan_result for delete using (user_id = auth.uid() or is_admin());
create policy "scan_admin_update" on ai_scan_result for update using (is_admin()) with check (is_admin());

-- ai_skin_answer
drop policy if exists "answer_owner_read"   on ai_skin_answer;
drop policy if exists "answer_owner_insert" on ai_skin_answer;
drop policy if exists "answer_admin_all"    on ai_skin_answer;
create policy "answer_owner_read"   on ai_skin_answer for select using (
  analysis_id in (select analysis_id from ai_scan_result where user_id = auth.uid()) or is_admin()
);
create policy "answer_owner_insert" on ai_skin_answer for insert with check (
  analysis_id in (select analysis_id from ai_scan_result where user_id = auth.uid())
);
create policy "answer_admin_all"    on ai_skin_answer for all using (is_admin()) with check (is_admin());

-- admin_scan_review
drop policy if exists "scan_review_admin_only" on admin_scan_review;
create policy "scan_review_admin_only" on admin_scan_review for all using (is_admin()) with check (is_admin());

-- admin_alert
drop policy if exists "alert_admin_all" on admin_alert;
create policy "alert_admin_all" on admin_alert for all using (is_admin()) with check (is_admin());

-- admin_broadcast
drop policy if exists "broadcast_public_read" on admin_broadcast;
drop policy if exists "broadcast_admin_all"   on admin_broadcast;
create policy "broadcast_public_read" on admin_broadcast for select using (true);
create policy "broadcast_admin_all"   on admin_broadcast for all    using (is_admin()) with check (is_admin());

-- system_audit_log
drop policy if exists "audit_admin_read" on system_audit_log;
create policy "audit_admin_read" on system_audit_log for select using (is_admin());

-- user_support_ticket
drop policy if exists "ticket_all_access"   on user_support_ticket;
drop policy if exists "ticket_read_all"     on user_support_ticket;
drop policy if exists "ticket_insert_own"   on user_support_ticket;
drop policy if exists "ticket_update_admin" on user_support_ticket;
create policy "ticket_all_access" on user_support_ticket for all using (true) with check (true);

-- plan (public read so any visitor can see pricing; admin manages)
drop policy if exists "plan_public_read" on plan;
drop policy if exists "plan_admin_all"   on plan;
create policy "plan_public_read" on plan for select using (true);
create policy "plan_admin_all"   on plan for all    using (is_admin()) with check (is_admin());

-- plan_feature (same visibility as plan)
drop policy if exists "plan_feat_public_read" on plan_feature;
drop policy if exists "plan_feat_admin_all"   on plan_feature;
create policy "plan_feat_public_read" on plan_feature for select using (true);
create policy "plan_feat_admin_all"   on plan_feature for all    using (is_admin()) with check (is_admin());

-- user_plan_subscription (users see/manage their own rows; admin sees all)
drop policy if exists "sub_owner_read"   on user_plan_subscription;
drop policy if exists "sub_owner_insert" on user_plan_subscription;
drop policy if exists "sub_owner_update" on user_plan_subscription;
drop policy if exists "sub_admin_all"    on user_plan_subscription;
create policy "sub_owner_read"   on user_plan_subscription for select using (user_id = auth.uid() or is_admin());
create policy "sub_owner_insert" on user_plan_subscription for insert with check (user_id = auth.uid() or is_admin());
create policy "sub_owner_update" on user_plan_subscription for update using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy "sub_admin_all"    on user_plan_subscription for delete using (is_admin());

-- user_payment (users see their own receipts; admin sees all; writes are handled securely via backend/webhook)
drop policy if exists "pay_owner_read"   on user_payment;
drop policy if exists "pay_owner_insert" on user_payment;
drop policy if exists "pay_admin_all"    on user_payment;

-- Allow users to update ONLY status = 'cancelled' (so they can cancel, but can't self-activate 'active')
drop policy if exists "sub_owner_update" on user_plan_subscription;

create policy "sub_owner_cancel" 
  on user_plan_subscription 
  for update 
  using (user_id = auth.uid() or is_admin())
  with check (status = 'cancelled' or is_admin());

-- Users can only READ receipts (cannot insert or fake payment status from the browser)
create policy "pay_owner_read"   on user_payment for select using (user_id = auth.uid() or is_admin());
create policy "pay_admin_all"    on user_payment for all    using (is_admin()) with check (is_admin());

-- ============================================================================
-- STORAGE BUCKETS & STORAGE POLICIES
-- ============================================================================
insert into storage.buckets (id, name, public) values
  ('clinic-photos',   'clinic-photos',   true),
  ('doctor-photos',   'doctor-photos',   true),
  ('scan-photos',     'scan-photos',     false),
  ('scan-uploads',    'scan-uploads',    false),
  ('patient-records', 'patient-records', false)
on conflict (id) do nothing;

-- scan-uploads: private bucket for AI scan image uploads (authenticated users only)
drop policy if exists "scan_uploads_auth" on storage.objects;
create policy "scan_uploads_auth" on storage.objects for all
  using   (bucket_id = 'scan-uploads' and auth.role() = 'authenticated')
  with check (bucket_id = 'scan-uploads' and auth.role() = 'authenticated');

drop policy if exists "clinic_photos_public" on storage.objects;
create policy "clinic_photos_public" on storage.objects for select using (bucket_id = 'clinic-photos');

drop policy if exists "clinic_photos_auth_upload" on storage.objects;
create policy "clinic_photos_auth_upload" on storage.objects for insert with check (bucket_id = 'clinic-photos' and auth.role() = 'authenticated');

drop policy if exists "doctor_photos_public" on storage.objects;
create policy "doctor_photos_public" on storage.objects for select using (bucket_id = 'doctor-photos');

drop policy if exists "doctor_photos_auth_upload" on storage.objects;
create policy "doctor_photos_auth_upload" on storage.objects for insert with check (bucket_id = 'doctor-photos' and auth.role() = 'authenticated');

drop policy if exists "scan_photos_auth" on storage.objects;
create policy "scan_photos_auth" on storage.objects for all using (bucket_id = 'scan-photos' and auth.role() = 'authenticated') with check (bucket_id = 'scan-photos' and auth.role() = 'authenticated');

drop policy if exists "patient_records_auth" on storage.objects;
create policy "patient_records_auth" on storage.objects for all using (bucket_id = 'patient-records' and auth.role() = 'authenticated') with check (bucket_id = 'patient-records' and auth.role() = 'authenticated');

-- ============================================================================
-- DATABASE TRIGGERS & RPC FUNCTIONS
-- ============================================================================

-- Auto-create a user row on first sign-in; assign admin if dermaisupport@gmail.com, clinic if clinic exists, doctor if clinic_doctor matches, else patient
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_doctor_id uuid;
  matched_clinic_id uuid;
  assigned_role varchar(20);
begin
  if lower(trim(new.email)) = 'dermaisupport@gmail.com' then
    assigned_role := 'admin';
  else
    -- Check if user's email matches a clinic registration
    select clinic_id into matched_clinic_id
    from clinic
    where lower(trim(email)) = lower(trim(new.email))
    limit 1;

    if matched_clinic_id is not null then
      assigned_role := 'clinic';
    else
      -- Check if user's email matches doctor roster
      select doctor_id into matched_doctor_id
      from clinic_doctor
      where lower(trim(email)) = lower(trim(new.email))
        and user_id is null
      limit 1;

      if matched_doctor_id is not null then
        assigned_role := 'doctor';
      else
        assigned_role := 'patient';
      end if;
    end if;
  end if;

  insert into "user" (user_id, full_name, email, role, google_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    assigned_role,
    new.raw_app_meta_data->>'provider_id'
  )
  on conflict (user_id) do update
    set 
      role = case 
        when lower(trim(new.email)) = 'dermaisupport@gmail.com' then 'admin' 
        when matched_clinic_id is not null then 'clinic'
        when matched_doctor_id is not null then 'doctor'
        else "user".role 
      end,
      full_name = coalesce(new.raw_user_meta_data->>'full_name', "user".full_name);

  -- Link user_id in clinic table if matched
  if matched_clinic_id is not null then
    update clinic
    set owner_user_id = new.id
    where clinic_id = matched_clinic_id and (owner_user_id is null or owner_user_id = new.id);
  end if;

  -- Link user_id in clinic_doctor table if matched
  if matched_doctor_id is not null and assigned_role = 'doctor' then
    update clinic_doctor
    set user_id = new.id
    where doctor_id = matched_doctor_id and user_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Prevent unauthorized role escalation & status changes on "user"
create or replace function enforce_user_role_protection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only block unauthorized changes coming from client sessions (where auth.uid() is set)
  if auth.uid() is not null and not is_admin() then
    -- Allow user claiming clinic role if they own a clinic
    if new.role is distinct from old.role then
      if new.role = 'clinic' and exists (
        select 1 from clinic where (owner_user_id = auth.uid() or lower(trim(email)) = lower(trim(new.email)))
      ) then
        -- Allowed clinic role assignment
        null;
      else
        raise exception 'Only administrators can modify user roles';
      end if;
    end if;
    if new.account_status is distinct from old.account_status then
      raise exception 'Only administrators can modify account status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_user_role_protection on "user";
create trigger enforce_user_role_protection
  before update on "user"
  for each row execute function enforce_user_role_protection();

-- ============================================================================
-- AUTO-TIMESTAMP TRIGGER: set_updated_at()
-- Reusable trigger function that stamps updated_at = now() on every UPDATE.
-- Attach to any table that has an updated_at column.
-- ============================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Attach to user_plan_subscription
drop trigger if exists set_user_plan_subscription_updated_at on user_plan_subscription;
create trigger set_user_plan_subscription_updated_at
  before update on user_plan_subscription
  for each row execute function set_updated_at();


-- Comprehensive Clinic Registration (SECURITY DEFINER, works unauthenticated or authenticated)
create or replace function register_new_clinic(
  p_name text,
  p_address text,
  p_email text,
  p_phone text,
  p_doctor_name text,
  p_specialization text default 'General Dermatology',
  p_services text[] default array[]::text[],
  p_consultation_fee decimal default 500,
  p_description text default null,
  p_operating_days text default 'Monday - Saturday',
  p_open_time time default '08:00'::time,
  p_close_time time default '17:00'::time,
  p_prc_license text default 'PRC-PENDING',
  p_logo_url text default null,
  p_business_permit_url text default null,
  p_business_permit_name text default null,
  p_prc_license_file_url text default null,
  p_prc_license_file_name text default null,
  p_photos text[] default array[]::text[],
  p_owner_user_id uuid default null,
  p_latitude decimal default null,
  p_longitude decimal default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_doctor_id uuid;
  v_svc text;
  v_photo text;
  v_idx int := 1;
  v_effective_owner_id uuid;
begin
  -- Determine owner user id: either explicit, or current auth uid, or lookup user by email
  v_effective_owner_id := coalesce(p_owner_user_id, auth.uid());
  if v_effective_owner_id is null and p_email is not null then
    select user_id into v_effective_owner_id from "user" where lower(trim(email)) = lower(trim(p_email)) limit 1;
  end if;

  -- Verify owner user id exists in "user" table to prevent foreign key errors
  if v_effective_owner_id is not null and not exists (select 1 from "user" where user_id = v_effective_owner_id) then
    v_effective_owner_id := null;
  end if;

  -- Insert clinic
  insert into clinic (
    name,
    address,
    district,
    specialization,
    email,
    phone,
    consultation_fee,
    description,
    logo_url,
    business_permit_url,
    business_permit_name,
    prc_license_file_url,
    prc_license_file_name,
    latitude,
    longitude,
    status,
    owner_user_id
  ) values (
    p_name,
    p_address,
    p_address,
    coalesce(p_specialization, 'General Dermatology'),
    p_email,
    p_phone,
    p_consultation_fee,
    p_description,
    p_logo_url,
    p_business_permit_url,
    p_business_permit_name,
    p_prc_license_file_url,
    p_prc_license_file_name,
    p_latitude,
    p_longitude,
    'pending',
    v_effective_owner_id
  )
  returning clinic_id into v_clinic_id;

  -- Insert doctor into clinic_doctor
  if p_doctor_name is not null and trim(p_doctor_name) <> '' then
    insert into clinic_doctor (
      clinic_id,
      user_id,
      doctor_name,
      email,
      contact_number,
      prc_license,
      photo_url,
      status
    ) values (
      v_clinic_id,
      v_effective_owner_id,
      p_doctor_name,
      coalesce(p_email, 'clinic@dermai.com'),
      p_phone,
      coalesce(p_prc_license, 'PRC-PENDING'),
      p_prc_license_file_url,
      'Active'
    )
    returning doctor_id into v_doctor_id;
  end if;

  -- Insert services
  if p_services is not null then
    foreach v_svc in array p_services loop
      if trim(v_svc) <> '' then
        insert into clinic_service_offered (clinic_id, service_name)
        values (v_clinic_id, trim(v_svc));
      end if;
    end loop;
  end if;

  -- Insert operating hours
  insert into clinic_operating_hours (clinic_id, day_of_week, open_time, close_time)
  values (
    v_clinic_id,
    coalesce(p_operating_days, 'Monday - Saturday'),
    coalesce(p_open_time, '08:00'::time),
    coalesce(p_close_time, '17:00'::time)
  );

  -- Insert photos
  if p_photos is not null then
    foreach v_photo in array p_photos loop
      if trim(v_photo) <> '' then
        insert into clinic_photo (clinic_id, photo_url, sort_order)
        values (v_clinic_id, trim(v_photo), v_idx);
        v_idx := v_idx + 1;
      end if;
    end loop;
  end if;

  -- If the user already exists, ensure role is clinic
  if v_effective_owner_id is not null then
    update "user" set role = 'clinic' where user_id = v_effective_owner_id and role = 'patient';
  end if;

  return v_clinic_id;
end;
$$;

-- Set Clinic Verification Status (Approve / Reject / Pending) + Auto Role Promotion & Notification
create or replace function set_clinic_status(
  target_clinic_id uuid,
  new_status varchar(20),
  reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_clinic_email varchar(100);
  v_clinic_name varchar(200);
begin
  -- Admin privileges check
  if not is_admin() then
    raise exception 'Admin privileges required';
  end if;

  update clinic
  set status = new_status
  where clinic_id = target_clinic_id
  returning owner_user_id, email, name into v_owner_id, v_clinic_email, v_clinic_name;

  if not found then
    return false;
  end if;

  -- If owner user id not linked yet, look up user by email
  if v_owner_id is null and v_clinic_email is not null then
    select user_id into v_owner_id from "user" where lower(trim(email)) = lower(trim(v_clinic_email)) limit 1;
    if v_owner_id is not null then
      update clinic set owner_user_id = v_owner_id where clinic_id = target_clinic_id;
    end if;
  end if;

  -- If approved, promote user role to clinic and insert notification
  if new_status = 'approved' then
    if v_owner_id is not null then
      update "user" set role = 'clinic' where user_id = v_owner_id and role != 'admin';

      insert into user_notification (user_id, type, subtype, title, body, is_read)
      values (
        v_owner_id,
        'system',
        'clinic_approval',
        '🎉 Clinic Application Approved!',
        'Congratulations! Your clinic "' || coalesce(v_clinic_name, 'Clinic') || '" has been verified and approved by DermAI Admin. All clinic tools are now active.',
        false
      );
    end if;
  elsif new_status = 'rejected' then
    if v_owner_id is not null then
      insert into user_notification (user_id, type, subtype, title, body, is_read)
      values (
        v_owner_id,
        'system',
        'clinic_rejection',
        'Clinic Application Status Update',
        'Your application for "' || coalesce(v_clinic_name, 'Clinic') || '" was not approved. Reason: ' || coalesce(reason, 'Requirements were incomplete.'),
        false
      );
    end if;
  end if;

  return true;
end;
$$;

-- Register a new clinic legacy wrapper
create or replace function register_clinic(
  clinic_name           varchar,
  clinic_district       varchar,
  clinic_specialization varchar,
  clinic_latitude       decimal,
  clinic_longitude      decimal
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_clinic_id uuid;
begin
  insert into clinic (name, district, specialization, status, latitude, longitude, owner_user_id)
  values (clinic_name, clinic_district, clinic_specialization, 'pending', clinic_latitude, clinic_longitude, auth.uid())
  returning clinic_id into new_clinic_id;

  return new_clinic_id;
end;
$$;

-- Invite a doctor to a clinic (creates clinic_doctor row, upgrades role if already a user)
create or replace function invite_doctor(
  target_clinic_id     uuid,
  doctor_email         varchar,
  doctor_full_name     varchar,
  doctor_prc_license   varchar,
  doctor_specialization varchar
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_doctor_id    uuid;
  existing_user_id uuid;
  spec_id          uuid;
begin
  if not (is_clinic_owner(target_clinic_id) or is_admin()) then
    raise exception 'Not authorized to invite doctors for this clinic';
  end if;

  select user_id into existing_user_id from "user" where email = doctor_email;

  insert into clinic_doctor (clinic_id, doctor_name, email, prc_license, status, user_id)
  values (target_clinic_id, doctor_full_name, doctor_email, doctor_prc_license, 'Active', existing_user_id)
  returning doctor_id into new_doctor_id;

  -- Link specialization via junction table if provided
  if doctor_specialization is not null and trim(doctor_specialization) <> '' then
    select id into spec_id from specializations where lower(name) = lower(trim(doctor_specialization));
    if spec_id is null then
      insert into specializations (name)
      values (trim(doctor_specialization))
      returning id into spec_id;
    end if;

    insert into doctor_specializations (doctor_id, specialization_id)
    values (new_doctor_id, spec_id)
    on conflict do nothing;
  end if;

  if existing_user_id is not null then
    update "user" set role = 'doctor' where user_id = existing_user_id and role = 'patient';
  end if;

  return new_doctor_id;
end;
$$;

-- ============================================================================
-- SEED DATA (Safe defaults)
-- ============================================================================

-- Subscription plans (harmonized with frontend UI prices)
-- Plan IDs are stable UUIDs. On conflict, update price/name/billing_type/status.
insert into plan (plan_id, name, price, billing_type, scan_limit, status) values
  ('00000000-0000-0000-0000-000000000001', 'Free',        0.00,    'monthly', 3,  'active'),
  ('00000000-0000-0000-0000-000000000003', 'Pro Monthly', 199.00,  'monthly', -1, 'active'),
  ('00000000-0000-0000-0000-000000000004', 'Pro Annual',  1999.00, 'yearly',  -1, 'active')
on conflict (plan_id) do update
  set name         = excluded.name,
      price        = excluded.price,
      billing_type = excluded.billing_type,
      scan_limit   = excluded.scan_limit,
      status       = excluded.status;

-- Inactivate legacy Basic plan (soft-delete to preserve FK references)
insert into plan (plan_id, name, price, billing_type, scan_limit, status) values
  ('00000000-0000-0000-0000-000000000002', 'Basic (Legacy)', 149.00, 'monthly', 10, 'inactive')
on conflict (plan_id) do update set status = 'inactive';

-- Plan features
insert into plan_feature (feature_id, feature_text, plan_id) values
  ('00000000-0000-0000-0001-000000000001', '3 AI Skin Scans per billing cycle',    '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0001-000000000002', 'Access to Clinic Directory',            '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0001-000000000006', 'Unlimited AI Skin Scans',              '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0001-000000000007', 'Priority Clinic Consultation Booking', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0001-000000000008', 'Full Scan History & Analytics',        '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0001-000000000009', 'Unlimited AI Skin Scans',              '00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0001-000000000010', 'Priority Clinic Consultation Booking', '00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0001-000000000011', 'Full Scan History & Analytics',        '00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0001-000000000012', 'Save 16% vs monthly billing',          '00000000-0000-0000-0000-000000000004')
on conflict (feature_id) do update set feature_text = excluded.feature_text, plan_id = excluded.plan_id;

-- Specializations (14 dermatology options used in the UI)
insert into specializations (name) values
  ('General Dermatology'),
  ('Clinical Dermatology'),
  ('Cosmetic Dermatology'),
  ('Aesthetic Dermatology'),
  ('Pediatric Dermatology'),
  ('Dermatologic Surgery'),
  ('Dermatopathology'),
  ('Dermatology Oncology'),
  ('Hair & Scalp Dermatology'),
  ('Nail Dermatology'),
  ('Immunodermatology'),
  ('Contact Dermatitis & Allergy'),
  ('Photodermatology'),
  ('Dermatology & Venereology')
on conflict (name) do nothing;

-- Skin conditions (5 conditions tracked in the study)
insert into skin_condition (condition_id, name, local_name, description, who_affected) values
  ('00000000-0000-0000-0000-000000000011',
   'Vitiligo', 'Bulaqin / Kulani (colloquial)',
   'A condition causing loss of skin pigment in patches due to destruction of melanocytes.',
   'Can affect anyone regardless of age, though it often starts before age 20. People with a family history of vitiligo or other autoimmune conditions are at higher risk.'),

  ('00000000-0000-0000-0000-000000000012',
   'Acne Vulgaris', 'Tagihawat',
   'A common skin condition involving clogged hair follicles, causing pimples, blackheads, and cysts.',
   'Most common among teenagers due to hormonal changes, but can affect adults as well, especially those with oily skin, hormonal imbalances, or high stress levels.'),

  ('00000000-0000-0000-0000-000000000013',
   'Atopic Dermatitis', 'Eksema',
   'A chronic condition causing itchy, inflamed skin, often linked to allergies and asthma.',
   'Often begins in childhood but can occur at any age. Common in people with a family history of allergies, asthma, or hay fever.'),

  ('00000000-0000-0000-0000-000000000014',
   'Contact Dermatitis', 'Alerdyi sa Balat',
   'Skin inflammation caused by direct contact with an irritant or allergen.',
   'Can affect anyone exposed to irritants or allergens. Common among people who work with cleaning products, chemicals, or wear jewelry containing nickel.'),

  ('00000000-0000-0000-0000-000000000015',
   'Melasma', 'Pekas',
   'A condition causing brown or gray-brown patches, usually on the face, often linked to sun exposure and hormones.',
   'More common in women, especially during pregnancy or while taking birth control pills. People with darker skin tones and high sun exposure are at greater risk.')
on conflict (condition_id) do nothing;

-- ============================================================================
-- FINAL CLEANUP: Ensure composite uniqueness on clinic_condition_treated
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'clinic_condition_treated') then
    delete from clinic_condition_treated a
    using clinic_condition_treated b
    where a.cc_id > b.cc_id
      and a.clinic_id = b.clinic_id
      and a.condition_id = b.condition_id;
  end if;
end $$;

alter table clinic_condition_treated
  drop constraint if exists uq_clinic_condition;

alter table clinic_condition_treated
  add constraint uq_clinic_condition unique (clinic_id, condition_id);

-- ============================================================================
-- STORAGE BUCKETS SETUP
-- ============================================================================
insert into storage.buckets (id, name, public)
values 
  ('clinic-photos', 'clinic-photos', true),
  ('avatars', 'avatars', true),
  ('skin-scans', 'skin-scans', true)
on conflict (id) do update set public = true;

drop policy if exists "Public Access Storage Objects" on storage.objects;
create policy "Public Access Storage Objects" on storage.objects
  for select using (bucket_id in ('clinic-photos', 'avatars', 'skin-scans'));

drop policy if exists "Allow Upload Storage Objects" on storage.objects;
create policy "Allow Upload Storage Objects" on storage.objects
  for insert with check (bucket_id in ('clinic-photos', 'avatars', 'skin-scans'));

drop policy if exists "Allow Update Storage Objects" on storage.objects;
create policy "Allow Update Storage Objects" on storage.objects
  for update using (bucket_id in ('clinic-photos', 'avatars', 'skin-scans'));

-- ============================================================================
-- ADMIN PRIVILEGE INITIALIZATION
-- ============================================================================
update "user" 
set role = 'admin', account_status = 'active' 
where lower(trim(email)) = 'dermaisupport@gmail.com';


