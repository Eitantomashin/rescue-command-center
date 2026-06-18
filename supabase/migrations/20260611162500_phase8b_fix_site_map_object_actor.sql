-- Phase 8B runtime fix: replace site map object functions with the existing
-- project actor/permission pattern.
-- EventLogs continue to be appended only through public.create_event_log(...).

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
    public.current_actor_id()
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
