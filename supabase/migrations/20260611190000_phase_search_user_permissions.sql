-- Search Site Phase 5C: search_user role and scoped Search Site access.
-- search_user can access Search Sites in assigned incidents, without rescue-site or operational edit permissions.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'commander', 'editor', 'viewer', 'search_user'));

create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() = 'commander'
          and (
            i.archived_at is null
            or exists (
              select 1
              from public.incident_memberships commander_membership
              where commander_membership.incident_id = i.id
                and commander_membership.user_id = public.current_actor_id()
            )
          )
        )
        or (
          i.archived_at is null
          and public.current_user_role() in ('editor', 'viewer', 'search_user')
          and exists (
            select 1
            from public.incident_memberships im
            where im.incident_id = i.id
              and im.user_id = public.current_actor_id()
          )
        )
      )
  )
$$;

create or replace function public.can_read_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() <> 'search_user'
    and public.can_view_incident(p_incident_id)
$$;

create or replace function public.can_view_search_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.site_type = 'search_site'
      and (
        public.can_read_incident(s.incident_id)
        or (
          public.current_user_role() = 'search_user'
          and exists (
            select 1
            from public.incident_memberships im
            where im.incident_id = s.incident_id
              and im.user_id = public.current_actor_id()
          )
        )
      )
  )
$$;

