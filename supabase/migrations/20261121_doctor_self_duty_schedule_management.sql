-- ============================================================================
-- DermAI Migration: Doctor Self-Service Duty Schedule Management & Real-Time Synchronization
-- Date: 2026-11-21
-- Purpose:
-- 1. Enforce authoritative 4-tier duty_days / duty_schedule precedence rule (explicitly empty weekday = Off Duty).
-- 2. Validate full appointment duration (start + effective_interval <= shift_end) across schedule changes and slot holds.
-- 3. Provide deadlock-free doctor schedule update RPC (`save_authorized_doctor_duty_schedule`) for both doctors and clinic admins.
-- 4. Guard direct schedule updates with an unspoofable zero-lock SECURITY INVOKER trigger (`trg_guard_clinic_doctor_schedule_update`).
-- 5. Expose zero-PII public schedule lookup RPC (`get_clinic_public_doctor_schedules`) and column-level privileges for anon.
-- 6. Preserve complete payment-aware `acquire_appointment_slot_hold` logic while enforcing live doctor schedule validation.
-- ============================================================================

-- 1. Robust Appointment Time Parser (Supports 24h 'HH:MM', 'HH:MM:SS', 12h 'h:mm AM/PM', and timestamptz fallback)
create or replace function public.parse_appointment_time_minutes(
  p_raw_time text,
  p_fallback_date timestamptz default null
)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_clean text;
  v_match text[];
  v_hour integer;
  v_min integer;
  v_meridiem text;
begin
  v_clean := upper(trim(coalesce(p_raw_time, '')));

  if v_clean <> '' then
    -- Match 12-hour or 24-hour time with optional seconds and optional AM/PM
    v_match := regexp_match(v_clean, '^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$');
    if v_match is not null then
      v_hour := v_match[1]::integer;
      v_min := v_match[2]::integer;
      v_meridiem := v_match[3];

      if v_min < 0 or v_min > 59 then
        return -1;
      end if;

      if v_meridiem is not null then
        if v_hour < 1 or v_hour > 12 then
          return -1;
        end if;
        if v_meridiem = 'PM' and v_hour < 12 then
          v_hour := v_hour + 12;
        elsif v_meridiem = 'AM' and v_hour = 12 then
          v_hour := 0;
        end if;
      else
        if v_hour < 0 or v_hour > 23 then
          return -1;
        end if;
      end if;

      return (v_hour * 60) + v_min;
    end if;
  end if;

  if p_fallback_date is not null then
    return (
      extract(hour from (p_fallback_date at time zone 'Asia/Manila'))::integer * 60
      + extract(minute from (p_fallback_date at time zone 'Asia/Manila'))::integer
    );
  end if;

  return -1;
end;
$$;

revoke all on function public.parse_appointment_time_minutes(text, timestamptz) from public;
grant execute on function public.parse_appointment_time_minutes(text, timestamptz) to anon, authenticated, service_role;


-- 2. Authoritative 4-Tier Doctor Day Shift Extractor
-- Tier 1: duty_days is explicitly empty array ('{}') -> 0 shifts (Off Duty)
-- Tier 2: duty_days is non-empty array and p_day_name NOT IN duty_days -> 0 shifts (Off Duty)
-- Tier 3: duty_schedule has explicit weekday structure:
--         3A: weeklyShifts is a JSON object -> authoritative for all 7 days (empty/missing day = 0 shifts, no fallback)
--         3B: legacy weekday keys or array -> authoritative (empty/missing day when weekday keys exist = 0 shifts)
-- Tier 4: weekday structure genuinely absent (NULL or metadata-only):
--         4A: p_day_name IN non-empty duty_days -> 1 fallback shift [duty_start_time, duty_end_time]
--         4B: duty_days IS NULL and duty_schedule IS NULL and p_allow_legacy_default = true -> Mon-Fri default
create or replace function public.extract_doctor_day_shifts(
  p_duty_days text[],
  p_duty_schedule jsonb,
  p_duty_start_time varchar,
  p_duty_end_time varchar,
  p_day_name text,
  p_allow_legacy_default boolean default false
)
returns table (
  shift_index integer,
  shift_label text,
  start_time text,
  end_time text,
  start_minutes integer,
  end_minutes integer,
  slot_interval_minutes integer
)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_norm_day text;
  v_day_matched boolean := false;
  v_d text;
  v_fallback_start text;
  v_fallback_end text;
  v_start_m integer;
  v_end_m integer;
  v_doc_interval integer := null;
  v_shift_interval integer := null;
  v_weekly jsonb;
  v_day_node jsonb;
  v_item jsonb;
  v_idx integer := 0;
  v_has_weekday_keys boolean := false;
  v_k text;
