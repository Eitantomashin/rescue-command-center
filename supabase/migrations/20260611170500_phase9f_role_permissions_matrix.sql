-- Phase 9F: central role permission matrix.
-- Forward-only. Keeps incident_memberships and all operational data intact.

create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
$$;

create or replace function public.can_manage_incidents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'commander')
$$;

create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.incident_memberships im
      where im.incident_id = p_incident_id
        and im.user_id = public.current_actor_id()
    )
$$;

create or replace function public.can_manage_sites(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'commander'
      and exists (
        select 1
        from public.incident_memberships im
        where im.incident_id = p_incident_id
          and im.user_id = public.current_actor_id()
          and im.role = 'incident_commander'
      )
    )
  ) and exists (
    select 1 from public.incidents i
    where i.id = p_incident_id and i.archived_at is null
  )
$$;

create or replace function public.can_edit_operational_data(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() in ('commander', 'editor')
      and exists (
        select 1
        from public.incident_memberships im
        where im.incident_id = p_incident_id
          and im.user_id = public.current_actor_id()
          and im.role in ('incident_commander', 'command_post_operator')
      )
    )
  ) and exists (
    select 1 from public.incidents i
    where i.id = p_incident_id and i.archived_at is null
  )
$$;

create or replace function public.can_write_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_operational_data(p_incident_id)
    and exists (
      select 1 from public.incidents i
      where i.id = p_incident_id
        and i.is_closed = false
        and i.archived_at is null
    )
$$;

create or replace function public.can_edit_personnel(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_operational_data(p_incident_id)
$$;

create or replace function public.can_manage_unit_personnel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'commander')
$$;

create or replace function public.assert_manage_users()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_users() then
    raise exception 'User management permission is required';
  end if;
end;
$$;

create or replace function public.assert_manage_incidents()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_incidents() then
    raise exception 'Incident management permission is required';
  end if;
end;
$$;

