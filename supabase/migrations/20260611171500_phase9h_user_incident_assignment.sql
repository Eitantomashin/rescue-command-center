-- Phase 9H: admin-managed user assignment to active incidents.
-- Uses the existing incident_memberships table and its established role values.

create or replace function public.set_user_incident_assignments(
  p_user_id uuid,
  p_incident_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_role text;
  v_membership_role text;
  v_incident_id uuid;
  v_requested_ids uuid[] := coalesce(p_incident_ids, '{}'::uuid[]);
begin
  perform public.assert_admin();

  select p.role
  into v_system_role
  from public.profiles p
  where p.id = p_user_id;

  if not found then
    raise exception 'User profile does not exist';
  end if;

  v_membership_role := case v_system_role
    when 'commander' then 'incident_commander'
    when 'editor' then 'command_post_operator'
    when 'viewer' then 'observer'
    else null
  end;

  if v_membership_role is null then
    raise exception 'Incident assignment is supported for commander, editor, or viewer roles';
  end if;

  if exists (
    select 1
    from unnest(v_requested_ids) as requested(requested_id)
    left join public.incidents i on i.id = requested.requested_id
    where i.id is null or i.archived_at is not null
  ) then
    raise exception 'Only active incidents can be assigned';
  end if;

  delete from public.incident_memberships im
  using public.incidents i
  where im.incident_id = i.id
    and im.user_id = p_user_id
    and i.archived_at is null
    and not (im.incident_id = any(v_requested_ids));

  foreach v_incident_id in array v_requested_ids
  loop
    insert into public.incident_memberships (
      incident_id,
      user_id,
      role,
      created_by
    )
    values (
      v_incident_id,
      p_user_id,
      v_membership_role,
      public.current_actor_id()
    )
    on conflict (incident_id, user_id) do update
    set role = excluded.role;
  end loop;
end;
$$;