begin
  v_norm_day := initcap(lower(trim(coalesce(p_day_name, ''))));
  if v_norm_day not in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') then
    return;
  end if;

  v_fallback_start := coalesce(nullif(trim(coalesce(p_duty_start_time, '')), ''), '08:00');
  v_fallback_end := coalesce(nullif(trim(coalesce(p_duty_end_time, '')), ''), '17:00');

  -- Extract doctor-level slot interval override if present
  if p_duty_schedule is not null and jsonb_typeof(p_duty_schedule) = 'object' then
    if (p_duty_schedule->>'slotIntervalMinutes') ~ '^\d+$' and (p_duty_schedule->>'slotIntervalMinutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slotIntervalMinutes')::integer;
    elsif (p_duty_schedule->>'slot_interval_minutes') ~ '^\d+$' and (p_duty_schedule->>'slot_interval_minutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slot_interval_minutes')::integer;
    end if;
  end if;

  -- TIER 1: Explicitly empty duty_days array = OFF DUTY on all days
  if p_duty_days is not null and coalesce(array_length(p_duty_days, 1), 0) = 0 then
    return;
  end if;

  -- TIER 2: Non-empty duty_days array excludes p_day_name = OFF DUTY on this day
  if p_duty_days is not null and coalesce(array_length(p_duty_days, 1), 0) > 0 then
    foreach v_d in array p_duty_days loop
      if initcap(lower(trim(coalesce(v_d, '')))) = v_norm_day then
        v_day_matched := true;
        exit;
      end if;
    end loop;
    if not v_day_matched then
      return;
    end if;
  end if;

  -- TIER 3: Explicit weekday structure in p_duty_schedule
  if p_duty_schedule is not null then
    -- Tier 3A: Modern weeklyShifts object is authoritative for all 7 days
    if jsonb_typeof(p_duty_schedule) = 'object'
       and (p_duty_schedule ? 'weeklyShifts')
       and jsonb_typeof(p_duty_schedule->'weeklyShifts') = 'object' then
      v_weekly := p_duty_schedule->'weeklyShifts';
      v_day_node := coalesce(v_weekly->v_norm_day, v_weekly->lower(v_norm_day));

      if v_day_node is not null and jsonb_typeof(v_day_node) = 'array' then
        for v_item in select value from jsonb_array_elements(v_day_node) loop
          if jsonb_typeof(v_item) = 'object' then
            v_start_m := public.parse_appointment_time_minutes(coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start'), null);
            v_end_m := public.parse_appointment_time_minutes(coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end'), null);
            if v_start_m >= 0 and v_end_m > v_start_m then
              v_idx := v_idx + 1;
              v_shift_interval := v_doc_interval;
              if (v_item->>'slotIntervalMinutes') ~ '^\d+$' and (v_item->>'slotIntervalMinutes')::integer > 0 then
                v_shift_interval := (v_item->>'slotIntervalMinutes')::integer;
              elsif (v_item->>'slot_interval_minutes') ~ '^\d+$' and (v_item->>'slot_interval_minutes')::integer > 0 then
                v_shift_interval := (v_item->>'slot_interval_minutes')::integer;
              end if;
              shift_index := v_idx;
              shift_label := coalesce(nullif(trim(coalesce(v_item->>'label', '')), ''), 'Shift ' || v_idx);
              start_time := coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start');
              end_time := coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end');
              start_minutes := v_start_m;
              end_minutes := v_end_m;
              slot_interval_minutes := v_shift_interval;
              return next;
            end if;
          end if;
        end loop;
      end if;
      -- Never fall back to duty_start_time/duty_end_time when weeklyShifts is present
      return;
    end if;

    -- Tier 3B (Array): Legacy array of { day, startTime, endTime }
    if jsonb_typeof(p_duty_schedule) = 'array' then
      for v_item in select value from jsonb_array_elements(p_duty_schedule) loop
        if jsonb_typeof(v_item) = 'object'
           and initcap(lower(trim(coalesce(v_item->>'day', '')))) = v_norm_day then
          v_start_m := public.parse_appointment_time_minutes(coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start'), null);
          v_end_m := public.parse_appointment_time_minutes(coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end'), null);
          if v_start_m >= 0 and v_end_m > v_start_m then
            v_idx := v_idx + 1;
            shift_index := v_idx;
            shift_label := coalesce(nullif(trim(coalesce(v_item->>'label', '')), ''), 'Duty Shift');
            start_time := coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start');
            end_time := coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end');
            start_minutes := v_start_m;
            end_minutes := v_end_m;
            slot_interval_minutes := v_doc_interval;
            return next;
          end if;
        end if;
      end loop;
      return;
    end if;

    -- Tier 3B (Object): Check if duty_schedule has any top-level weekday keys
    if jsonb_typeof(p_duty_schedule) = 'object' then
      for v_k in select jsonb_object_keys(p_duty_schedule) loop
        if initcap(lower(trim(v_k))) in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') then
          v_has_weekday_keys := true;
          exit;
        end if;
      end loop;

      if v_has_weekday_keys then
        v_day_node := coalesce(p_duty_schedule->v_norm_day, p_duty_schedule->lower(v_norm_day));
        if v_day_node is not null then
          if jsonb_typeof(v_day_node) = 'array' then
            for v_item in select value from jsonb_array_elements(v_day_node) loop
              if jsonb_typeof(v_item) = 'object' then
                v_start_m := public.parse_appointment_time_minutes(coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start'), null);
                v_end_m := public.parse_appointment_time_minutes(coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end'), null);
                if v_start_m >= 0 and v_end_m > v_start_m then
                  v_idx := v_idx + 1;
                  v_shift_interval := v_doc_interval;
                  if (v_item->>'slotIntervalMinutes') ~ '^\d+$' and (v_item->>'slotIntervalMinutes')::integer > 0 then
                    v_shift_interval := (v_item->>'slotIntervalMinutes')::integer;
                  elsif (v_item->>'slot_interval_minutes') ~ '^\d+$' and (v_item->>'slot_interval_minutes')::integer > 0 then
                    v_shift_interval := (v_item->>'slot_interval_minutes')::integer;
                  end if;
                  shift_index := v_idx;
                  shift_label := coalesce(nullif(trim(coalesce(v_item->>'label', '')), ''), 'Shift ' || v_idx);
                  start_time := coalesce(v_item->>'startTime', v_item->>'start_time', v_item->>'start');
                  end_time := coalesce(v_item->>'endTime', v_item->>'end_time', v_item->>'end');
                  start_minutes := v_start_m;
                  end_minutes := v_end_m;
                  slot_interval_minutes := v_shift_interval;
                  return next;
                end if;
              end if;
            end loop;
          elsif jsonb_typeof(v_day_node) = 'object' then
            v_start_m := public.parse_appointment_time_minutes(coalesce(v_day_node->>'startTime', v_day_node->>'start_time', v_day_node->>'start'), null);
            v_end_m := public.parse_appointment_time_minutes(coalesce(v_day_node->>'endTime', v_day_node->>'end_time', v_day_node->>'end'), null);
            if v_start_m >= 0 and v_end_m > v_start_m then
              v_shift_interval := v_doc_interval;
              if (v_day_node->>'slotIntervalMinutes') ~ '^\d+$' and (v_day_node->>'slotIntervalMinutes')::integer > 0 then
                v_shift_interval := (v_day_node->>'slotIntervalMinutes')::integer;
              elsif (v_day_node->>'slot_interval_minutes') ~ '^\d+$' and (v_day_node->>'slot_interval_minutes')::integer > 0 then
                v_shift_interval := (v_day_node->>'slot_interval_minutes')::integer;
              end if;
              shift_index := 1;
              shift_label := coalesce(nullif(trim(coalesce(v_day_node->>'label', '')), ''), 'Duty Shift');
              start_time := coalesce(v_day_node->>'startTime', v_day_node->>'start_time', v_day_node->>'start');
              end_time := coalesce(v_day_node->>'endTime', v_day_node->>'end_time', v_day_node->>'end');
              start_minutes := v_start_m;
              end_minutes := v_end_m;
              slot_interval_minutes := v_shift_interval;
              return next;
            end if;
          end if;
        end if;
        -- Explicit weekday keys exist, so any missing or empty day is Off Duty
        return;
      end if;
    end if;
  end if;

  -- TIER 4: Weekday schedule genuinely absent (NULL or metadata-only)
  -- Tier 4A: Non-empty duty_days contains p_day_name -> synthesize 1 fallback shift
  if v_day_matched then
    v_start_m := public.parse_appointment_time_minutes(v_fallback_start, null);
    v_end_m := public.parse_appointment_time_minutes(v_fallback_end, null);
    if v_start_m >= 0 and v_end_m > v_start_m then
      shift_index := 1;
      shift_label := 'Duty Shift';
      start_time := v_fallback_start;
      end_time := v_fallback_end;
      start_minutes := v_start_m;
      end_minutes := v_end_m;
      slot_interval_minutes := v_doc_interval;
      return next;
    end if;
    return;
  end if;

  -- Tier 4B: Legacy NULL duty_days and NULL duty_schedule when p_allow_legacy_default = true
  if p_duty_days is null and p_duty_schedule is null and p_allow_legacy_default then
    if v_norm_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday') then
      v_start_m := public.parse_appointment_time_minutes(v_fallback_start, null);
      v_end_m := public.parse_appointment_time_minutes(v_fallback_end, null);
      if v_start_m >= 0 and v_end_m > v_start_m then
        shift_index := 1;
        shift_label := 'Duty Shift';
        start_time := v_fallback_start;
        end_time := v_fallback_end;
        start_minutes := v_start_m;
        end_minutes := v_end_m;
        slot_interval_minutes := v_doc_interval;
        return next;
      end if;
    end if;
  end if;

  return;
end;
$$;

revoke all on function public.extract_doctor_day_shifts(text[], jsonb, varchar, varchar, text, boolean) from public;
grant execute on function public.extract_doctor_day_shifts(text[], jsonb, varchar, varchar, text, boolean) to anon, authenticated, service_role;


-- 3. Full-Duration Slot Schedule Validator
-- Checks that an appointment starting at p_slot_start_min fits completely inside
-- at least one active shift on p_cal_date:
--   p_slot_start_min >= shift.start_minutes AND (p_slot_start_min + effective_interval) <= shift.end_minutes
create or replace function public.is_slot_within_doctor_duty_schedule(
  p_duty_days text[],
  p_duty_schedule jsonb,
  p_duty_start_time varchar,
  p_duty_end_time varchar,
  p_cal_date date,
  p_slot_start_min integer,
  p_clinic_open_time varchar default null,
  p_clinic_close_time varchar default null,
  p_clinic_operating_days text default null,
  p_clinic_default_interval integer default 30
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_day_name text;
  v_clinic_open_m integer;
  v_clinic_close_m integer;
  v_default_interval integer;
  v_doc_interval integer := null;
  v_eff_interval integer;
  v_shift record;
begin
  if p_cal_date is null or p_slot_start_min is null or p_slot_start_min < 0 then
    return false;
  end if;

  v_day_name := trim(to_char(p_cal_date, 'FMDay'));
  v_default_interval := case
    when p_clinic_default_interval is not null and p_clinic_default_interval > 0 then p_clinic_default_interval
    else 30
  end;

  if p_duty_schedule is not null and jsonb_typeof(p_duty_schedule) = 'object' then
    if (p_duty_schedule->>'slotIntervalMinutes') ~ '^\d+$' and (p_duty_schedule->>'slotIntervalMinutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slotIntervalMinutes')::integer;
    elsif (p_duty_schedule->>'slot_interval_minutes') ~ '^\d+$' and (p_duty_schedule->>'slot_interval_minutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slot_interval_minutes')::integer;
    end if;
  end if;

  if p_clinic_open_time is not null and trim(p_clinic_open_time) <> '' then
    v_clinic_open_m := public.parse_appointment_time_minutes(p_clinic_open_time, null);
  else
    v_clinic_open_m := 0;
  end if;

  if p_clinic_close_time is not null and trim(p_clinic_close_time) <> '' then
    v_clinic_close_m := public.parse_appointment_time_minutes(p_clinic_close_time, null);
  else
    v_clinic_close_m := 1440;
  end if;

  for v_shift in
    select *
    from public.extract_doctor_day_shifts(
      p_duty_days,
      p_duty_schedule,
      p_duty_start_time,
      p_duty_end_time,
      v_day_name,
      true
    )
  loop
    v_eff_interval := coalesce(v_shift.slot_interval_minutes, v_doc_interval, v_default_interval, 30);
    if v_eff_interval <= 0 then
      v_eff_interval := 30;
    end if;

    if p_slot_start_min >= v_shift.start_minutes
       and (p_slot_start_min + v_eff_interval) <= v_shift.end_minutes
       and (v_clinic_open_m < 0 or p_slot_start_min >= v_clinic_open_m)
       and (v_clinic_close_m < 0 or (p_slot_start_min + v_eff_interval) <= v_clinic_close_m) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.is_slot_within_doctor_duty_schedule(text[], jsonb, varchar, varchar, date, integer, varchar, varchar, text, integer) from public;
grant execute on function public.is_slot_within_doctor_duty_schedule(text[], jsonb, varchar, varchar, date, integer, varchar, varchar, text, integer) to anon, authenticated, service_role;


-- 4. Format Minutes as 12-Hour Label ('8:00 AM') for Clear Conflict Messages
create or replace function public.format_minutes_12h(p_minutes integer)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_h integer;
  v_m integer;
  v_ampm text;
  v_h12 integer;
begin
  if p_minutes is null or p_minutes < 0 then
    return '';
  end if;
  v_h := (p_minutes / 60) % 24;
  v_m := p_minutes % 60;
  v_ampm := case when v_h >= 12 then 'PM' else 'AM' end;
  v_h12 := case when (v_h % 12) = 0 then 12 else (v_h % 12) end;
  return v_h12::text || ':' || lpad(v_m::text, 2, '0') || ' ' || v_ampm;
end;
$$;

revoke all on function public.format_minutes_12h(integer) from public;
grant execute on function public.format_minutes_12h(integer) to anon, authenticated, service_role;


-- 5. Unspoofable Zero-Lock BEFORE UPDATE Trigger on public.clinic_doctor
-- Acquires ZERO advisory locks or row locks (preserving strict lock hierarchy).
-- Checks BOTH:
--   1. current_user IN ('postgres', 'supabase_admin') — true only inside a SECURITY DEFINER
--      RPC owned by postgres/supabase_admin (cannot be spoofed by an authenticated user calling
--      set_config() directly because current_user in a SECURITY INVOKER trigger is 'authenticated').
--   2. current_setting('app.authorized_schedule_rpc', true) = 'true'
create or replace function public.trg_guard_direct_schedule_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_schedule_changed boolean := false;
  v_old_has_shifts boolean := false;
  v_new_has_shifts boolean := false;
  v_day text;
begin
  v_schedule_changed := (
    NEW.duty_days is distinct from OLD.duty_days
    or NEW.duty_schedule is distinct from OLD.duty_schedule
    or NEW.duty_start_time is distinct from OLD.duty_start_time
    or NEW.duty_end_time is distinct from OLD.duty_end_time
  );

  if not v_schedule_changed then
    return NEW;
  end if;

  -- Authorized path: invoked inside save_authorized_doctor_duty_schedule (SECURITY DEFINER owned by postgres)
  if current_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('app.authorized_schedule_rpc', true), '') = 'true' then
    return NEW;
  end if;

  -- Permit initial 0-shift registration initialization by the verified clinic owner
  -- (e.g. immediately after invite_doctor when both OLD and NEW have 0 active shifts)
  if public.is_clinic_owner(NEW.clinic_id) then
    foreach v_day in array array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] loop
      if exists (
        select 1 from public.extract_doctor_day_shifts(
          OLD.duty_days, OLD.duty_schedule, OLD.duty_start_time, OLD.duty_end_time, v_day, false
        )
      ) then
        v_old_has_shifts := true;
        exit;
      end if;
    end loop;

    foreach v_day in array array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] loop
      if exists (
        select 1 from public.extract_doctor_day_shifts(
          NEW.duty_days, NEW.duty_schedule, NEW.duty_start_time, NEW.duty_end_time, v_day, false
        )
      ) then
        v_new_has_shifts := true;
        exit;
      end if;
    end loop;

    if not v_old_has_shifts and not v_new_has_shifts then
      return NEW;
    end if;
  end if;

  raise exception 'ERR_DIRECT_SCHEDULE_UPDATE_FORBIDDEN: Doctor duty schedules must be updated through save_authorized_doctor_duty_schedule.'
    using errcode = '42501';
end;
$$;

revoke all on function public.trg_guard_direct_schedule_update() from public, anon, authenticated;

drop trigger if exists trg_guard_clinic_doctor_schedule_update on public.clinic_doctor;
create trigger trg_guard_clinic_doctor_schedule_update
before update on public.clinic_doctor
for each row
execute function public.trg_guard_direct_schedule_update();


-- 6. Deadlock-Free Authorized Doctor Duty Schedule Save RPC
-- Enforces:
--   1. Doctor advisory mutex BEFORE locking all public.clinic_doctor rows in ascending doctor_id order.
--   2. Strict caller ownership (assigned active doctor user_id = auth.uid(), or verified clinic owner of p_clinic_id, or admin/service_role).
--   3. Clinic operating hours & intra-day shift non-overlap validation.
--   4. Cross-clinic branch conflict validation across all active affiliations for the same doctor.
--   5. Existing appointment & unexpired payment hold protection using full appointment duration.
create or replace function public.save_authorized_doctor_duty_schedule(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_duty_days text[],
  p_duty_schedule jsonb,
  p_duty_start_time varchar default null,
  p_duty_end_time varchar default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_uid uuid;
  v_is_service_role boolean;
  v_is_admin boolean := false;
  v_is_clinic_owner boolean := false;
  v_is_self_doctor boolean := false;
  v_lookup_user_id uuid;
  v_lookup_clinic_id uuid;
  v_target record;
  v_clean_days text[] := '{}'::text[];
  v_raw_day text;
  v_norm_day text;
  v_day text;
  v_all_days text[] := array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  v_clinic_open_time varchar := '08:00';
  v_clinic_close_time varchar := '21:00';
  v_clinic_op_days text := 'Monday - Saturday';
  v_clinic_open_m integer := 480;
  v_clinic_close_m integer := 1260;
  v_shift1 record;
  v_shift2 record;
  v_other record;
  v_other_shift record;
  v_appt record;
  v_appt_date date;
  v_appt_day text;
  v_appt_start_m integer;
  v_now timestamptz := now();
  v_today_manila date := (timezone('Asia/Manila', now()))::date;
  v_now_manila_m integer;
  v_primary_start varchar := null;
  v_primary_end varchar := null;
  v_clean_schedule jsonb;
  v_clean_weekly jsonb := '{}'::jsonb;
  v_day_shifts jsonb;
  v_doc_interval integer := 30;
begin
  if p_doctor_id is null or p_clinic_id is null then
    raise exception 'ERR_INVALID_PARAMS: doctor_id and clinic_id are required.'
      using errcode = '22023';
  end if;

  v_auth_uid := auth.uid();
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if v_auth_uid is null and not v_is_service_role and not v_is_admin then
    raise exception 'ERR_UNAUTHORIZED: Authentication is required to update a duty schedule.'
      using errcode = '42501';
  end if;

  -- Step 1: Uncontended lookup of target user_id WITHOUT row lock
  select cd.user_id, cd.clinic_id
  into v_lookup_user_id, v_lookup_clinic_id
  from public.clinic_doctor cd
  where cd.doctor_id = p_doctor_id
    and cd.clinic_id = p_clinic_id;

  if v_lookup_clinic_id is null then
    raise exception 'ERR_NOT_FOUND: Doctor affiliation not found for the specified clinic branch.'
      using errcode = 'P0002';
  end if;

  -- Step 2: Acquire per-doctor transaction advisory mutex BEFORE any row locks
  perform pg_advisory_xact_lock(
    hashtext('doctor-schedule-mutex|' || coalesce(v_lookup_user_id::text, p_doctor_id::text))
  );

  -- Step 3: Lock all public.clinic_doctor rows for this doctor in strict ascending doctor_id order
  perform 1
  from public.clinic_doctor cd
  where (v_lookup_user_id is not null and cd.user_id = v_lookup_user_id)
     or cd.doctor_id = p_doctor_id
  order by cd.doctor_id asc
  for update of cd;

  -- Step 4: Load target affiliation after locks are held and verify authorization
  select cd.*
  into v_target
  from public.clinic_doctor cd
  where cd.doctor_id = p_doctor_id
    and cd.clinic_id = p_clinic_id;

  if v_target.doctor_id is null then
    raise exception 'ERR_NOT_FOUND: Doctor affiliation not found.'
      using errcode = 'P0002';
  end if;

  v_is_self_doctor := (
    v_auth_uid is not null
    and v_target.user_id is not null
    and v_target.user_id = v_auth_uid
    and lower(coalesce(v_target.status, 'active')) = 'active'
  );

  begin
    v_is_clinic_owner := public.is_clinic_owner(p_clinic_id);
  exception when others then
    v_is_clinic_owner := false;
  end;

  if not v_is_self_doctor and not v_is_clinic_owner and not v_is_admin and not v_is_service_role then
    raise exception 'ERR_FORBIDDEN: You are not authorized to modify this doctor duty schedule.'
      using errcode = '42501';
  end if;

  -- Step 5: Normalize duty_days in canonical weekday order
  if p_duty_days is not null then
    foreach v_day in array v_all_days loop
      foreach v_raw_day in array p_duty_days loop
        v_norm_day := initcap(lower(trim(coalesce(v_raw_day, ''))));
        if v_norm_day = v_day then
          v_clean_days := array_append(v_clean_days, v_day);
          exit;
        end if;
      end loop;
    end loop;
  end if;

  -- Extract doctor slot interval
  if p_duty_schedule is not null and jsonb_typeof(p_duty_schedule) = 'object' then
    if (p_duty_schedule->>'slotIntervalMinutes') ~ '^\d+$' and (p_duty_schedule->>'slotIntervalMinutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slotIntervalMinutes')::integer;
    elsif (p_duty_schedule->>'slot_interval_minutes') ~ '^\d+$' and (p_duty_schedule->>'slot_interval_minutes')::integer > 0 then
      v_doc_interval := (p_duty_schedule->>'slot_interval_minutes')::integer;
    end if;
  end if;

  -- Load clinic operating hours if configured
  select
    coalesce(nullif(left(trim(coh.open_time::text), 5), ''), '08:00'),
    coalesce(nullif(left(trim(coh.close_time::text), 5), ''), '21:00'),
    coalesce(nullif(trim(coh.day_of_week), ''), 'Monday - Saturday')
  into v_clinic_open_time, v_clinic_close_time, v_clinic_op_days
  from public.clinic_operating_hours coh
  where coh.clinic_id = p_clinic_id
  limit 1;

  v_clinic_open_m := greatest(0, public.parse_appointment_time_minutes(coalesce(v_clinic_open_time, '08:00'), null));
  v_clinic_close_m := public.parse_appointment_time_minutes(coalesce(v_clinic_close_time, '21:00'), null);
  if v_clinic_close_m <= 0 then
    v_clinic_close_m := 1260;
  end if;

  -- Step 6: Validate intra-day shifts, time ordering, clinic operating hours, and intra-day overlaps
  foreach v_day in array v_all_days loop
    -- Check raw shifts in p_duty_schedule->'weeklyShifts'->v_day for invalid start >= end before extractor filters them
    if p_duty_schedule is not null
       and jsonb_typeof(p_duty_schedule) = 'object'
       and (p_duty_schedule ? 'weeklyShifts')
       and jsonb_typeof(p_duty_schedule->'weeklyShifts') = 'object'
       and v_day = any(v_clean_days) then
      v_day_shifts := coalesce(p_duty_schedule->'weeklyShifts'->v_day, '[]'::jsonb);
      if jsonb_typeof(v_day_shifts) = 'array' then
        if jsonb_array_length(v_day_shifts) = 0 then
          raise exception 'ERR_INVALID_SHIFT_TIME: On %, at least one shift is required for an active duty day.', v_day
            using errcode = '22023';
        end if;
        for v_shift1 in
          select
            value->>'startTime' as raw_start,
            value->>'endTime' as raw_end,
            public.parse_appointment_time_minutes(coalesce(value->>'startTime', value->>'start_time'), null) as sm,
            public.parse_appointment_time_minutes(coalesce(value->>'endTime', value->>'end_time'), null) as em
          from jsonb_array_elements(v_day_shifts)
        loop
          if v_shift1.sm < 0 or v_shift1.em < 0 or v_shift1.em <= v_shift1.sm then
            raise exception 'ERR_INVALID_SHIFT_TIME: On %, duty end time must be later than start time.', v_day
              using errcode = '22023';
          end if;
          if v_shift1.sm < v_clinic_open_m or v_shift1.em > v_clinic_close_m then
            raise exception 'ERR_OUTSIDE_CLINIC_HOURS: On %, shift (% – %) must fit within clinic operating hours (% – %).',
              v_day,
              public.format_minutes_12h(v_shift1.sm),
              public.format_minutes_12h(v_shift1.em),
              public.format_minutes_12h(v_clinic_open_m),
              public.format_minutes_12h(v_clinic_close_m)
              using errcode = '22023';
          end if;
        end loop;
      end if;
    end if;

    -- Validate pairwise non-overlap of extracted shifts on v_day
    for v_shift1 in
      select * from public.extract_doctor_day_shifts(
        v_clean_days, p_duty_schedule, p_duty_start_time, p_duty_end_time, v_day, false
      )
    loop
      if v_primary_start is null then
        v_primary_start := left(trim(v_shift1.start_time), 5);
      end if;
      v_primary_end := left(trim(v_shift1.end_time), 5);

      for v_shift2 in
        select * from public.extract_doctor_day_shifts(
          v_clean_days, p_duty_schedule, p_duty_start_time, p_duty_end_time, v_day, false
        )
        where shift_index > v_shift1.shift_index
      loop
        if v_shift1.start_minutes < v_shift2.end_minutes
           and v_shift1.end_minutes > v_shift2.start_minutes then
          raise exception 'ERR_INTRA_DAY_OVERLAP: On %, shift (% – %) overlaps with (% – %). Same-day shifts cannot overlap.',
            v_day,
            public.format_minutes_12h(v_shift1.start_minutes),
            public.format_minutes_12h(v_shift1.end_minutes),
            public.format_minutes_12h(v_shift2.start_minutes),
            public.format_minutes_12h(v_shift2.end_minutes)
            using errcode = '23514';
        end if;
      end loop;
    end loop;
  end loop;

  -- Step 7: Cross-Clinic Conflict Detection across all other active affiliations for this doctor
  if v_target.user_id is not null and coalesce(array_length(v_clean_days, 1), 0) > 0 then
    for v_other in
      select
        cd.doctor_id,
        cd.clinic_id,
        cd.duty_days,
        cd.duty_schedule,
        cd.duty_start_time,
        cd.duty_end_time,
        coalesce(c.name, 'Another Clinic') as clinic_name
      from public.clinic_doctor cd
      left join public.clinic c on c.clinic_id = cd.clinic_id
      where cd.user_id = v_target.user_id
        and cd.doctor_id <> p_doctor_id
        and cd.clinic_id <> p_clinic_id
        and lower(coalesce(cd.status, 'active')) = 'active'
      order by cd.doctor_id asc
    loop
      foreach v_day in array v_clean_days loop
        for v_shift1 in
          select * from public.extract_doctor_day_shifts(
            v_clean_days, p_duty_schedule, p_duty_start_time, p_duty_end_time, v_day, false
          )
        loop
          for v_other_shift in
            select * from public.extract_doctor_day_shifts(
              v_other.duty_days, v_other.duty_schedule, v_other.duty_start_time, v_other.duty_end_time, v_day, false
            )
          loop
            if v_shift1.start_minutes < v_other_shift.end_minutes
               and v_shift1.end_minutes > v_other_shift.start_minutes then
              raise exception 'ERR_CROSS_CLINIC_CONFLICT: Schedule Conflict: You already have a duty schedule at % from % to % on %.',
                v_other.clinic_name,
                public.format_minutes_12h(v_other_shift.start_minutes),
                public.format_minutes_12h(v_other_shift.end_minutes),
                v_day
                using errcode = '23514';
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  -- Step 8: Protect existing upcoming appointments and unexpired payment holds (Full Appointment Duration)
  v_now_manila_m := (
    extract(hour from timezone('Asia/Manila', v_now))::integer * 60
    + extract(minute from timezone('Asia/Manila', v_now))::integer
  );

  for v_appt in
    select
      pa.appointment_id,
      pa.date,
      pa.time,
      pa.batch_time,
      pa.status,
      pa.doctor_status,
      pa.payment_status,
      pa.payment_hold_expires_at,
      pa.payment_reference
    from public.patient_appointment pa
    where pa.clinic_id = p_clinic_id
      and pa.assigned_doctor_id = p_doctor_id
      and ((pa.date at time zone 'Asia/Manila')::date >= v_today_manila)
      and lower(coalesce(pa.status, 'pending')) not in ('cancelled', 'rejected', 'completed')
      and lower(coalesce(pa.doctor_status, '')) not in ('rejected', 'cancelled', 'completed')
      and not (
        pa.payment_status is not null
        and (
          pa.payment_status in ('expired', 'cancelled')
          or (
            pa.payment_status = 'failed'
            and pa.payment_hold_expires_at is not null
            and pa.payment_hold_expires_at <= v_now
          )
          or (
            pa.payment_status = 'pending_hold'
            and pa.payment_hold_expires_at is not null
            and pa.payment_hold_expires_at <= v_now
            and (pa.payment_reference is null or pa.payment_reference like 'SIM-%')
          )
          or (
            pa.payment_status in ('pending_hold', 'failed')
            and pa.payment_hold_expires_at is not null
            and pa.payment_hold_expires_at <= (v_now - interval '1 hour')
          )
        )
      )
    order by pa.date asc
  loop
    v_appt_date := (v_appt.date at time zone 'Asia/Manila')::date;
    v_appt_start_m := public.parse_appointment_time_minutes(
      coalesce(nullif(trim(coalesce(v_appt.time, '')), ''), nullif(trim(coalesce(v_appt.batch_time, '')), '')),
      v_appt.date
    );

    -- Skip past appointments earlier today
    if v_appt_date = v_today_manila and v_appt_start_m >= 0 and v_appt_start_m < v_now_manila_m then
      continue;
    end if;

    if v_appt_start_m >= 0 then
      if not public.is_slot_within_doctor_duty_schedule(
        v_clean_days,
        p_duty_schedule,
        v_primary_start,
        v_primary_end,
        v_appt_date,
        v_appt_start_m,
        null,
        null,
        null,
        v_doc_interval
      ) then
        v_appt_day := trim(to_char(v_appt_date, 'FMDay'));
        raise exception 'ERR_APPOINTMENT_CONFLICT: Cannot save schedule because an existing appointment or active reservation on % (%) at % would fall outside your updated duty hours.',
          v_appt_day,
          to_char(v_appt_date, 'Mon DD, YYYY'),
          public.format_minutes_12h(v_appt_start_m)
          using errcode = '23514';
      end if;
    end if;
  end loop;

  -- Step 9: Canonicalize duty_schedule JSONB (prune inactive days so no ghost shifts persist)
  foreach v_day in array v_all_days loop
    if v_day = any(v_clean_days)
       and p_duty_schedule is not null
       and jsonb_typeof(p_duty_schedule) = 'object'
       and (p_duty_schedule ? 'weeklyShifts')
       and jsonb_typeof(p_duty_schedule->'weeklyShifts') = 'object'
       and jsonb_typeof(p_duty_schedule->'weeklyShifts'->v_day) = 'array' then
      v_clean_weekly := jsonb_set(v_clean_weekly, array[v_day], p_duty_schedule->'weeklyShifts'->v_day, true);
    else
      v_clean_weekly := jsonb_set(v_clean_weekly, array[v_day], '[]'::jsonb, true);
    end if;
  end loop;

  v_clean_schedule := jsonb_build_object(
    'weeklyShifts', v_clean_weekly,
    'slotIntervalMinutes', v_doc_interval,
    'slot_interval_minutes', v_doc_interval,
    'isCustomSchedule', (coalesce(array_length(v_clean_days, 1), 0) > 0)
  );

  if p_duty_schedule is not null and jsonb_typeof(p_duty_schedule) = 'object' then
    if p_duty_schedule ? 'maxPatientsPerShift' then
      v_clean_schedule := v_clean_schedule || jsonb_build_object(
        'maxPatientsPerShift', p_duty_schedule->'maxPatientsPerShift',
        'maxPatientsPerDay', p_duty_schedule->'maxPatientsPerShift'
      );
    end if;
  end if;

  -- Populate legacy top-level weekday keys ONLY for active days
  foreach v_day in array v_clean_days loop
    v_day_shifts := v_clean_weekly->v_day;
    if jsonb_typeof(v_day_shifts) = 'array' and jsonb_array_length(v_day_shifts) > 0 then
      v_clean_schedule := v_clean_schedule || jsonb_build_object(
        v_day,
        jsonb_build_object(
          'startTime', (v_day_shifts->0)->>'startTime',
          'endTime', (v_day_shifts->0)->>'endTime',
          'slotIntervalMinutes', coalesce(((v_day_shifts->0)->>'slotIntervalMinutes')::integer, v_doc_interval),
          'slot_interval_minutes', coalesce(((v_day_shifts->0)->>'slotIntervalMinutes')::integer, v_doc_interval)
        )
      );
    end if;
  end loop;

  if coalesce(array_length(v_clean_days, 1), 0) = 0 then
    v_primary_start := null;
    v_primary_end := null;
  else
    v_primary_start := coalesce(nullif(trim(coalesce(p_duty_start_time, '')), ''), v_primary_start);
    v_primary_end := coalesce(nullif(trim(coalesce(p_duty_end_time, '')), ''), v_primary_end);
  end if;

  -- Step 10: Perform the authorized UPDATE with context flag
  begin
    perform set_config('app.authorized_schedule_rpc', 'true', true);

    update public.clinic_doctor
    set duty_days = v_clean_days,
        duty_schedule = v_clean_schedule,
        duty_start_time = v_primary_start,
        duty_end_time = v_primary_end,
        updated_at = v_now
    where doctor_id = p_doctor_id
      and clinic_id = p_clinic_id;

    perform set_config('app.authorized_schedule_rpc', '', true);
  exception when others then
    perform set_config('app.authorized_schedule_rpc', '', true);
    raise;
  end;

  return jsonb_build_object(
    'success', true,
    'doctor_id', p_doctor_id,
    'clinic_id', p_clinic_id,
    'duty_days', to_jsonb(v_clean_days),
    'duty_schedule', v_clean_schedule,
    'duty_start_time', v_primary_start,
    'duty_end_time', v_primary_end,
    'updated_at', v_now
  );
end;
$$;

revoke all on function public.save_authorized_doctor_duty_schedule(uuid, uuid, text[], jsonb, varchar, varchar) from public, anon;
grant execute on function public.save_authorized_doctor_duty_schedule(uuid, uuid, text[], jsonb, varchar, varchar) to authenticated, service_role;


-- 7. Zero-PII Public Doctor Schedule Lookup RPC for Public Appointment Booking
-- Returns ONLY public scheduling and display fields (never email, contact_number, prc_license, user_id).
create or replace function public.get_clinic_public_doctor_schedules(
  p_clinic_id uuid
)
returns table (
  doctor_id uuid,
  clinic_id uuid,
  doctor_name text,
  photo_url text,
  status text,
  duty_days text[],
  duty_start_time varchar,
  duty_end_time varchar,
  duty_schedule jsonb,
  doctor_specializations jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_clinic_id is null then
    return;
  end if;

  return query
  select
    cd.doctor_id,
    cd.clinic_id,
    cd.doctor_name::text,
    cd.photo_url::text,
    coalesce(cd.status, 'Active')::text as status,
    cd.duty_days,
    cd.duty_start_time,
    cd.duty_end_time,
    cd.duty_schedule,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'specialization_id', ds.specialization_id,
            'specializations', jsonb_build_object(
              'id', s.id,
              'name', s.name
            )
          )
        )
        from public.doctor_specializations ds
        join public.specializations s on s.id = ds.specialization_id
        where ds.doctor_id = cd.doctor_id
      ),
      '[]'::jsonb
    ) as doctor_specializations
  from public.clinic_doctor cd
  join public.clinic c on c.clinic_id = cd.clinic_id
  where cd.clinic_id = p_clinic_id
    and lower(coalesce(c.status, 'approved')) = 'approved'
    and lower(coalesce(cd.status, 'active')) <> 'inactive'
  order by cd.created_at asc nulls last, cd.doctor_name asc;
end;
$$;

revoke all on function public.get_clinic_public_doctor_schedules(uuid) from public;
grant execute on function public.get_clinic_public_doctor_schedules(uuid) to anon, authenticated, service_role;


-- 8. ACQUIRE_APPOINTMENT_SLOT_HOLD (Preserves Complete Payment-Aware Hold Logic + Live Doctor Schedule Validation)
create or replace function public.acquire_appointment_slot_hold(
  p_clinic_id uuid,
  p_doctor_id uuid default null,
  p_date timestamptz default null,
  p_time varchar default null,
  p_batch_time varchar default null,
  p_patient_name text default null,
  p_patient_email text default null,
  p_patient_contact text default null,
  p_patient_address text default null,
  p_patient_gender text default null,
  p_patient_birthdate date default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_emergency_contact_relationship text default null,
  p_notes text default null,
  p_clinic_note text default null,
  p_questionnaire_answers jsonb default null,
  p_skin_photo_url text default null,
  p_ai_condition_name text default null,
  p_ai_confidence decimal default null,
  p_condition_id uuid default null,
  p_primary_scan_id uuid default null,
  p_hold_duration_minutes integer default 10,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid;
  v_is_service_role boolean;
  v_is_admin boolean;
  v_user_id uuid;
  v_cal_date date;
  v_time_clean varchar(20);
  v_slot_start_min integer;
  v_lock_key bigint;
  v_slot_lock_key bigint;
  v_doc_row record;
  v_active record;
  v_consultation_fee decimal(10,2);
  v_clinic_name text;
  v_appt_id uuid;
  v_ref text;
  v_hold_expires_at timestamptz;
  v_now timestamptz;
begin
  -- 1. Security & authentication resolution
  v_auth_uid := auth.uid();
  v_is_service_role := (coalesce(auth.role(), '') = 'service_role');
  begin
    v_is_admin := public.is_admin();
  exception when others then
    v_is_admin := false;
  end;

  if v_auth_uid is not null then
    if p_user_id is not null and p_user_id <> v_auth_uid and not v_is_admin and not v_is_service_role then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_FORBIDDEN',
        'error', 'ERR_FORBIDDEN',
        'message', 'You cannot create an appointment hold for another patient.'
      );
    end if;
    v_user_id := coalesce(p_user_id, v_auth_uid);
  else
    if (v_is_service_role or v_is_admin) and p_user_id is not null then
      v_user_id := p_user_id;
    else
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_UNAUTHORIZED',
        'error', 'ERR_UNAUTHORIZED',
        'message', 'Authentication required to acquire an appointment slot hold.'
      );
    end if;
  end if;

  v_now := now();

  -- 2. Normalisation (Asia/Manila calendar date, database clock for expiry)
  v_cal_date := (p_date at time zone 'Asia/Manila')::date;
  v_time_clean := left(trim(coalesce(p_time, p_batch_time, '08:00')), 5);
  v_slot_start_min := public.parse_appointment_time_minutes(coalesce(p_time, p_batch_time, '08:00'), p_date);
  v_hold_expires_at := v_now + (coalesce(p_hold_duration_minutes, 10) * interval '1 minute');

  -- 3. Concurrency locks in deterministic ascending key order (LEAST -> GREATEST)
  v_lock_key := hashtext(concat(
    coalesce(p_clinic_id::text, ''),
    coalesce(p_doctor_id::text, 'unassigned'),
    v_cal_date::text,
    v_time_clean
  ));
  v_slot_lock_key := hashtext(concat(
    'slot-wide|',
    coalesce(p_clinic_id::text, ''),
    v_cal_date::text,
    v_time_clean
  ));
  perform pg_advisory_xact_lock(least(v_lock_key, v_slot_lock_key));
  if v_lock_key <> v_slot_lock_key then
    perform pg_advisory_xact_lock(greatest(v_lock_key, v_slot_lock_key));
  end if;

  -- 3B. Lock target doctor affiliation FOR SHARE and validate latest duty schedule (Full Appointment Duration)
  if p_doctor_id is not null then
    select
      cd.doctor_id,
      cd.doctor_name,
      cd.status,
      cd.duty_days,
      cd.duty_schedule,
      cd.duty_start_time,
      cd.duty_end_time
    into v_doc_row
    from public.clinic_doctor cd
    where cd.doctor_id = p_doctor_id
      and cd.clinic_id = p_clinic_id
    for share of cd;

    if v_doc_row.doctor_id is null or lower(coalesce(v_doc_row.status, 'active')) = 'inactive' then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_OUTSIDE_DOCTOR_SCHEDULE',
        'error', 'ERR_OUTSIDE_DOCTOR_SCHEDULE',
        'message', 'The selected doctor is not active or available at this clinic branch.'
      );
    end if;

    if not public.is_slot_within_doctor_duty_schedule(
      v_doc_row.duty_days,
      v_doc_row.duty_schedule,
      v_doc_row.duty_start_time,
      v_doc_row.duty_end_time,
      v_cal_date,
      v_slot_start_min,
      null,
      null,
      null,
      30
    ) then
      return jsonb_build_object(
        'success', false,
        'code', 'ERR_OUTSIDE_DOCTOR_SCHEDULE',
        'error', 'ERR_OUTSIDE_DOCTOR_SCHEDULE',
        'message', 'This doctor''s duty schedule was recently updated and the selected consultation slot is no longer within their available duty hours. Please select another available time.'
      );
    end if;
  end if;

  -- 4. Reap genuinely EXPIRED holds (database clock)
  -- Holds with active external payment intents (pi_...) are protected and not reaped here
  begin
    perform set_config('app.internal_payment_context', 'true', true);

    with expired_candidates as (
      select appointment_id
      from public.patient_appointment
      where clinic_id = p_clinic_id
        and ((date at time zone 'Asia/Manila')::date = v_cal_date)
        and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
        and (
          p_doctor_id is null
          or assigned_doctor_id is null
          or assigned_doctor_id = p_doctor_id
        )
        and status not in ('cancelled', 'rejected')
        and (
          (payment_status = 'failed' and payment_hold_expires_at is not null and payment_hold_expires_at <= v_now)
          or (
            payment_status = 'pending_hold'
            and payment_hold_expires_at is not null
            and payment_hold_expires_at <= v_now
            and (payment_reference is null or payment_reference like 'SIM-%')
          )
          or (
            payment_status in ('pending_hold', 'failed')
            and payment_hold_expires_at is not null
            and payment_hold_expires_at <= (v_now - interval '1 hour')
          )
          or payment_status in ('expired', 'cancelled')
        )
      order by appointment_id
      for update
    )
    update public.patient_appointment pa
    set status = 'cancelled',
        payment_status = case
          when pa.payment_status = 'cancelled' then 'cancelled'
          else 'expired'
        end,
        clinic_note = case
          when pa.payment_status in ('pending_hold', 'failed')
            then coalesce(pa.clinic_note || ' | ', '') || 'Expired hold released by subsequent booking attempt.'
          else pa.clinic_note
        end
    from expired_candidates ec
    where pa.appointment_id = ec.appointment_id;

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  -- 5. Evaluate ALL remaining active occupants of this slot
  select appointment_id, user_id, payment_status, payment_hold_expires_at,
         payment_reference, payment_amount, assigned_doctor_id
  into v_active
  from public.patient_appointment
  where clinic_id = p_clinic_id
    and ((date at time zone 'Asia/Manila')::date = v_cal_date)
    and (left(trim(coalesce(time, batch_time, '')), 5) = v_time_clean)
    and (
      p_doctor_id is null
      or assigned_doctor_id is null
      or assigned_doctor_id = p_doctor_id
    )
    and status not in ('cancelled', 'rejected')
    and (doctor_status is null or doctor_status <> 'rejected')
    and coalesce(payment_status, 'paid') not in ('expired', 'cancelled')
    and not (
      (payment_status = 'failed' and payment_hold_expires_at is not null and payment_hold_expires_at <= v_now)
      or (
        payment_status = 'pending_hold'
        and payment_hold_expires_at is not null
        and payment_hold_expires_at <= v_now
        and (payment_reference is null or payment_reference like 'SIM-%')
      )
      or (
        payment_status in ('pending_hold', 'failed')
        and payment_hold_expires_at is not null
        and payment_hold_expires_at <= (v_now - interval '1 hour')
      )
    )
  order by
    case when coalesce(payment_status, 'paid') not in ('pending_hold', 'failed') then 0 else 1 end,
    case
      when user_id is distinct from v_user_id
        or (assigned_doctor_id is distinct from p_doctor_id)
        then 0
      else 1
    end,
    created_at desc
  limit 1;

  if v_active.appointment_id is not null then
    -- A. Idempotent retry: SAME user, SAME doctor scope, still-active hold
    if v_active.user_id = v_user_id
       and v_active.payment_status in ('pending_hold', 'failed')
       and (
         v_active.payment_hold_expires_at is null
         or v_active.payment_hold_expires_at > v_now
         or (v_active.payment_reference is not null and v_active.payment_reference not like 'SIM-%')
       )
       and (v_active.assigned_doctor_id is not distinct from p_doctor_id) then
      select name into v_clinic_name from public.clinic where clinic_id = p_clinic_id;
      return jsonb_build_object(
        'success', true,
        'appointment_id', v_active.appointment_id,
        'payment_reference', coalesce(v_active.payment_reference, 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD'))),
        'payment_amount', coalesce(v_active.payment_amount, 500.00),
        'fee', coalesce(v_active.payment_amount, 500.00),
        'currency', 'PHP',
        'hold_expires_at', v_active.payment_hold_expires_at,
        'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
        'payment_status', v_active.payment_status,
        'clinic_name', coalesce(v_clinic_name, 'Clinic'),
        'is_existing_hold', true
      );
    end if;

    -- B. Anything else is a hard conflict; never release or alter another patient's hold
    return jsonb_build_object(
      'success', false,
      'code', 'ERR_SLOT_UNAVAILABLE',
      'error', 'ERR_SLOT_UNAVAILABLE',
      'message', 'This consultation slot has just been reserved by another patient. Please select another available time.'
    );
  end if;

  -- 6. Authoritative consultation fee and clinic name
  select coalesce(consultation_fee, 500.00), name
  into v_consultation_fee, v_clinic_name
  from public.clinic
  where clinic_id = p_clinic_id;

  if v_consultation_fee is null then
    v_consultation_fee := 500.00;
  end if;

  v_ref := 'SIM-HOLD-' || upper(to_char(v_now, 'YYYYMMDD')) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- 7. Insert the new temporary hold
  begin
    perform set_config('app.internal_payment_context', 'true', true);

    insert into public.patient_appointment (
      clinic_id, assigned_doctor_id, user_id, date, time, batch_time,
      patient_name, patient_email, patient_contact, patient_address,
      patient_gender, patient_birthdate, emergency_contact_name,
      emergency_contact_phone, emergency_contact_relationship, notes,
      clinic_note, questionnaire_answers, skin_photo_url, ai_condition_name,
      ai_confidence, condition_id, primary_scan_id, status, payment_status,
      payment_amount, payment_reference, payment_hold_expires_at, created_at
    ) values (
      p_clinic_id, p_doctor_id, v_user_id, p_date, v_time_clean, v_time_clean,
      p_patient_name, p_patient_email, p_patient_contact, p_patient_address,
      p_patient_gender, p_patient_birthdate, p_emergency_contact_name,
      p_emergency_contact_phone, p_emergency_contact_relationship, p_notes,
      coalesce(p_clinic_note, 'Temporary slot hold acquired pending upfront payment.'),
      p_questionnaire_answers, p_skin_photo_url, p_ai_condition_name,
      p_ai_confidence, p_condition_id, p_primary_scan_id, 'pending', 'pending_hold',
      v_consultation_fee, v_ref, v_hold_expires_at, v_now
    )
    returning appointment_id into v_appt_id;

    perform set_config('app.internal_payment_context', '', true);
  exception when others then
    perform set_config('app.internal_payment_context', '', true);
    raise;
  end;

  return jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'payment_reference', v_ref,
    'payment_amount', v_consultation_fee,
    'fee', v_consultation_fee,
    'currency', 'PHP',
    'hold_expires_at', v_hold_expires_at,
    'hold_duration_minutes', coalesce(p_hold_duration_minutes, 10),
    'payment_status', 'pending_hold',
    'clinic_name', coalesce(v_clinic_name, 'Clinic')
  );