create or replace function public.assert_manage_sites(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_sites(p_incident_id) then
    raise exception 'Site management permission is required';
  end if;
end;
$$;

create or replace function public.assert_edit_operational_data(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_edit_operational_data(p_incident_id) then
    raise exception 'Operational edit permission is required';
  end if;
end;
$$;

create or replace function public.assert_edit_personnel(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_edit_personnel(p_incident_id) then
    raise exception 'Personnel edit permission is required';
  end if;
end;
$$;

create or replace function public.assert_manage_unit_personnel()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_unit_personnel() then
    raise exception 'Unit personnel management permission is required';
  end if;
end;
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
  select is_closed, archived_at into v_is_closed, v_archived_at
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
    if public.current_user_role() <> 'admin' and not public.can_command_incident(p_incident_id) then
      raise exception 'Incident commander membership is required';
    end if;
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
  else
    perform public.assert_edit_operational_data(p_incident_id);
  end if;
end;
$$;

drop function if exists public.list_user_profiles();
create function public.list_user_profiles()
returns table (
  id uuid,
  display_name text,
  email text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_manage_users();

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    p.role,
    p.created_at,
    u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.created_at desc;
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

  if p_role not in ('admin', 'commander', 'editor', 'viewer') then
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

drop policy if exists incidents_authorized_insert on public.incidents;
create policy incidents_authorized_insert
  on public.incidents for insert
  with check (public.can_manage_incidents());

drop policy if exists incidents_commander_update on public.incidents;
create policy incidents_commander_update
  on public.incidents for update
  using (
    archived_at is null
    and (
      public.current_user_role() = 'admin'
      or (public.can_manage_incidents() and public.can_command_incident(id) and is_closed = false)
    )
  )
  with check (
    archived_at is null
    and (
      public.current_user_role() = 'admin'
      or (public.can_manage_incidents() and public.can_command_incident(id) and is_closed = false)
    )
  );

drop policy if exists sites_operator_mutate on public.sites;
create policy sites_operator_mutate
  on public.sites for all
  using (public.can_manage_sites(incident_id))
  with check (public.can_manage_sites(incident_id));

drop policy if exists floors_operator_mutate on public.floors;
create policy floors_operator_mutate
  on public.floors for all
  using (public.can_manage_sites(incident_id))
  with check (public.can_manage_sites(incident_id));

drop policy if exists unit_personnel_authenticated_mutate on public.unit_personnel;
create policy unit_personnel_authenticated_mutate
  on public.unit_personnel for all
  using (public.can_manage_unit_personnel())
  with check (public.can_manage_unit_personnel());

drop policy if exists event_personnel_status_operator_mutate on public.event_personnel_status;
create policy event_personnel_status_operator_mutate
  on public.event_personnel_status for all
  using (public.can_edit_personnel(incident_id))
  with check (public.can_edit_personnel(incident_id));

-- Enforce incident creation for admin/commander only.
create or replace function public.create_incident_from_wizard(
  p_incident_name text,
  p_incident_type text,
  p_city text,
  p_address text default null,
  p_initial_description text default null,
  p_command_structure jsonb default '{}'::jsonb,
  p_teams jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_incident_id uuid;
  v_status_id uuid;
  v_team_status_id uuid;
  v_team jsonb;
  v_team_number integer;
  v_commander_name text;
  v_phone text;
  v_personnel_count integer;
begin
  v_actor_id := public.current_actor_id();
  v_actor_role := public.current_user_role();

  if v_actor_id is null then
    raise exception 'לא זוהה משתמש מחובר';
  end if;

  if not public.can_manage_incidents() then
    raise exception 'אין הרשאה לפתיחת אירוע חדש';
  end if;

  if nullif(btrim(p_incident_name), '') is null then
    raise exception 'שם האירוע הוא שדה חובה';
  end if;

  if nullif(btrim(p_incident_type), '') is null then
    raise exception 'סוג האירוע הוא שדה חובה';
  end if;

  if p_incident_type not in (
    'missile_strike',
    'structure_collapse',
    'earthquake',
    'fire',
    'hazmat',
    'flood',
    'height_rescue',
    'elevator_rescue',
    'other'
  ) then
    raise exception 'סוג האירוע אינו תקין';
  end if;

  if nullif(btrim(p_city), '') is null then
    raise exception 'עיר ראשית היא שדה חובה';
  end if;

  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then
    raise exception 'רשימת הצוותים לא נשלחה בצורה תקינה';
  end if;

  v_status_id := public.get_status_id('incident', 'active', null);
  v_team_status_id := public.get_status_id('team', 'available', null);

  if v_status_id is null then
    raise exception 'סטטוס אירוע פעיל לא קיים';
  end if;

  if v_team_status_id is null then
    raise exception 'סטטוס צוות זמין לא קיים';
  end if;

  insert into public.incidents (
    name,
    incident_type,
    city,
    address,
    initial_description,
    command_structure,
    opened_at,
    status_id,
    is_closed,
    created_by,
    updated_by
  )
  values (
    btrim(p_incident_name),
    p_incident_type,
    btrim(p_city),
    coalesce(nullif(btrim(p_address), ''), btrim(p_city)),
    nullif(btrim(p_initial_description), ''),
    coalesce(p_command_structure, '{}'::jsonb),
    now(),
    v_status_id,
    false,
    v_actor_id,
    v_actor_id
  )
  returning id into v_incident_id;

  insert into public.incident_memberships (
    incident_id,
    user_id,
    role,
    created_by
  )
  values (
    v_incident_id,
    v_actor_id,
    'incident_commander',
    v_actor_id
  )
  on conflict (incident_id, user_id) do nothing;

  for v_team in select value from jsonb_array_elements(p_teams)
  loop
    v_team_number := nullif(v_team->>'teamNumber', '')::integer;
    v_commander_name := nullif(btrim(coalesce(v_team->>'leader', '')), '');
    v_phone := nullif(btrim(coalesce(v_team->>'phone', '')), '');
    v_personnel_count := nullif(v_team->>'rescuers', '')::integer;

    if v_team_number is null or v_team_number <= 0 then
      raise exception 'מספר צוות חייב להיות מספר תקין';
    end if;

    insert into public.teams (
      incident_id,
      team_number,
      name,
      commander_name,
      phone,
      personnel_count,
      status_id,
      is_active,
      created_by,
      updated_by
    )
    values (
      v_incident_id,
      v_team_number,
      case
        when v_team_number = 9 then 'צוות 9 אוכלוסייה'
        else 'צוות ' || v_team_number
      end,
      v_commander_name,
      v_phone,
      v_personnel_count,
      v_team_status_id,
      true,
      v_actor_id,
      v_actor_id
    )
    on conflict (incident_id, team_number) do update
    set
      commander_name = excluded.commander_name,
      phone = excluded.phone,
      personnel_count = excluded.personnel_count,
      updated_by = v_actor_id,
      updated_at = now();
  end loop;

  perform public.create_event_log(
    v_incident_id,
    'incident_created',
    'פתיחת אירוע',
    'נפתח אירוע ' || btrim(p_incident_name),
    'administrative',
    'important',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    null,
    jsonb_build_object(
      'incident_id', v_incident_id,
      'incident_name', btrim(p_incident_name),
      'incident_type', p_incident_type,
      'city', btrim(p_city),
      'address', nullif(btrim(p_address), ''),
      'assigned_teams', p_teams
    )
  );

  return v_incident_id;
end;
$$;

-- Protect the unit personnel roster.
create or replace function public.create_unit_personnel(
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null,
  p_role_other text default null,
  p_department_other text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_last_name text;
  v_mobile_phone text;
begin
  perform public.assert_manage_unit_personnel();

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  v_mobile_phone := nullif(regexp_replace(coalesce(p_mobile_phone, ''), '[^\d+]', '', 'g'), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  if v_mobile_phone is not null and exists (
    select 1
    from public.unit_personnel up
    where nullif(regexp_replace(coalesce(up.mobile_phone, ''), '[^\d+]', '', 'g'), '') = v_mobile_phone
  ) then
    raise exception 'האדם כבר קיים ברשימת כ"א';
  end if;

  if v_mobile_phone is null and exists (
    select 1
    from public.unit_personnel up
    where lower(btrim(up.first_name)) = lower(v_first_name)
      and lower(btrim(up.last_name)) = lower(v_last_name)
  ) then
    raise exception 'האדם כבר קיים ברשימת כ"א';
  end if;

  insert into public.unit_personnel (
    first_name,
    last_name,
    role,
    department,
    mobile_phone,
    role_other,
    department_other,
    created_by
  )
  values (
    v_first_name,
    v_last_name,
    p_role,
    p_department,
    nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    case when p_role = 'other' then nullif(btrim(coalesce(p_role_other, '')), '') else null end,
    case when p_department = 'other' then nullif(btrim(coalesce(p_department_other, '')), '') else null end,
    public.current_actor_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_unit_personnel(
  p_personnel_id uuid,
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null,
  p_is_active boolean default true,
  p_role_other text default null,
  p_department_other text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  perform public.assert_manage_unit_personnel();

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  update public.unit_personnel
  set
    first_name = v_first_name,
    last_name = v_last_name,
    role = p_role,
    department = p_department,
    mobile_phone = nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    role_other = case when p_role = 'other' then nullif(btrim(coalesce(p_role_other, '')), '') else null end,
    department_other = case when p_department = 'other' then nullif(btrim(coalesce(p_department_other, '')), '') else null end,
    is_active = coalesce(p_is_active, true)
  where id = p_personnel_id;

  if not found then
    raise exception 'Personnel record not found';
  end if;
end;
$$;
