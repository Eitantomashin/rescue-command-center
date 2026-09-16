-- Stage 6. Existing equipment clocks/catalog are not reset by release.
begin;

-- Private primitive. Caller holds incident, then request (if any), then all
-- assignment/cycle locks needed by the operation. It never locks an incident.
create function public.release_equipment_internal(
  p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_reason text,
  p_origin text,p_request_id uuid,p_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_a public.incident_equipment_assignments; v_c public.equipment_cycles;
  v_before jsonb; v_cycle_before jsonb; v_setting text; v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_origin is null or p_origin not in ('manual','incident_closure')
    or nullif(btrim(p_reason),'') is null then raise exception 'נדרשים מבצע וסיבת שחרור תקינים' using errcode='22023'; end if;
  select * into v_a from public.incident_equipment_assignments where id=p_assignment_id and incident_id=p_incident_id for update;
  if not found then raise exception 'הקצאת הציוד לא נמצאה באירוע' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_a.version then
    raise exception 'ההקצאה השתנתה. יש לרענן ולנסות שוב' using errcode='40001'; end if;
  if v_a.released_at is not null then raise exception 'הציוד כבר שוחרר מהאירוע' using errcode='55000'; end if;
  select * into v_c from public.equipment_cycles where assignment_id=v_a.id and ended_at is null for update;
  if not found then raise exception 'לא נמצא מחזור פתוח להקצאה' using errcode='55000'; end if;
  if v_c.operation_state not in ('off','paused') then
    raise exception 'לא ניתן לשחרר ציוד פועל. נדרשת עצירה מפורשת' using errcode='55000'; end if;
  v_before:=to_jsonb(v_a); v_cycle_before:=to_jsonb(v_c);
  update public.equipment_cycles set ended_at=p_at,ended_by=v_actor,end_reason='released',running_since=null,
    updated_at=p_at,updated_by=v_actor where id=v_c.id returning * into v_c;
  perform public.resolve_equipment_cycle_alert(v_c.id,p_at,'released',v_actor);
  update public.incident_equipment_assignments set released_at=p_at,released_by=v_actor,release_reason=btrim(p_reason),
    version=version+1,updated_at=p_at,updated_by=v_actor where id=v_a.id returning * into v_a;
  v_setting:=current_setting('rcc.allow_event_log_insert',true);
  perform set_config('rcc.allow_event_log_insert','on',true);
  insert into public.event_logs(incident_id,team_id,log_type,category,reported_at,created_at,title,description,
    importance,created_by,entity_type,entity_id,before_state,after_state,metadata)
  values(p_incident_id,v_a.team_id,'equipment_released','assignment',p_at,p_at,'ציוד שוחרר מהאירוע',
    v_a.equipment_type_name_snapshot || ' — ' || v_a.asset_identifier_snapshot,'normal',v_actor,
    'equipment_assignment',v_a.id,v_before,to_jsonb(v_a),
    jsonb_build_object('request_id',p_request_id,'equipment_item_id',v_a.equipment_item_id,'assignment_id',v_a.id,
      'cycle_id',v_c.id,'cycle_number',v_c.cycle_number,'operation_state',v_c.operation_state,
      'accumulated_active_seconds',v_c.accumulated_active_seconds,'cycle_before',v_cycle_before,'cycle_after',to_jsonb(v_c),
      'release_reason',v_a.release_reason,'release_origin',p_origin,'automatic_release',p_origin='incident_closure',
      'team_id',v_a.team_id,'ad_hoc_team_id',v_a.ad_hoc_team_id,'location',v_a.location));
  perform set_config('rcc.allow_event_log_insert',coalesce(v_setting,''),true);
  return jsonb_build_object('assignment_id',v_a.id,'cycle_id',v_c.id,'version',v_a.version);
end;
$$;

create or replace function public.release_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,
  p_request_id uuid,p_release_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid; v_payload jsonb; v_request public.equipment_operation_requests; v_result jsonb;
begin
  if p_request_id is null then raise exception 'נדרש מזהה בקשה' using errcode='22023'; end if;
  v_actor:=public.assert_equipment_incident_operation(p_incident_id,false);
  -- EXACT stage-3 release payload, including null fields and untrimmed reason:
  -- requests committed before this migration continue to replay unchanged.
  v_payload:=jsonb_build_object('incident_id',p_incident_id,'assignment_id',p_assignment_id,
    'equipment_item_id',null,'team_id',null,'ad_hoc_team_id',null,'location',null,'notes',null,
    'release_reason',p_release_reason,'expected_version',p_expected_version);
  insert into public.equipment_operation_requests(actor_id,request_id,incident_id,action_type,payload)
    values(v_actor,p_request_id,p_incident_id,'release',v_payload) on conflict(actor_id,request_id) do nothing;
  select * into v_request from public.equipment_operation_requests where actor_id=v_actor and request_id=p_request_id for update;
  if v_request.action_type is distinct from 'release' or v_request.payload is distinct from v_payload then
    raise exception 'מזהה הבקשה כבר שימש לתוכן אחר' using errcode='22023'; end if;
  if v_request.result is not null then return v_request.result; end if;
  v_result:=public.release_equipment_internal(p_incident_id,p_assignment_id,p_expected_version,p_release_reason,'manual',p_request_id,clock_timestamp());
  update public.equipment_operation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
  return v_result;
end;
$$;

-- Caller has locked the incident. Lock ALL assignments, then ALL open cycles in
-- assignment-id order before checking or changing ANY equipment.
create function public.release_incident_equipment_for_closure(p_incident_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_blockers jsonb; v_a record; v_now timestamptz;
begin
  perform 1 from public.incident_equipment_assignments where incident_id=p_incident_id and released_at is null order by id for update;
  perform 1 from public.equipment_cycles c join public.incident_equipment_assignments a on a.id=c.assignment_id
    where a.incident_id=p_incident_id and a.released_at is null and c.ended_at is null order by a.id,c.id for update of c;
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'equipment_item_id',a.equipment_item_id,
    'asset_identifier',a.asset_identifier_snapshot,'equipment_type_name',a.equipment_type_name_snapshot,
    'team_id',a.team_id,'ad_hoc_team_id',a.ad_hoc_team_id,
    'team_name',case when a.team_id is not null then coalesce(t.name,'צוות ' || t.team_number::text) else h.name end,
    'location',a.location) order by a.id),'[]'::jsonb) into v_blockers
  from public.incident_equipment_assignments a join public.equipment_cycles c on c.assignment_id=a.id and c.ended_at is null
  left join public.teams t on t.id=a.team_id left join public.incident_ad_hoc_teams h on h.id=a.ad_hoc_team_id
  where a.incident_id=p_incident_id and a.released_at is null and c.operation_state='running';
  if jsonb_array_length(v_blockers)>0 then
    raise exception 'לא ניתן לסגור את האירוע כל עוד ציוד פועל. יש להשהות את כל הפריטים המפורטים ולנסות שוב.'
      using errcode='55000',detail=jsonb_build_object('code','equipment_running','blocking_equipment',v_blockers)::text;
  end if;
  v_now:=clock_timestamp();
  for v_a in select id,version from public.incident_equipment_assignments
    where incident_id=p_incident_id and released_at is null order by id loop
    perform public.release_equipment_internal(p_incident_id,v_a.id,v_a.version,'שחרור אוטומטי בעקבות סגירת האירוע',
      'incident_closure',null,v_now);
  end loop;
