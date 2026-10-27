-- ============================================================================
-- Fix: user_support_ticket & user_notification schema updates
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
--
-- This script fixes:
--   1. check constraint "user_support_ticket_status_check" rejecting 'in_progress' and 'resolved'
--   2. missing "resolved_at" and "response" columns on "user_support_ticket"
--   3. missing "metadata", "subtype", "body" columns on "user_notification"
--
-- Safe and idempotent to re-run.
-- ============================================================================

-- 1. Ensure columns exist on user_support_ticket
alter table if exists user_support_ticket add column if not exists resolved_at timestamptz;
alter table if exists user_support_ticket add column if not exists response text;
alter table if exists user_support_ticket add column if not exists category text default 'General Support';

-- 2. Drop the restrictive legacy constraint first so we can normalize data
alter table if exists user_support_ticket drop constraint if exists user_support_ticket_status_check;

-- 3. Normalise any legacy status spellings
update user_support_ticket set status = 'in_progress' where lower(status) in ('in-progress', 'in_progress');
update user_support_ticket set status = 'resolved' where lower(status) in ('closed', 'resolved');

-- 4. Replace the status check constraint to permit full ticket lifecycle
alter table if exists user_support_ticket add constraint user_support_ticket_status_check
  check (lower(status) in ('pending','open','in_progress','resolved','closed'));

-- 4. Ensure columns exist on user_notification for ticket alerts
alter table if exists user_notification add column if not exists subtype varchar(50);
alter table if exists user_notification add column if not exists body text;
alter table if exists user_notification add column if not exists metadata jsonb;
alter table if exists user_notification add column if not exists is_read boolean not null default false;
alter table if exists user_notification add column if not exists created_at timestamptz not null default now();

-- 5. Sanity check: lists the constraint definition now in force
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'user_support_ticket'::regclass
  and conname = 'user_support_ticket_status_check';
