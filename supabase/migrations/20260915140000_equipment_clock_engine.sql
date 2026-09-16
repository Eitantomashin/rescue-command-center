-- Stage 4: server-time clock transitions and atomic refuel. No UI or scheduler.
begin;

alter table public.equipment_operation_requests
  drop constraint equipment_operation_requests_action_type_check,
  add constraint equipment_operation_requests_action_type_check
    check (action_type in ('assign','update','transfer','release','start','pause','resume','refuel'));

-- Refuel provenance belongs to the cycle that was ended by that refuel.
alter table public.equipment_cycles
  add column refueled_at timestamptz,
  add column refueled_by uuid references public.profiles(id),
  add constraint equipment_cycle_refuel_provenance check (
    (refueled_at is null and refueled_by is null and end_reason is distinct from 'refueled')
    or (refueled_at is not null and refueled_by is not null
      and end_reason is not null and end_reason='refueled'
      and ended_at is not null and ended_at=refueled_at
      and ended_by is not null and ended_by=refueled_by
      and first_started_at is not null and operation_state='paused')
  );

-- Pure internal calculation, shared by action results, audit and state reads.
-- remaining_seconds is deliberately NOT clamped at zero.
create function public.equipment_clock_snapshot(
  p_assignment public.incident_equipment_assignments,
  p_cycle public.equipment_cycles,
  p_server_now timestamptz
)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'assignment_id',p_assignment.id,'incident_id',p_assignment.incident_id,
    'cycle_id',p_cycle.id,'cycle_number',p_cycle.cycle_number,
    'operation_state',p_cycle.operation_state,
    'accumulated_active_seconds',p_cycle.accumulated_active_seconds,
    'running_since',p_cycle.running_since,'first_started_at',p_cycle.first_started_at,
    'full_runtime_seconds_snapshot',p_assignment.full_runtime_seconds_snapshot,
    'warning_before_seconds_snapshot',p_assignment.warning_before_seconds_snapshot,
    'elapsed_seconds',timing.elapsed,'remaining_seconds',timing.remaining,
    'calculated_time_state',case when timing.remaining<=0 then 'overdue'
      when timing.remaining<=p_assignment.warning_before_seconds_snapshot then 'warning' else 'normal' end,
    'server_now',p_server_now,'version',p_assignment.version,
    'equipment_item_id',p_assignment.equipment_item_id,
    'equipment_type_id_snapshot',p_assignment.equipment_type_id_snapshot,
    'equipment_type_name_snapshot',p_assignment.equipment_type_name_snapshot,
    'category_snapshot',p_assignment.category_snapshot,'instructions_snapshot',p_assignment.instructions_snapshot,
    'asset_identifier_snapshot',p_assignment.asset_identifier_snapshot,
    'team_id',p_assignment.team_id,'ad_hoc_team_id',p_assignment.ad_hoc_team_id,
    'location',p_assignment.location,'notes',p_assignment.notes,
    'ended_at',p_cycle.ended_at,'end_reason',p_cycle.end_reason,
    'refueled_at',p_cycle.refueled_at,'refueled_by',p_cycle.refueled_by
  )
  from (
    select elapsed,p_assignment.full_runtime_seconds_snapshot-elapsed as remaining
    from (
      select p_cycle.accumulated_active_seconds + case when p_cycle.operation_state='running'
        then extract(epoch from (p_server_now-p_cycle.running_since)) else 0::numeric end as elapsed
    ) activity
  ) timing
$$;

