-- ============================================================================
-- Fix: user_plan_subscription RLS update policy & expiry helper
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
--
-- This script fixes:
--   1. RLS policy on "user_plan_subscription" to permit status = 'expired'
--      when a patient's period lapses (previously only allowed 'cancelled')
--   2. Adds an idempotent security-definer helper RPC for lazy downgrades
-- ============================================================================

-- 1. Ensure RLS allows updating status to 'cancelled' or 'expired'
drop policy if exists "sub_owner_cancel" on user_plan_subscription;
drop policy if exists "sub_owner_update" on user_plan_subscription;

create policy "sub_owner_update" 
  on user_plan_subscription 
  for update 
  using (user_id = auth.uid() or is_admin())
  with check (status in ('cancelled', 'expired') or is_admin());

-- 2. Stored procedure for atomic lazy downgrade of expired subscriptions
create or replace function public.downgrade_expired_subscriptions()
returns table (downgraded_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rows int;
begin
  update user_plan_subscription
  set status = 'expired',
      updated_at = now()
  where status = 'active'
    and current_period_end is not null
    and current_period_end <= now();

  get diagnostics updated_rows = row_count;
  return query select updated_rows;
end;
$$;

-- Grant execution to authenticated & anon roles
grant execute on function public.downgrade_expired_subscriptions() to authenticated, anon;
