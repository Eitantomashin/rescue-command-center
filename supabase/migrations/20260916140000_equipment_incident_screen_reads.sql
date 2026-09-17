-- Stage 7: narrowly scoped reads. Catalog SELECT/RLS and all writes are unchanged.
begin;

create function public.get_available_equipment_for_incident(p_incident_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  perform public.assert_equipment_incident_editor(p_incident_id);
  if not exists (select 1 from public.incidents where id=p_incident_id
    and lifecycle_status='active' and not is_closed and archived_at is null) then
    raise exception 'הקצאת ציוד חדש מותרת רק באירוע פעיל' using errcode='55000';
  end if;
  -- Advisory availability only. assign_equipment rechecks under its existing locks.
  select coalesce(jsonb_agg(jsonb_build_object(
    'equipment_item_id',i.id,'asset_identifier',i.asset_identifier,'serial_number',i.serial_number,
    'equipment_type_id',t.id,'equipment_type_name',t.name,
    'full_runtime_seconds',t.full_runtime_seconds,'warning_before_seconds',t.warning_before_seconds
  ) order by t.name,i.asset_identifier,i.id),'[]'::jsonb) into v_result
  from public.equipment_items i join public.equipment_types t on t.id=i.equipment_type_id
  where i.is_active and t.is_active and i.serviceability='serviceable'
    and not exists (select 1 from public.incident_equipment_assignments a
      where a.equipment_item_id=i.id and a.released_at is null);
  return v_result;
end;
$$;
create or replace function public.get_incident_equipment_state(p_incident_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  if public.can_read_equipment_incident(p_incident_id) is not true then
    raise exception 'אין הרשאה לצפות בציוד באירוע זה' using errcode='42501';
  end if;
  -- One timestamp within the same SQL statement/snapshot as the row read.
  -- A start committed after that snapshot cannot produce a future running_since.
  with server_clock as materialized (select clock_timestamp() as server_now)
  select jsonb_build_object('server_now',sc.server_now,'equipment',(
    select coalesce(jsonb_agg(
    public.equipment_clock_snapshot(a,c,sc.server_now) || jsonb_build_object(
      'team_name',case when a.team_id is not null then coalesce(t.name,'צוות ' || t.team_number::text) else h.name end,
      'team_number',t.team_number,'team_kind',case when a.team_id is not null then 'regular' else 'ad_hoc' end,
      'serial_number',i.serial_number,'equipment_item_is_active',i.is_active,'equipment_type_is_active',et.is_active,'serviceability',i.serviceability
    ) order by a.allocated_at,a.id
  ),'[]'::jsonb)
  from public.incident_equipment_assignments a
  join public.equipment_cycles c on c.assignment_id=a.id and c.incident_id=a.incident_id and c.ended_at is null
  join public.equipment_items i on i.id=a.equipment_item_id
  join public.equipment_types et on et.id=i.equipment_type_id
  left join public.teams t on t.id=a.team_id and t.incident_id=a.incident_id
  left join public.incident_ad_hoc_teams h on h.id=a.ad_hoc_team_id and h.incident_id=a.incident_id
  where a.incident_id=p_incident_id and a.released_at is null
  )) into v_result from server_clock sc;
  return v_result;
end;
$$;
revoke all on function public.get_available_equipment_for_incident(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_incident_equipment_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_available_equipment_for_incident(uuid) to authenticated;
grant execute on function public.get_incident_equipment_state(uuid) to authenticated;
commit;