create function public.equipment_clock_command(
  p_action text,p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_assignment public.incident_equipment_assignments%rowtype;
  v_cycle public.equipment_cycles%rowtype;
  v_ended_cycle public.equipment_cycles%rowtype;
  v_request public.equipment_operation_requests%rowtype;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_metadata jsonb;
  v_now timestamptz;
  v_elapsed numeric;
  v_log_setting text;
  v_log_type text;
  v_title text;
begin
  if p_action is null or p_action not in ('start','pause','resume','refuel') or p_request_id is null then
    raise exception 'נדרשים סוג פעולה ומזהה בקשה תקינים' using errcode='22023';
  end if;
  -- Same lock order as stage 3: incident -> request -> assignment -> cycle.
  -- Existing-equipment mode permits active AND paused incidents.
  v_actor:=public.assert_equipment_incident_operation(p_incident_id,false);
  v_payload:=jsonb_build_object('incident_id',p_incident_id,'assignment_id',p_assignment_id,'expected_version',p_expected_version);
  insert into public.equipment_operation_requests(actor_id,request_id,incident_id,action_type,payload)
    values(v_actor,p_request_id,p_incident_id,p_action,v_payload)
    on conflict(actor_id,request_id) do nothing;
  select * into v_request from public.equipment_operation_requests
    where actor_id=v_actor and request_id=p_request_id for update;
  if v_request.action_type is distinct from p_action or v_request.payload is distinct from v_payload then
    raise exception 'מזהה הבקשה כבר שימש לתוכן אחר' using errcode='22023';
  end if;
  -- Replays return the original server timestamp and result, not a fresh clock
  -- sample. Call get_incident_equipment_state for a fresh reading after a retry.
  if v_request.result is not null then return v_request.result; end if;

  select * into v_assignment from public.incident_equipment_assignments
    where id=p_assignment_id and incident_id=p_incident_id for update;
  if not found then raise exception 'הקצאת הציוד לא נמצאה באירוע' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_assignment.version then
    raise exception 'ההקצאה השתנתה. יש לרענן ולנסות שוב' using errcode='40001';
  end if;
  if v_assignment.released_at is not null then
    raise exception 'לא ניתן לתפעל ציוד ששוחרר מהאירוע' using errcode='55000';
  end if;
  select * into v_cycle from public.equipment_cycles
    where assignment_id=v_assignment.id and incident_id=p_incident_id and ended_at is null for update;
  if not found then raise exception 'לא נמצא מחזור פתוח להקצאה' using errcode='55000'; end if;
  if (p_action='start' and v_cycle.operation_state<>'off')
    or (p_action='pause' and v_cycle.operation_state<>'running')
    or (p_action='resume' and v_cycle.operation_state<>'paused') then
    raise exception 'מצב הציוד אינו מאפשר את הפעולה המבוקשת' using errcode='55000';
  end if;
  if p_action='refuel' and (v_cycle.operation_state not in ('running','paused') or v_cycle.first_started_at is null) then
    raise exception 'ניתן לאשר תדלוק רק למחזור שהופעל לפחות פעם אחת' using errcode='55000';
  end if;

  -- Sample once, AFTER acquiring all locks. Do not use transaction-start now().
  v_now:=clock_timestamp();
  v_before:=public.equipment_clock_snapshot(v_assignment,v_cycle,v_now);
  v_elapsed:=(v_before->>'elapsed_seconds')::numeric;
  if p_action in ('start','resume') then
    update public.equipment_cycles set operation_state='running',running_since=v_now,
      first_started_at=coalesce(first_started_at,v_now),updated_at=v_now,updated_by=v_actor
      where id=v_cycle.id returning * into v_cycle;
  elsif p_action='pause' then
    update public.equipment_cycles set operation_state='paused',accumulated_active_seconds=v_elapsed,
      running_since=null,updated_at=v_now,updated_by=v_actor
      where id=v_cycle.id returning * into v_cycle;
  else
    -- Close a running segment (if any) without losing its elapsed history.
    update public.equipment_cycles set operation_state='paused',accumulated_active_seconds=v_elapsed,
      running_since=null,ended_at=v_now,ended_by=v_actor,end_reason='refueled',
      refueled_at=v_now,refueled_by=v_actor,updated_at=v_now,updated_by=v_actor
      where id=v_cycle.id returning * into v_ended_cycle;
    insert into public.equipment_cycles(assignment_id,incident_id,cycle_number,operation_state,
      accumulated_active_seconds,running_since,first_started_at,opened_at,created_at,created_by,updated_at,updated_by)
    values(v_assignment.id,p_incident_id,v_ended_cycle.cycle_number+1,'paused',0,null,null,v_now,v_now,v_actor,v_now,v_actor)
      returning * into v_cycle;
  end if;
  update public.incident_equipment_assignments set version=version+1,updated_at=v_now,updated_by=v_actor
    where id=v_assignment.id returning * into v_assignment;
  v_after:=public.equipment_clock_snapshot(v_assignment,v_cycle,v_now);
  v_log_type:=case p_action when 'start' then 'equipment_started' when 'pause' then 'equipment_paused'
    when 'resume' then 'equipment_resumed' else 'equipment_refueled' end;
  v_title:=case p_action when 'start' then 'הפעלת ציוד' when 'pause' then 'השהיית ציוד'
    when 'resume' then 'המשך הפעלת ציוד' else 'אושר תדלוק ציוד' end;
  v_metadata:=jsonb_build_object('request_id',p_request_id,'equipment_item_id',v_assignment.equipment_item_id,
    'team_id',v_assignment.team_id,'ad_hoc_team_id',v_assignment.ad_hoc_team_id,'server_now',v_now);
  if p_action='refuel' then
    v_metadata:=v_metadata || jsonb_build_object('ended_cycle',to_jsonb(v_ended_cycle),
      'new_cycle',to_jsonb(v_cycle),'confirmed_by',v_actor,'refueled_at',v_now);
  end if;
  -- Use the existing guarded event_logs insert path, with the SAME action time
  -- rather than append_audit_event's transaction-start timestamp.
  v_log_setting:=current_setting('rcc.allow_event_log_insert',true);
  perform set_config('rcc.allow_event_log_insert','on',true);
  insert into public.event_logs(incident_id,team_id,log_type,category,reported_at,created_at,
    title,description,importance,created_by,entity_type,entity_id,before_state,after_state,metadata)
  values(p_incident_id,v_assignment.team_id,v_log_type,'status_change',v_now,v_now,v_title,
    v_assignment.equipment_type_name_snapshot || ' — ' || v_assignment.asset_identifier_snapshot,
    case when p_action='refuel' then 'important' else 'normal' end,v_actor,'equipment_assignment',
    v_assignment.id,v_before,v_after,v_metadata);
  perform set_config('rcc.allow_event_log_insert',coalesce(v_log_setting,''),true);
  update public.equipment_operation_requests set result=v_after where actor_id=v_actor and request_id=p_request_id;
  return v_after;
end;
$$;

create function public.start_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_clock_command('start',p_incident_id,p_assignment_id,p_expected_version,p_request_id) $$;
create function public.pause_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_clock_command('pause',p_incident_id,p_assignment_id,p_expected_version,p_request_id) $$;
create function public.resume_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_clock_command('resume',p_incident_id,p_assignment_id,p_expected_version,p_request_id) $$;
create function public.confirm_equipment_refuel(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_clock_command('refuel',p_incident_id,p_assignment_id,p_expected_version,p_request_id) $$;

create function public.get_incident_equipment_state(p_incident_id uuid)
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
      'equipment_item_is_active',i.is_active,'equipment_type_is_active',et.is_active,'serviceability',i.serviceability
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

-- Inherit stage 3 RLS/ACLs: no direct writes and no new table write policies.
revoke all on function public.equipment_clock_snapshot(public.incident_equipment_assignments,public.equipment_cycles,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.equipment_clock_command(text,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.start_equipment(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pause_equipment(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.resume_equipment(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.confirm_equipment_refuel(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_incident_equipment_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.start_equipment(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.pause_equipment(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.resume_equipment(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.confirm_equipment_refuel(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.get_incident_equipment_state(uuid) to authenticated;

commit;
