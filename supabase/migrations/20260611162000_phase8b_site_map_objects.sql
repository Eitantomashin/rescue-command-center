-- Phase 8B: Site map objects for sectors, entry points, and routes.
-- All writes go through approved functions and append EventLogs via public.create_event_log(...).

create table if not exists public.site_map_objects (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  object_type text not null check (object_type in ('sector', 'entry_point', 'route')),
  name text not null,
  assigned_team_number integer,
  color text,
  operational_status text,
  notes text,
  geometry jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_map_objects_geometry_object check (jsonb_typeof(geometry) = 'object')
);

create index if not exists site_map_objects_incident_site_idx
  on public.site_map_objects (incident_id, site_id, object_type)
  where is_active = true;

drop trigger if exists site_map_objects_set_updated_at on public.site_map_objects;
create trigger site_map_objects_set_updated_at
  before update on public.site_map_objects
  for each row execute function public.set_updated_at();

alter table public.site_map_objects enable row level security;

drop policy if exists site_map_objects_member_select on public.site_map_objects;
create policy site_map_objects_member_select
  on public.site_map_objects for select
  using (public.can_read_incident(incident_id));

drop policy if exists site_map_objects_operator_mutate on public.site_map_objects;
create policy site_map_objects_operator_mutate
  on public.site_map_objects for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create or replace function public.create_site_map_object(
  p_site_id uuid,
  p_object_type text,
  p_name text,
  p_geometry jsonb,
  p_assigned_team_number integer default null,
  p_color text default null,
  p_operational_status text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_id uuid;
  v_name text;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Site not found';
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'create_site_map_object');

  if p_object_type not in ('sector', 'entry_point', 'route') then
    raise exception 'Invalid map object type';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Map object name is required';
  end if;

  insert into public.site_map_objects (
    incident_id,
    site_id,
    object_type,
    name,
    assigned_team_number,
    color,
    operational_status,
    notes,
    geometry,
    created_by
  )
  values (
    v_site.incident_id,
    v_site.id,
    p_object_type,
    v_name,
    p_assigned_team_number,
    nullif(btrim(coalesce(p_color, '')), ''),
    nullif(btrim(coalesce(p_operational_status, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_geometry, '{}'::jsonb),
    public.current_app_user_id()
  )
  returning id into v_id;

  perform public.create_event_log(
    v_site.incident_id,
    'site_map_object_created',
    case
      when p_object_type = 'sector' then 'יצירת גזרה'
      when p_object_type = 'entry_point' then 'יצירת נקודת כניסה'
      else 'יצירת ציר'
    end,
    v_name,
    'operational',
    'normal',
    now(),
    v_site.id,
    null,
    null,
    null,
    null,
    'מערכת',
    null,
    jsonb_build_object(
      'map_object_id', v_id,
      'object_type', p_object_type,
      'site_id', v_site.id,
      'site_number', v_site.site_number,
      'name', v_name,
      'assigned_team_number', p_assigned_team_number,
      'color', p_color,
      'operational_status', p_operational_status,
      'geometry', p_geometry
    )
  );

  return v_id;
end;
$$;

create or replace function public.update_site_map_object(
  p_map_object_id uuid,
  p_name text,
  p_geometry jsonb,
  p_assigned_team_number integer default null,
  p_color text default null,
  p_operational_status text default null,
  p_notes text default null,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.site_map_objects%rowtype;
  v_name text;
begin
  select * into v_object from public.site_map_objects where id = p_map_object_id;
  if not found then
    raise exception 'Map object not found';
  end if;

  perform public.assert_incident_writable(v_object.incident_id, 'update_site_map_object');

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Map object name is required';
  end if;

  update public.site_map_objects
  set
    name = v_name,
    assigned_team_number = p_assigned_team_number,
    color = nullif(btrim(coalesce(p_color, '')), ''),
    operational_status = nullif(btrim(coalesce(p_operational_status, '')), ''),
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    geometry = coalesce(p_geometry, geometry),
    is_active = coalesce(p_is_active, true)
  where id = p_map_object_id;

  perform public.create_event_log(
    v_object.incident_id,
    'site_map_object_updated',
    case
      when v_object.object_type = 'sector' then 'עדכון גזרה'
      when v_object.object_type = 'entry_point' then 'עדכון נקודת כניסה'
      else 'עדכון ציר'
    end,
    v_name,
    'operational',
    'normal',
    now(),
    v_object.site_id,
    null,
    null,
    null,
    null,
    'מערכת',
    null,
    jsonb_build_object(
      'map_object_id', p_map_object_id,
      'object_type', v_object.object_type,
      'site_id', v_object.site_id,
      'old_name', v_object.name,
      'new_name', v_name,
      'assigned_team_number', p_assigned_team_number,
      'color', p_color,
      'operational_status', p_operational_status,
      'is_active', p_is_active,
      'geometry', p_geometry
    )
  );
end;
$$;
