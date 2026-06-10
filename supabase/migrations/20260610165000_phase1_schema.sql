-- Rescue Command Center (RCC)
-- Phase 1 foundation schema
-- PostgreSQL / Supabase compatible

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'observer'
    check (role in ('system_administrator', 'incident_commander', 'command_post_operator', 'observer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.status_types (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid,
  category text not null
    check (category in ('incident', 'site', 'floor', 'unit', 'resident', 'person', 'team', 'log')),
  status_key text not null,
  name text not null,
  hebrew_label text not null,
  color text,
  is_open boolean not null default true,
  is_dashboard_counted boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_types_status_key_format check (status_key ~ '^[a-z][a-z0-9_]*$')
);

create unique index status_types_global_key_idx
  on public.status_types (category, status_key)
  where incident_id is null;

create unique index status_types_incident_key_idx
  on public.status_types (incident_id, category, status_key)
  where incident_id is not null;

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  address text not null,
  opened_at timestamptz not null default now(),
  status_id uuid not null references public.status_types(id),
  ended_at timestamptz,
  is_closed boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_closed_has_ended_at check (
    (is_closed = false and ended_at is null)
    or
    (is_closed = true and ended_at is not null)
  )
);

alter table public.status_types
  add constraint status_types_incident_id_fkey
  foreign key (incident_id) references public.incidents(id);

create table public.incident_memberships (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  user_id uuid not null references public.profiles(id),
  role text not null
    check (role in ('incident_commander', 'command_post_operator', 'observer')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (incident_id, user_id)
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_number integer not null check (site_number > 0),
  name text,
  city text,
  street text not null,
  house_number text not null,
  floors_count integer not null check (floors_count >= 0),
  default_units_per_floor integer not null check (default_units_per_floor >= 0),
  default_people_per_unit integer not null default 5 check (default_people_per_unit >= 0),
  additional_potential integer not null default 0 check (additional_potential >= 0),
  additional_potential_reason text,
  initial_potential integer not null default 0 check (initial_potential >= 0),
  updated_potential integer not null default 0 check (updated_potential >= 0),
  status_id uuid not null references public.status_types(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, site_number),
  constraint sites_additional_potential_reason_required check (
    additional_potential = 0
    or nullif(btrim(additional_potential_reason), '') is not null
  )
);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid not null references public.sites(id),
  floor_number integer not null,
  units_count integer not null default 0 check (units_count >= 0),
  status_id uuid references public.status_types(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, floor_number)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid not null references public.sites(id),
  floor_id uuid not null references public.floors(id),
  unit_number text not null,
  family_name text,
  known_people_count integer check (known_people_count >= 0),
  status_id uuid references public.status_types(id),
  is_fully_cleared boolean not null default false,
  is_active boolean not null default true,
  inactive_reason text,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (floor_id, unit_number),
  constraint units_inactive_reason_required check (
    is_active = true
    or nullif(btrim(inactive_reason), '') is not null
  )
);

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid references public.sites(id),
  floor_id uuid references public.floors(id),
  unit_id uuid references public.units(id),
  operational_number integer not null check (operational_number > 0),
  first_name text,
  last_name text,
  age integer check (age >= 0),
  gender text,
  phone text,
  current_status_id uuid not null references public.status_types(id),
  source text,
  notes text,
  is_merged boolean not null default false,
  merged_into_person_id uuid references public.persons(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, operational_number),
  constraint persons_merge_target_required check (
    is_merged = false
    or merged_into_person_id is not null
  ),
  constraint persons_cannot_merge_into_self check (
    merged_into_person_id is null
    or merged_into_person_id <> id
  )
);

create table public.unit_residents (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  unit_id uuid not null references public.units(id),
  first_name text,
  last_name text,
  age integer check (age >= 0),
  phone text,
  status_id uuid references public.status_types(id),
  linked_person_id uuid references public.persons(id),
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  team_number integer not null check (team_number > 0),
  name text,
  commander_name text,
  personnel_count integer check (personnel_count >= 0),
  status_id uuid references public.status_types(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, team_number)
);

create table public.team_site_assignments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  team_id uuid not null references public.teams(id),
  site_id uuid not null references public.sites(id),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  assignment_status text not null default 'active'
    check (assignment_status in ('active', 'released', 'cancelled')),
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_site_assignments_release_required check (
    (assignment_status = 'active' and released_at is null)
    or
    (assignment_status in ('released', 'cancelled') and released_at is not null)
  )
);

