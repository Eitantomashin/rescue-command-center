-- Phase 8B: approved soft-delete for site map objects.
-- EventLogs are immutable and are appended only through public.create_event_log(...).

create or replace function public.delete_site_map_object(
  p_map_object_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.site_map_objects%rowtype;
begin
  select * into v_object
  from public.site_map_objects
  where id = p_map_object_id;

  if not found then
    raise exception 'Map object not found';
  end if;

  perform public.assert_incident_writable(v_object.incident_id, 'delete_site_map_object');

  update public.site_map_objects
  set is_active = false
  where id = p_map_object_id;

  perform public.create_event_log(
    v_object.incident_id,
    'site_map_object_deleted',
    case
      when v_object.object_type = 'sector' then 'מחיקת גזרה'
      when v_object.object_type = 'entry_point' then 'מחיקת נקודת כניסה'
      else 'מחיקת ציר'
    end,
    v_object.name,
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
      'map_object_id', v_object.id,
      'object_type', v_object.object_type,
      'site_id', v_object.site_id,
      'name', v_object.name,
      'assigned_team_number', v_object.assigned_team_number,
      'color', v_object.color,
      'operational_status', v_object.operational_status,
      'geometry', v_object.geometry
    )
  );
end;
$$;
