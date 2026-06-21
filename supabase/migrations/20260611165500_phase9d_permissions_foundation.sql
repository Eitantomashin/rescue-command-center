-- Phase 9D: permissions foundation for multi-user YANSHOF.
-- Forward-only migration. Keeps incident_memberships and existing operational workflows.

alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = case role
  when 'system_administrator' then 'admin'
  when 'incident_commander' then 'commander'
  when 'command_post_operator' then 'editor'
  when 'observer' then 'viewer'
  else role
end;

alter table public.profiles
  alter column role set default 'viewer';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'commander', 'editor', 'viewer'));

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  )), '');

  insert into public.profiles (id, display_name, role)
  values (new.id, v_display_name, 'viewer')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;

create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.prevent_non_admin_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
    and public.current_user_role() <> 'admin'
  then
    raise exception 'Admin permission is required to change system roles';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_non_admin_role_change on public.profiles;

create trigger profiles_prevent_non_admin_role_change
  before update on public.profiles
  for each row execute function public.prevent_non_admin_profile_role_change();

insert into public.profiles (id, display_name, role)
select
  u.id,
  nullif(btrim(coalesce(
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(u.email, '@', 1)
  )), ''),
  'viewer'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p
  from public.profiles p
  where p.id = public.current_actor_id()
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p.role
    when 'system_administrator' then 'admin'
    when 'incident_commander' then 'commander'
    when 'command_post_operator' then 'editor'
    when 'observer' then 'viewer'
    else p.role
  end
  from public.profiles p
  where p.id = public.current_actor_id()
$$;

create or replace function public.current_user_incident_role(p_incident_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() = 'admin' then 'system_administrator'
    else (
      select im.role
      from public.incident_memberships im
      where im.incident_id = p_incident_id
        and im.user_id = public.current_actor_id()
      limit 1
    )
  end
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Admin permission is required';
  end if;
end;
$$;

create or replace function public.assert_incident_viewer(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() = 'admin' then
    return;
  end if;

  if not exists (
    select 1
    from public.incident_memberships im
    where im.incident_id = p_incident_id
      and im.user_id = public.current_actor_id()
  ) then
    raise exception 'User is not allowed to access this incident';
  end if;
end;
$$;

create or replace function public.assert_incident_editor(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_system_role text;
  v_membership_role text;
begin
  v_system_role := public.current_user_role();

  if v_system_role = 'admin' then
    return;
  end if;

  select im.role
  into v_membership_role
  from public.incident_memberships im
  where im.incident_id = p_incident_id
    and im.user_id = public.current_actor_id()
  limit 1;

  if v_system_role not in ('commander', 'editor')
    or coalesce(v_membership_role, 'observer') not in ('incident_commander', 'command_post_operator')
  then
    raise exception 'User is not allowed to edit this incident';
  end if;
end;
$$;

create or replace function public.can_read_incident(p_incident_id uuid)
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

create or replace function public.can_write_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() = 'admin' then true
    when i.is_closed then false
    else exists (
      select 1
      from public.incident_memberships im
      where im.incident_id = p_incident_id
        and im.user_id = public.current_actor_id()
        and im.role in ('incident_commander', 'command_post_operator')
    )
    and public.current_user_role() in ('commander', 'editor')
  end
  from public.incidents i
  where i.id = p_incident_id
$$;

create or replace function public.can_command_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
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
$$;

create or replace function public.can_correct_closed_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select i.is_closed = true
    and (
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
    )
  from public.incidents i
  where i.id = p_incident_id
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
begin
  select is_closed into v_is_closed
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  if not public.can_read_incident(p_incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  if v_is_closed
    and public.current_user_role() <> 'admin'
    and not (p_is_authorized_correction and public.can_correct_closed_incident(p_incident_id))
  then
    raise exception 'Incident is closed and read-only for action %', coalesce(p_action, 'unknown');
  end if;

  if not v_is_closed and not public.can_write_incident(p_incident_id) then
    raise exception 'User is not allowed to edit this incident';
  end if;
end;
$$;

create or replace function public.list_user_profiles()
returns table (
  id uuid,
  display_name text,
  email text,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_admin();

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    p.role,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.created_at desc;
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

  if p_role not in ('admin', 'commander', 'editor', 'viewer') then
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

drop policy if exists profiles_self_or_admin_select on public.profiles;
create policy profiles_self_or_admin_select
  on public.profiles for select
  using (id = public.current_actor_id() or public.current_user_role() = 'admin');

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update
  using (id = public.current_actor_id())
  with check (id = public.current_actor_id());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all
  on public.profiles for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists status_types_admin_or_commander_mutate on public.status_types;
create policy status_types_admin_or_commander_mutate
  on public.status_types for all
  using (
    public.current_user_role() = 'admin'
    or (
      incident_id is not null
      and public.can_command_incident(incident_id)
    )
  )
  with check (
    public.current_user_role() = 'admin'
    or (
      incident_id is not null
      and public.can_command_incident(incident_id)
    )
  );

drop policy if exists incidents_authorized_insert on public.incidents;
create policy incidents_authorized_insert
  on public.incidents for insert
  with check (public.current_user_role() in ('admin', 'commander', 'editor'));

drop policy if exists incidents_commander_update on public.incidents;
create policy incidents_commander_update
  on public.incidents for update
  using (
    public.current_user_role() = 'admin'
    or (
      public.can_command_incident(id)
      and is_closed = false
    )
  )
  with check (
    public.current_user_role() = 'admin'
    or (
      public.can_command_incident(id)
      and is_closed = false
    )
  );

drop policy if exists incident_memberships_member_select on public.incident_memberships;
create policy incident_memberships_member_select
  on public.incident_memberships for select
  using (
    user_id = public.current_actor_id()
    or public.can_command_incident(incident_id)
  );

drop policy if exists incident_memberships_admin_or_commander_mutate on public.incident_memberships;
create policy incident_memberships_admin_or_commander_mutate
  on public.incident_memberships for all
  using (public.can_command_incident(incident_id))
  with check (public.can_command_incident(incident_id));

-- Keep incident creation compatible with the new system role names.
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

  if v_actor_role not in ('admin', 'commander', 'editor') then
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