end;
$$;

revoke all on function public.acquire_appointment_slot_hold(uuid, uuid, timestamptz, varchar, varchar, text, text, text, text, text, date, text, text, text, text, text, jsonb, text, text, decimal, uuid, uuid, integer, uuid) from public;
grant execute on function public.acquire_appointment_slot_hold(uuid, uuid, timestamptz, varchar, varchar, text, text, text, text, text, date, text, text, text, text, text, jsonb, text, text, decimal, uuid, uuid, integer, uuid) to authenticated, anon, service_role;


-- 9. Column-Level Privileges, RLS Hardening, and Realtime Publication on public.clinic_doctor
-- Revoke table-wide privileges from PUBLIC and anon; grant anon SELECT ONLY on non-PII columns
revoke all on table public.clinic_doctor from public, anon;
grant select (
  doctor_id,
  clinic_id,
  doctor_name,
  photo_url,
  status,
  duty_days,
  duty_start_time,
  duty_end_time,
  duty_schedule,
  created_at,
  updated_at
) on table public.clinic_doctor to anon;

-- Ensure authenticated retains required privileges for Clinic Portal and Doctor Portal queries
grant select, insert, update, delete on table public.clinic_doctor to authenticated, service_role;

-- Public approved-clinic active doctor read policy for anon (column grants restrict visible columns to non-PII)
drop policy if exists "clinic_doctor_public_approved_schedule_read" on public.clinic_doctor;
create policy "clinic_doctor_public_approved_schedule_read"
  on public.clinic_doctor
  for select
  to anon
  using (
    lower(coalesce(status, 'active')) <> 'inactive'
    and exists (
      select 1
      from public.clinic c
      where c.clinic_id = clinic_doctor.clinic_id
        and lower(coalesce(c.status, 'approved')) = 'approved'
    )
  );

