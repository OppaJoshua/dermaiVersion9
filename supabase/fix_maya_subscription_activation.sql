-- ============================================================================
-- Maya (paymaya) Pro-plan activation hardening
-- Run once in the Supabase SQL editor. Idempotent and safe to re-run.
--
-- Why: the edge functions (paymongo-payment / paymongo-webhook) upsert
-- public.user_plan_subscription with payment_method, payment_full_name,
-- payment_email, billing_address, payment_mobile_number and (on re-purchase)
-- cancel_at_period_end / cancelled_at. If any of those columns is missing, or a
-- legacy CHECK constraint only whitelists some payment_method spellings, the
-- upsert fails for that method while user_payment (billing history) still saves.
-- ============================================================================

alter table if exists public.user_plan_subscription add column if not exists payment_method        text;
alter table if exists public.user_plan_subscription add column if not exists payment_full_name     text;
alter table if exists public.user_plan_subscription add column if not exists payment_email         text;
alter table if exists public.user_plan_subscription add column if not exists billing_address       text;
alter table if exists public.user_plan_subscription add column if not exists payment_mobile_number text;
alter table if exists public.user_plan_subscription add column if not exists cancel_at_period_end  boolean not null default false;
alter table if exists public.user_plan_subscription add column if not exists cancelled_at          timestamptz;

-- Drop any CHECK constraint that restricts payment_method to a fixed list
-- (e.g. only 'gcash'/'GCash'), so 'maya' / 'Maya' / 'paymaya' are accepted too.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.user_plan_subscription'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_method%'
  loop
    execute format('alter table public.user_plan_subscription drop constraint %I', c.conname);
  end loop;
end $$;
