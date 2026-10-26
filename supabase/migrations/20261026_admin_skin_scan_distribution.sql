-- Run as migration owner (SECURITY DEFINER) so authorized admins can aggregate through RLS.
begin;

create or replace view public.ai_skin_analysis as 
  select * from public.ai_scan_result;

create or replace view public.profiles as 
  select 
    user_id,
    full_name,
    email,
    role,
    district,
    district as municipality,
    address,
    account_status,
    created_at
  from public."user";

create or replace function public.get_cebu_skin_condition_distribution()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is not null and not exists (
    select 1 from public."user" as administrator
    where administrator.user_id = auth.uid()
      and (
        administrator.role in ('admin', 'superadmin')
        or administrator.role ilike '%admin%'
        or lower(administrator.email) = 'dermaisupport@gmail.com'
      )
  ) then
    raise exception 'Active administrator access required'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(grouped)), '[]'::jsonb)
    into result
  from (
    select 
      patient.district,
      patient.address,
      condition.name as condition,
      count(*)::int as scan_count
    from public.ai_scan_result as scan
    left join public."user" as patient on patient.user_id = scan.user_id
    left join public.skin_condition as condition on condition.condition_id = scan.condition_id
    group by patient.district, patient.address, condition.name
  ) as grouped;

  return result;
end;
$$;

create or replace function public.get_admin_skin_scan_distribution()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.get_cebu_skin_condition_distribution();
end;
$$;

grant execute on function public.get_cebu_skin_condition_distribution() to anon, authenticated, service_role;
grant execute on function public.get_admin_skin_scan_distribution() to anon, authenticated, service_role;

commit;