end;
$$;

-- Direct table writes and old alternative closing paths must not leave open
-- equipment in a closed/archived event. The UPDATE already owns its event row
-- lock; this trigger takes NO assignment locks (no reverse lock ordering).
create function public.guard_incident_equipment_lifecycle()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (
    ((new.is_closed or new.lifecycle_status='closed' or new.archived_at is not null)
      and (new.is_closed is distinct from old.is_closed or new.lifecycle_status is distinct from old.lifecycle_status
        or new.archived_at is distinct from old.archived_at))
    or (new.status_id is distinct from old.status_id and exists(
      select 1 from public.status_types where id=new.status_id and category='incident' and status_key='closed'))
  )
    and exists(select 1 from public.incident_equipment_assignments where incident_id=new.id and released_at is null) then
    raise exception 'יש לשחרר את כל הציוד באמצעות תהליך סגירת האירוע לפני סגירה או ארכוב' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger incident_equipment_lifecycle_guard before update of is_closed,lifecycle_status,archived_at,status_id on public.incidents
  for each row execute function public.guard_incident_equipment_lifecycle();

-- The concrete existing lifecycle/archive/purge implementations follow below.

create or replace function public.close_incident_lifecycle(p_incident_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_incident public.incidents;
  v_closed_status_id uuid;
  v_site_closed_status_id uuid;
  v_report_id uuid;
begin
  perform public.assert_equipment_incident_editor(p_incident_id);
  perform public.assert_control_incident_lifecycle(p_incident_id);
  select * into v_incident from public.incidents where id=p_incident_id for update;
  perform public.assert_equipment_incident_editor(p_incident_id);
  perform public.assert_control_incident_lifecycle(p_incident_id);
  if v_incident.archived_at is not null then raise exception 'האירוע מאורכב' using errcode='55000'; end if;
  if v_incident.is_closed or v_incident.lifecycle_status='closed' then
    if exists(select 1 from public.incident_equipment_assignments where incident_id=p_incident_id and released_at is null) then
      raise exception 'אירוע סגור מכיל הקצאות פתוחות ונדרש בירור לפני פעולה נוספת' using errcode='55000';
    end if;
    select id into v_report_id from public.closure_reports where incident_id=p_incident_id order by report_number desc limit 1;
    if found then return v_report_id; end if;
    -- Legacy close_incident did not create a report. Preserve the original
    -- lifecycle flow below for that case, under its existing permissions.
  end if;
  perform public.release_incident_equipment_for_closure(p_incident_id);

  v_closed_status_id := public.get_status_id('incident', 'closed', p_incident_id);
  v_site_closed_status_id := public.get_status_id('site', 'closed', p_incident_id);

  update public.incidents
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_incident_id
    and archived_at is null;

  if not found then
    raise exception 'Incident does not exist or is archived';
  end if;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_site_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where incident_id = p_incident_id
    and lifecycle_status <> 'closed';

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    p_incident_id,
    'incident_closed',
    'סגירת פעילות באירוע',
    'פעילות האירוע נסגרה וכל האתרים הפעילים נסגרו',
    'administrative',
    'important',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('incident_id', p_incident_id, 'closed_by', v_actor_id)
  );

  v_report_id := public.create_closure_report_snapshot(p_incident_id);

  update public.incidents
  set is_closed = true,
      ended_at = coalesce(ended_at, closed_at, now()),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_incident_id;

  return v_report_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