create or replace function public.can_edit_search_site_data(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_write_incident(p_incident_id)
    or exists (
      select 1
      from public.incidents i
      where i.id = p_incident_id
        and i.is_closed = false
        and i.archived_at is null
        and public.current_user_role() = 'search_user'
        and exists (
          select 1
          from public.incident_memberships im
          where im.incident_id = i.id
            and im.user_id = public.current_actor_id()
        )
    )
$$;

create or replace function public.assert_edit_search_site_data(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_edit_search_site_data(p_incident_id) then
    raise exception 'Search Site edit permission is required';
  end if;
end;
$$;

create or replace function public.can_write_search_event_log(
  p_incident_id uuid,
  p_log_type text,
  p_site_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_log_type in (
      'search_unit_apartment_searched',
      'search_unit_no_answer',
      'search_unit_casualties_found',
      'search_unit_completed'
    )
    and p_site_id is not null
    and public.can_edit_search_site_data(p_incident_id)
    and exists (
      select 1
      from public.sites s
      where s.id = p_site_id
        and s.incident_id = p_incident_id
        and s.site_type = 'search_site'
    )
$$;

create or replace function public.assert_incident_writable(
  p_incident_id uuid,
  p_action text default null,
  p_is_authorized_correction boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_closed boolean;
  v_archived_at timestamptz;
  v_action text := coalesce(p_action, 'unknown');
begin
  select is_closed, archived_at
  into v_is_closed, v_archived_at
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  if not public.can_view_incident(p_incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  if v_archived_at is not null then
    raise exception 'Archived incidents are read-only';
  end if;

  if v_is_closed
    and public.current_user_role() <> 'admin'
    and not (p_is_authorized_correction and public.can_correct_closed_incident(p_incident_id))
  then
    raise exception 'Incident is closed and read-only for action %', v_action;
  end if;

  if v_action in ('close_incident', 'update_incident') then
    perform public.assert_manage_incidents();
  elsif v_action in (
    'create_site_with_structure',
    'create_site_from_wizard',
    'set_floor_unit_count',
    'renumber_site_units_continuous',
    'repair_site_wizard_unit_numbering',
    'update_site_grid_image',
    'update_site'
  ) then
    perform public.assert_manage_sites(p_incident_id);
  elsif v_action in ('set_event_personnel_status') then
    perform public.assert_edit_personnel(p_incident_id);
  elsif v_action in ('create_or_update_search_unit', 'complete_search_unit') then
    perform public.assert_edit_search_site_data(p_incident_id);
  else
    perform public.assert_edit_operational_data(p_incident_id);
  end if;
end;
$$;

create or replace function public.create_event_log(
  p_incident_id uuid,
  p_log_type text,
  p_title text,
  p_description text default null,
  p_category text default 'operational',
  p_importance text default 'normal',
  p_reported_at timestamptz default now(),
  p_site_id uuid default null,
  p_floor_id uuid default null,
  p_unit_id uuid default null,
  p_person_id uuid default null,
  p_team_id uuid default null,
  p_source_type text default null,
  p_source_name text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_write_incident(p_incident_id)
    and not public.can_write_search_event_log(p_incident_id, p_log_type, p_site_id)
  then
    raise exception 'User is not allowed to write event logs for this incident';
  end if;

  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
    team_id,
    log_type,
    category,
    reported_at,
    source_type,
    source_name,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    p_incident_id,
    p_site_id,
    p_floor_id,
    p_unit_id,
    p_person_id,
    p_team_id,
    p_log_type,
    p_category,
    coalesce(p_reported_at, now()),
    p_source_type,
    p_source_name,
    p_title,
    p_description,
    coalesce(p_importance, 'normal'),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  returning id into v_id;

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_id;
end;
$$;

-- Search users may see only Search Sites, while all existing roles keep their existing incident read access.
drop policy if exists sites_member_select on public.sites;
create policy sites_member_select
  on public.sites for select
  using (
    public.can_read_incident(incident_id)
    or (
      public.current_user_role() = 'search_user'
      and site_type = 'search_site'
      and public.can_view_incident(incident_id)
    )
  );

drop policy if exists floors_member_select on public.floors;
create policy floors_member_select
  on public.floors for select
  using (
    public.can_read_incident(incident_id)
    or (
      public.current_user_role() = 'search_user'
      and exists (
        select 1
        from public.sites s
        where s.id = floors.site_id
          and s.site_type = 'search_site'
          and public.can_view_incident(s.incident_id)
      )
    )
  );

drop policy if exists units_member_select on public.units;
create policy units_member_select
  on public.units for select
  using (
    public.can_read_incident(incident_id)
    or (
      public.current_user_role() = 'search_user'
      and exists (
        select 1
        from public.sites s
        where s.id = units.site_id
          and s.site_type = 'search_site'
          and public.can_view_incident(s.incident_id)
      )
    )
  );

drop policy if exists site_search_units_member_select on public.site_search_units;
create policy site_search_units_member_select
  on public.site_search_units for select
  using (
    public.can_read_incident(incident_id)
    or public.can_view_search_site(site_id)
  );

-- Keep direct table mutation restricted for ordinary operational roles; search_user writes go through approved RPCs.
drop policy if exists site_search_units_operator_mutate on public.site_search_units;
create policy site_search_units_operator_mutate
  on public.site_search_units for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

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
    when 'search_user' then 'observer'
    else null
  end;

  if v_membership_role is null then
    raise exception 'Incident assignment is supported for commander, editor, viewer, or search_user roles';
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


create or replace function public.update_profile_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();

  if p_role not in ('admin', 'commander', 'editor', 'viewer', 'search_user') then
    raise exception 'Invalid role %', p_role;
  end if;

  update public.profiles
  set role = p_role,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile % does not exist', p_user_id;
  end if;
end;
$$;

create or replace function public.set_created_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_manage_users();

  if p_role not in ('admin', 'commander', 'editor', 'viewer', 'search_user') then
    raise exception 'Invalid role %', p_role;
  end if;

  insert into public.profiles (id, display_name, role)
  values (p_user_id, nullif(btrim(p_display_name), ''), p_role)
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      updated_at = now();
end;
$$;
grant execute on function public.can_view_search_site(uuid) to authenticated;
grant execute on function public.can_edit_search_site_data(uuid) to authenticated;
grant execute on function public.assert_edit_search_site_data(uuid) to authenticated;
grant execute on function public.can_write_search_event_log(uuid, text, uuid) to authenticated;
grant execute on function public.set_user_incident_assignments(uuid, uuid[]) to authenticated;