-- Restrictive write policies so anon and patient users can never insert/update/delete clinic_doctor rows
drop policy if exists "clinic_doctor_authorized_insert" on public.clinic_doctor;
create policy "clinic_doctor_authorized_insert"
  on public.clinic_doctor
  as restrictive
  for insert
  to authenticated
  with check (
    public.is_clinic_owner(clinic_id) or public.is_admin()
  );

drop policy if exists "clinic_doctor_authorized_update" on public.clinic_doctor;
create policy "clinic_doctor_authorized_update"
  on public.clinic_doctor
  as restrictive
  for update
  to authenticated
  using (
    public.is_clinic_owner(clinic_id)
    or public.is_admin()
    or (user_id is not null and user_id = auth.uid() and lower(coalesce(status, 'active')) = 'active')
  )
  with check (
    public.is_clinic_owner(clinic_id)
    or public.is_admin()
    or (user_id is not null and user_id = auth.uid() and lower(coalesce(status, 'active')) = 'active')
  );

drop policy if exists "clinic_doctor_authorized_delete" on public.clinic_doctor;
create policy "clinic_doctor_authorized_delete"
  on public.clinic_doctor
  as restrictive
  for delete
  to authenticated
  using (
    public.is_clinic_owner(clinic_id) or public.is_admin()
  );

-- Ensure public.clinic_doctor is in supabase_realtime publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'clinic_doctor'
    ) then
      alter publication supabase_realtime add table public.clinic_doctor;
    end if;
  end if;
exception when others then
  null;
end;
$$;
