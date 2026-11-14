-- Fix Clinic Verification RPC and permissions
create or replace function public.set_clinic_status(
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
    v_clinic_name varchar(200);
    v_clinic_email varchar(100);
begin
    -- Validate target status
    if new_status not in ('approved', 'rejected', 'pending') then
        raise exception 'Invalid clinic status: %', new_status
            using errcode = '22023';
    end if;

    -- Update clinic table atomically (as postgres security definer)
    update public.clinic
    set status = new_status,
        verified = (new_status = 'approved'),
        updated_at = now()
    where clinic_id = target_clinic_id
    returning owner_user_id, name, email
    into v_owner_id, v_clinic_name, v_clinic_email;

    if not found then
        return false;
    end if;

    -- If owner_user_id is not linked yet, find the user by clinic email and link it
    if v_owner_id is null and v_clinic_email is not null then
        select user_id into v_owner_id
        from public."user"
        where lower(trim(email)) = lower(trim(v_clinic_email))
        limit 1;

        if v_owner_id is not null then
            update public.clinic
            set owner_user_id = v_owner_id
            where clinic_id = target_clinic_id;
        end if;
    end if;

    -- If approved, update user role to clinic and send approval notification
    if v_owner_id is not null and new_status = 'approved' then
        update public."user"
        set role = 'clinic'
        where user_id = v_owner_id
          and role <> 'admin';

        insert into public.user_notification
            (user_id, type, subtype, title, body, is_read)
        values (
            v_owner_id,
            'system',
            'clinic_approval',
            'Clinic Application Approved!',
            'Congratulations! Your clinic "' ||
                coalesce(v_clinic_name, 'Clinic') ||
                '" has been verified and approved by DermAI Admin. All clinic tools are now active.',
            false
        );

    elsif v_owner_id is not null and new_status = 'rejected' then
        insert into public.user_notification
            (user_id, type, subtype, title, body, is_read)
        values (
            v_owner_id,
            'system',
            'clinic_rejection',
            'Clinic Application Status Update',
            'Your application for "' ||
                coalesce(v_clinic_name, 'Clinic') ||
                '" was not approved. Reason: ' ||
                coalesce(reason, 'Requirements were incomplete.'),
            false
        );
    end if;

    return true;
end;
$$;

grant execute on function public.set_clinic_status(uuid, varchar, text) to authenticated, anon, service_role;