-- Legacy closure RPC retains its void return and existing permission checks.
create or replace function public.close_incident(
  p_incident_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_closed_status_id uuid;
begin
  perform public.assert_equipment_incident_operation(p_incident_id,false);
  if not public.can_command_incident(p_incident_id) then
    raise exception 'User is not allowed to close this incident';
  end if;

  perform public.assert_incident_writable(p_incident_id, 'close_incident');

  perform public.release_incident_equipment_for_closure(p_incident_id);

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

-- Archive previously allowed active events. Retain that contract only when
-- no assignments are open; never implicitly stop or release equipment here.
create or replace function public.archive_incident(
  p_incident_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
begin
  perform public.assert_admin();
  if auth.uid() is null or public.can_read_equipment_incident(p_incident_id) is not true then
    raise exception 'אין הרשאה לארכוב האירוע' using errcode='42501';
  end if;

  select id, name, archived_at
  into v_incident
  from public.incidents
  where id = p_incident_id for update;

  if not found then
    raise exception 'Incident does not exist';
  end if;

  perform public.assert_admin();
  if public.can_read_equipment_incident(p_incident_id) is not true then raise exception 'אין הרשאה לארכוב האירוע' using errcode='42501'; end if;
  if exists(select 1 from public.incident_equipment_assignments where incident_id=p_incident_id and released_at is null) then
    raise exception 'יש לסגור את האירוע או לשחרר את כל הציוד לפני ארכוב' using errcode='55000';
  end if;
  if v_incident.archived_at is not null then
    return;
  end if;

  if coalesce(p_confirmation_name, '') <> v_incident.name then
    raise exception 'Incident name confirmation does not match';
  end if;

  update public.incidents
  set archived_at = now(),
      archived_by = public.current_actor_id(),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_incident_id;
end;
$$;

create or replace function public.permanently_delete_archived_incident(
  p_incident_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
  v_global_incident_status_id uuid;
begin
  -- assert_admin's legacy <> comparison permits NULL roles. Fail closed here
  -- without changing global permission helpers or widening purge permissions.
  if auth.uid() is null or not exists(select 1 from public.profiles
    where id=auth.uid() and role='admin' and is_active and deleted_at is null) then
    raise exception 'אין הרשאה למחיקה קבועה של אירוע' using errcode='42501';
  end if;
  perform public.assert_admin();

  select id, name, archived_at into v_incident
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident does not exist';
  end if;

  if v_incident.archived_at is null then
    raise exception 'Only archived incidents can be permanently deleted';
  end if;

  if coalesce(p_confirmation_name, '') <> v_incident.name then
    raise exception 'Incident name confirmation does not match';
  end if;

  v_global_incident_status_id := public.get_status_id('incident', 'active', null);
  if v_global_incident_status_id is null then
    select id into v_global_incident_status_id
    from public.status_types
    where incident_id is null and category = 'incident'
    order by sort_order nulls last, created_at
    limit 1;
  end if;

  if v_global_incident_status_id is not null then
    update public.incidents
    set status_id = v_global_incident_status_id
    where id = p_incident_id;
  end if;

  alter table public.status_types disable trigger user;
  alter table public.incidents disable trigger user;
  alter table public.sites disable trigger user;
  alter table public.floors disable trigger user;
  alter table public.units disable trigger user;
  alter table public.persons disable trigger user;
  alter table public.unit_residents disable trigger user;
  alter table public.teams disable trigger user;
  alter table public.team_site_assignments disable trigger user;
  alter table public.person_status_history disable trigger user;
  alter table public.person_merges disable trigger user;
  alter table public.event_logs disable trigger user;

  perform set_config('rcc.allow_incident_purge_operational_reports', 'true', true);
  delete from public.operational_reports where incident_id = p_incident_id;
  perform set_config('rcc.allow_incident_purge_operational_reports', 'false', true);

  delete from public.person_status_history where incident_id = p_incident_id;
  delete from public.person_merges where incident_id = p_incident_id;
  delete from public.event_personnel_status where incident_id = p_incident_id;
  delete from public.site_map_objects where incident_id = p_incident_id;
  delete from public.situation_reports where incident_id = p_incident_id;
  delete from public.closure_reports where incident_id = p_incident_id;
  delete from public.event_logs where incident_id = p_incident_id;
  delete from public.team_site_assignments where incident_id = p_incident_id;
  delete from public.imported_site_residents where incident_id = p_incident_id;
  delete from public.unit_residents where incident_id = p_incident_id;
  delete from public.persons where incident_id = p_incident_id;
  delete from public.site_search_units where incident_id = p_incident_id;
  delete from public.unit_structure_history where incident_id = p_incident_id;
  delete from public.units where incident_id = p_incident_id;
  delete from public.floors where incident_id = p_incident_id;
  delete from public.sites where incident_id = p_incident_id;
  delete from public.teams where incident_id = p_incident_id;
  delete from public.incident_memberships where incident_id = p_incident_id;
  delete from public.status_types where incident_id = p_incident_id;
  delete from public.incidents where id = p_incident_id;

  alter table public.status_types enable trigger user;
  alter table public.incidents enable trigger user;
  alter table public.sites enable trigger user;
  alter table public.floors enable trigger user;
  alter table public.units enable trigger user;
  alter table public.persons enable trigger user;
  alter table public.unit_residents enable trigger user;
  alter table public.teams enable trigger user;
  alter table public.team_site_assignments enable trigger user;
  alter table public.person_status_history enable trigger user;
  alter table public.person_merges enable trigger user;
  alter table public.event_logs enable trigger user;
end;
$$;

-- Purge deletion order remains unchanged: incident DELETE cascades to assignments and
-- requests, assignments to cycles, cycles to alerts, alerts to deliveries.
-- Its existing explicit event_logs DELETE retains the incident audit policy.
-- Team/incident assignment FKs are initially deferred, so its team-first order
-- remains valid. Catalog FKs point OUT of assignments, not into incident data.
revoke all on function public.release_equipment_internal(uuid,uuid,bigint,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.release_incident_equipment_for_closure(uuid) from public,anon,authenticated,service_role;
revoke all on function public.guard_incident_equipment_lifecycle() from public,anon,authenticated,service_role;
revoke all on function public.release_equipment(uuid,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.close_incident_lifecycle(uuid) from public,anon,authenticated,service_role;
revoke all on function public.close_incident(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.archive_incident(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.release_equipment(uuid,uuid,bigint,uuid,text) to authenticated;
grant execute on function public.close_incident_lifecycle(uuid) to authenticated;
grant execute on function public.close_incident(uuid,text) to authenticated;
grant execute on function public.archive_incident(uuid,text) to authenticated;
revoke all on function public.permanently_delete_archived_incident(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.permanently_delete_archived_incident(uuid,text) to authenticated;
commit;