create table public.person_status_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  incident_id uuid not null references public.incidents(id),
  previous_status_id uuid references public.status_types(id),
  new_status_id uuid not null references public.status_types(id),
  reported_at timestamptz not null default now(),
  source_type text,
  source_name text,
  team_id uuid references public.teams(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.person_merges (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  primary_person_id uuid not null references public.persons(id),
  merged_person_id uuid not null references public.persons(id),
  primary_operational_number integer not null,
  merged_operational_number integer not null,
  reason text not null,
  merged_by uuid references public.profiles(id),
  merged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint person_merges_distinct_people check (primary_person_id <> merged_person_id)
);

create table public.event_logs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid references public.sites(id),
  floor_id uuid references public.floors(id),
  unit_id uuid references public.units(id),
  person_id uuid references public.persons(id),
  team_id uuid references public.teams(id),
  log_type text not null,
  category text not null default 'operational'
    check (category in ('operational', 'administrative', 'status_change', 'assignment', 'clearance', 'merge', 'system', 'correction')),
  reported_at timestamptz not null default now(),
  source_type text,
  source_name text,
  title text not null,
  description text,
  importance text not null default 'normal'
    check (importance in ('normal', 'important', 'critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index sites_incident_id_idx on public.sites (incident_id);
create index floors_incident_id_idx on public.floors (incident_id);
create index floors_site_id_idx on public.floors (site_id);
create index units_incident_id_idx on public.units (incident_id);
create index units_site_id_idx on public.units (site_id);
create index units_floor_id_idx on public.units (floor_id);
create index persons_incident_id_idx on public.persons (incident_id);
create index persons_status_idx on public.persons (current_status_id);
create index persons_site_id_idx on public.persons (site_id);
create index persons_unit_id_idx on public.persons (unit_id);
create index teams_incident_id_idx on public.teams (incident_id);
create index team_site_assignments_team_id_idx on public.team_site_assignments (team_id);
create index team_site_assignments_site_id_idx on public.team_site_assignments (site_id);
create index team_site_assignments_status_idx on public.team_site_assignments (assignment_status);
create index event_logs_incident_id_idx on public.event_logs (incident_id);
create index event_logs_site_id_idx on public.event_logs (site_id);
create index event_logs_person_id_idx on public.event_logs (person_id);
create index event_logs_team_id_idx on public.event_logs (team_id);
create index event_logs_reported_at_idx on public.event_logs (reported_at desc);
create index status_types_lookup_idx on public.status_types (category, status_key, incident_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger status_types_set_updated_at
  before update on public.status_types
  for each row execute function public.set_updated_at();

create trigger incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create trigger floors_set_updated_at
  before update on public.floors
  for each row execute function public.set_updated_at();

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

create trigger unit_residents_set_updated_at
  before update on public.unit_residents
  for each row execute function public.set_updated_at();

create trigger persons_set_updated_at
  before update on public.persons
  for each row execute function public.set_updated_at();

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create trigger team_site_assignments_set_updated_at
  before update on public.team_site_assignments
  for each row execute function public.set_updated_at();

create or replace function public.prevent_update_or_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Records in % are immutable', tg_table_name;
end;
$$;

create or replace function public.prevent_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Records in % must be deactivated, cancelled, merged, or archived instead of deleted', tg_table_name;
end;
$$;

create trigger status_types_prevent_delete
  before delete on public.status_types
  for each row execute function public.prevent_delete();

create trigger incidents_prevent_delete
  before delete on public.incidents
  for each row execute function public.prevent_delete();

create trigger sites_prevent_delete
  before delete on public.sites
  for each row execute function public.prevent_delete();

create trigger floors_prevent_delete
  before delete on public.floors
  for each row execute function public.prevent_delete();

create trigger units_prevent_delete
  before delete on public.units
  for each row execute function public.prevent_delete();

create trigger unit_residents_prevent_delete
  before delete on public.unit_residents
  for each row execute function public.prevent_delete();

create trigger persons_prevent_delete
  before delete on public.persons
  for each row execute function public.prevent_delete();

create trigger teams_prevent_delete
  before delete on public.teams
  for each row execute function public.prevent_delete();

create trigger team_site_assignments_prevent_delete
  before delete on public.team_site_assignments
  for each row execute function public.prevent_delete();

create trigger event_logs_immutable
  before update or delete on public.event_logs
  for each row execute function public.prevent_update_or_delete();

create trigger person_status_history_immutable
  before update or delete on public.person_status_history
  for each row execute function public.prevent_update_or_delete();

create trigger person_merges_immutable
  before update or delete on public.person_merges
  for each row execute function public.prevent_update_or_delete();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_incident_role(p_incident_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'system_administrator'
    )
    then 'system_administrator'
    else (
      select im.role
      from public.incident_memberships im
      where im.incident_id = p_incident_id
        and im.user_id = auth.uid()
      limit 1
    )
  end
$$;

create or replace function public.can_read_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_incident_role(p_incident_id) is not null
$$;

create or replace function public.can_write_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when public.current_user_incident_role(p_incident_id) = 'system_administrator' then true
      when i.is_closed = true then false
      else public.current_user_incident_role(p_incident_id)
        in ('incident_commander', 'command_post_operator')
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
  select public.current_user_incident_role(p_incident_id)
    in ('system_administrator', 'incident_commander')
$$;

create or replace function public.can_correct_closed_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select i.is_closed = true
    and public.current_user_incident_role(p_incident_id)
      in ('system_administrator', 'incident_commander')
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
  v_role text;
begin
  select is_closed into v_is_closed
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  v_role := public.current_user_incident_role(p_incident_id);

  if v_role is null then
    raise exception 'User is not allowed to access this incident';
  end if;

  if v_is_closed
    and v_role <> 'system_administrator'
    and not (v_role = 'incident_commander' and p_is_authorized_correction)
  then
    raise exception 'Incident is closed and read-only for action %', coalesce(p_action, 'unknown');
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
  if not public.can_write_incident(p_incident_id) then
    raise exception 'User is not allowed to write event logs for this incident';
  end if;

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

  return v_id;
end;
$$;

create or replace function public.create_authorized_correction_event_log(
  p_incident_id uuid,
  p_title text,
  p_reason text,
  p_description text default null,
  p_site_id uuid default null,
  p_floor_id uuid default null,
  p_unit_id uuid default null,
  p_person_id uuid default null,
  p_team_id uuid default null,
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
  if not public.can_correct_closed_incident(p_incident_id)
    and public.current_user_incident_role(p_incident_id) <> 'system_administrator'
  then
    raise exception 'User is not allowed to create authorized corrections for this incident';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'Correction reason is required';
  end if;

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
    'authorized_correction',
    'correction',
    now(),
    p_title,
    p_description,
    'important',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('correction_reason', p_reason),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.close_incident(
  p_incident_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed_status_id uuid;
begin
  if not public.can_command_incident(p_incident_id) then
    raise exception 'User is not allowed to close this incident';
  end if;

  perform public.assert_incident_writable(p_incident_id, 'close_incident');

  v_closed_status_id := public.get_status_id('incident', 'closed', p_incident_id);

  perform public.create_event_log(
    p_incident_id,
    'incident_closed',
    'Incident Closed',
    p_reason,
    'administrative',
    'important'
  );

  update public.incidents
  set
    is_closed = true,
    ended_at = now(),
    status_id = coalesce(v_closed_status_id, status_id),
    updated_by = auth.uid()
  where id = p_incident_id;
end;
$$;

create or replace function public.next_operational_number(p_incident_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(operational_number), 0) + 1
  from public.persons
  where incident_id = p_incident_id
$$;

create or replace function public.get_status_id(
  p_category text,
  p_status_key text,
  p_incident_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select st.id
  from public.status_types st
  where st.category = p_category
    and st.status_key = p_status_key
    and st.is_active = true
    and (st.incident_id = p_incident_id or st.incident_id is null)
  order by st.incident_id nulls last
  limit 1
$$;

create or replace function public.has_open_persons_in_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.persons p
    join public.status_types st on st.id = p.current_status_id
    where p.unit_id = p_unit_id
      and p.is_merged = false
      and st.is_open = true
  )
$$;

create or replace function public.set_unit_clearance(
  p_unit_id uuid,
  p_is_fully_cleared boolean,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_status_id uuid;
  v_has_open_persons boolean;
  v_role text;
begin
  select * into v_unit
  from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'set_unit_clearance');

  v_has_open_persons := public.has_open_persons_in_unit(p_unit_id);
  v_role := public.current_user_incident_role(v_unit.incident_id);

  if p_is_fully_cleared
    and v_has_open_persons
    and v_role <> 'system_administrator'
    and not (
      v_role = 'incident_commander'
      and nullif(btrim(p_override_reason), '') is not null
    )
  then
    raise exception 'Unit cannot be cleared while open persons are linked without commander override reason';
  end if;

  if p_is_fully_cleared then
    v_status_id := public.get_status_id('unit', 'fully_cleared', v_unit.incident_id);
  else
    v_status_id := public.get_status_id('unit', 'active_investigation', v_unit.incident_id);
  end if;

  update public.units
  set
    is_fully_cleared = p_is_fully_cleared,
    status_id = coalesce(v_status_id, status_id),
    updated_by = auth.uid()
  where id = p_unit_id;

  perform public.create_event_log(
    v_unit.incident_id,
    case when p_is_fully_cleared then 'unit_cleared' else 'unit_clearance_removed' end,
    case when p_is_fully_cleared then 'Unit Cleared' else 'Unit Clearance Removed' end,
    case
      when p_is_fully_cleared and v_has_open_persons
      then 'Commander override: ' || p_override_reason
      else null
    end,
    'clearance',
    case when p_is_fully_cleared and v_has_open_persons then 'important' else 'normal' end,
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_is_fully_cleared', v_unit.is_fully_cleared,
      'new_is_fully_cleared', p_is_fully_cleared,
      'open_persons_override', p_is_fully_cleared and v_has_open_persons,
      'override_reason', p_override_reason
    )
  );
end;
$$;

create or replace function public.set_floor_unit_count(
  p_floor_id uuid,
  p_units_count integer,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor public.floors%rowtype;
  v_current_count integer;
  v_unit_status_id uuid;
begin
  if p_units_count < 0 then
    raise exception 'Unit count cannot be negative';
  end if;

  select * into v_floor
  from public.floors
  where id = p_floor_id;

  if not found then
    raise exception 'Floor % does not exist', p_floor_id;
  end if;

  perform public.assert_incident_writable(v_floor.incident_id, 'set_floor_unit_count');

  select count(*)::integer into v_current_count
  from public.units
  where floor_id = p_floor_id
    and is_active = true;

  v_unit_status_id := public.get_status_id('unit', 'inactive', v_floor.incident_id);

  if p_units_count < v_current_count then
    with ranked_units as (
      select
        id,
        row_number() over (order by unit_number desc, created_at desc) as rn
      from public.units
      where floor_id = p_floor_id
        and is_active = true
    )
    update public.units u
    set
      is_active = false,
      inactive_reason = coalesce(nullif(btrim(p_reason), ''), 'Floor unit count reduced'),
      status_id = coalesce(v_unit_status_id, u.status_id),
      updated_by = auth.uid()
    from ranked_units ru
    where u.id = ru.id
      and ru.rn <= (v_current_count - p_units_count);
  end if;

  update public.floors
  set
    units_count = p_units_count,
    updated_by = auth.uid()
  where id = p_floor_id;

  perform public.create_event_log(
    v_floor.incident_id,
    'floor_unit_count_changed',
    'Floor Unit Count Changed',
    p_reason,
    'operational',
    'normal',
    now(),
    v_floor.site_id,
    v_floor.id,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_units_count', v_current_count,
      'new_units_count', p_units_count,
      'inactive_units_created_by_reduction', greatest(v_current_count - p_units_count, 0)
    )
  );
end;
$$;

create or replace function public.update_person_status(
  p_person_id uuid,
  p_new_status_id uuid,
  p_reported_at timestamptz default now(),
  p_source_type text default null,
  p_source_name text default null,
  p_team_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
begin
  select * into v_person
  from public.persons
  where id = p_person_id;

  if not found then
    raise exception 'Person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'update_person_status');

  select * into v_previous_status
  from public.status_types
  where id = v_person.current_status_id;

  select * into v_new_status
  from public.status_types
  where id = p_new_status_id
    and category = 'person'
    and (incident_id = v_person.incident_id or incident_id is null);

  if not found then
    raise exception 'New status % is not valid for this person incident', p_new_status_id;
  end if;

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    team_id,
    notes,
    created_by
  )
  values (
    p_person_id,
    v_person.incident_id,
    v_person.current_status_id,
    p_new_status_id,
    coalesce(p_reported_at, now()),
    p_source_type,
    p_source_name,
    p_team_id,
    p_notes,
    auth.uid()
  );

  update public.persons
  set
    current_status_id = p_new_status_id,
    updated_by = auth.uid()
  where id = p_person_id;

  perform public.create_event_log(
    v_person.incident_id,
    'person_status_changed',
    'Person Status Changed',
    p_notes,
    'status_change',
    'normal',
    coalesce(p_reported_at, now()),
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    p_team_id,
    p_source_type,
    p_source_name,
    jsonb_build_object(
      'operational_number', v_person.operational_number,
      'previous_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key,
      'previous_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label
    )
  );
end;
$$;

comment on function public.next_operational_number(uuid)
  is 'Suggests the next operational number. Authorized users may still manually override, subject to unique incident constraint.';

comment on function public.create_event_log(uuid, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
  is 'Shared event log entry point. Application workflows should call service/database functions that use this function instead of writing logs from UI code.';

comment on function public.create_authorized_correction_event_log(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb)
  is 'Creates a mandatory-reason correction EventLog entry for closed incident correction workflows.';

comment on function public.close_incident(uuid, text)
  is 'Closes an incident and writes the required EventLog entry.';

comment on function public.set_unit_clearance(uuid, boolean, text)
  is 'Applies unit clearance rules. Open linked persons block clearance unless an incident commander provides an override reason, which is logged.';

comment on function public.set_floor_unit_count(uuid, integer, text)
  is 'Updates floor unit count. When reducing count, extra units are marked inactive and never deleted.';

comment on function public.update_person_status(uuid, uuid, timestamptz, text, text, uuid, text)
  is 'Shared status transition function. Creates person status history and event log records in one transaction.';
