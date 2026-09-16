-- Stage 5: demand-driven server-time detection and personal delivery leases.
-- No scheduler, Realtime publication, UI, sound or periodic clock writes.
begin;

create unique index equipment_cycles_alert_reference
  on public.equipment_cycles(id,assignment_id,incident_id,cycle_number);
create table public.equipment_cycle_alerts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null,
  assignment_id uuid not null,
  cycle_id uuid not null unique,
  cycle_number integer not null,
  warning_reached_at timestamptz not null,
  exhausted_at timestamptz,
  detected_at timestamptz not null,
  resolved_at timestamptz,
  resolution_reason text check (resolution_reason in ('refueled','released')),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(id,incident_id),
  foreign key(cycle_id,assignment_id,incident_id,cycle_number)
    references public.equipment_cycles(id,assignment_id,incident_id,cycle_number) on delete cascade,
  check ((resolved_at is null and resolution_reason is null and resolved_by is null)
    or (resolved_at is not null and resolution_reason is not null and resolved_by is not null))
);
create index equipment_active_alerts_incident on public.equipment_cycle_alerts(incident_id,id) where resolved_at is null;
create table public.equipment_alert_deliveries (
  alert_id uuid not null,
  incident_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_presented_at timestamptz,
  next_due_at timestamptz,
  snoozed_until timestamptz,
  last_presented_severity text check (last_presented_severity in ('warning','critical')),
  presentation_token uuid,
  lease_until timestamptz,
  dismissed_at timestamptz,
  -- Severity captured by claim is separate from the continuously computed one.
  -- Ack of a warning must not swallow a zero crossing that occurred in transit.
  claimed_severity text check (claimed_severity in ('warning','critical')),
  presentation_acknowledged boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(alert_id,user_id),
  foreign key(alert_id,incident_id) references public.equipment_cycle_alerts(id,incident_id) on delete cascade,
  check (lease_until is null or (presentation_token is not null and claimed_severity is not null and not presentation_acknowledged)),
  check (not presentation_acknowledged or (presentation_token is not null and last_presented_at is not null))
);

-- Also protect once-per-cycle audit semantics independently of caller retries.
create unique index equipment_threshold_log_once on public.event_logs(incident_id,entity_id,log_type)
  where entity_type='equipment_cycle' and log_type in ('equipment_warning_reached','equipment_runtime_exhausted');

-- Reconstruct a threshold crossing from the active segment or the immutable
-- pause/refuel log's before_state. Never subtract wall-clock pauses from time.
-- Missing historical evidence falls back to detection, explicitly labeled.
create function public.equipment_threshold_time(
  p_assignment public.incident_equipment_assignments,p_cycle public.equipment_cycles,
  p_target_seconds numeric,p_now timestamptz
) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_at timestamptz;
begin
  if p_target_seconds=0 then
    return jsonb_build_object('at',p_cycle.first_started_at,'source','first_started_at');
  end if;
  select (l.before_state->>'running_since')::timestamptz
      + make_interval(secs=>(p_target_seconds-(l.before_state->>'accumulated_active_seconds')::numeric)::double precision)
    into v_at from public.event_logs l
    where l.incident_id=p_assignment.incident_id and l.entity_id=p_assignment.id
      and l.entity_type='equipment_assignment' and l.log_type in ('equipment_paused','equipment_refueled')
      and l.before_state->>'cycle_id'=p_cycle.id::text and l.before_state->>'operation_state'='running'
      and (l.before_state->>'accumulated_active_seconds')::numeric<=p_target_seconds
      and (l.before_state->>'elapsed_seconds')::numeric>=p_target_seconds
    order by l.reported_at,l.id limit 1;
  if v_at is not null then return jsonb_build_object('at',v_at,'source','event_log_segment'); end if;
  if p_cycle.operation_state='running' and p_cycle.accumulated_active_seconds<=p_target_seconds then
    v_at:=p_cycle.running_since+make_interval(secs=>(p_target_seconds-p_cycle.accumulated_active_seconds)::double precision);
    if v_at<=p_now then return jsonb_build_object('at',v_at,'source','current_segment'); end if;
  end if;
  return jsonb_build_object('at',p_now,'source','detection_fallback');
end;
$$;

create function public.log_equipment_threshold(
  p_assignment public.incident_equipment_assignments,p_cycle public.equipment_cycles,
  p_log_type text,p_crossing jsonb,p_detected_at timestamptz,p_state jsonb
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_setting text;
begin
  v_setting:=current_setting('rcc.allow_event_log_insert',true);
  perform set_config('rcc.allow_event_log_insert','on',true);
  -- append_audit_event substitutes current_actor_id for NULL: intentionally use
  -- the guarded insert instead, preserving NULL for these automatic events.
  insert into public.event_logs(incident_id,team_id,log_type,category,reported_at,created_at,
    title,description,importance,created_by,entity_type,entity_id,after_state,metadata)
  values(p_assignment.incident_id,p_assignment.team_id,p_log_type,'system',(p_crossing->>'at')::timestamptz,p_detected_at,
    case p_log_type when 'equipment_warning_reached' then 'ציוד הגיע לטווח התרעה' else 'זמן העבודה של הציוד הסתיים' end,
    p_assignment.equipment_type_name_snapshot || ' — ' || p_assignment.asset_identifier_snapshot,
    case p_log_type when 'equipment_warning_reached' then 'important' else 'critical' end,
    null,'equipment_cycle',p_cycle.id,p_state,
    jsonb_build_object('automatic',true,'detected_at',p_detected_at,'crossing_time_source',p_crossing->>'source',
      'assignment_id',p_assignment.id,'cycle_id',p_cycle.id,'cycle_number',p_cycle.cycle_number))
  on conflict (incident_id,entity_id,log_type) where entity_type='equipment_cycle'
    and log_type in ('equipment_warning_reached','equipment_runtime_exhausted') do nothing;
  perform set_config('rcc.allow_event_log_insert',coalesce(v_setting,''),true);
end;
$$;

-- Private worker: caller MUST hold the incident lock and authorize access.
create function public.sync_equipment_alerts_internal(p_incident_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_a public.incident_equipment_assignments; v_c public.equipment_cycles;
  v_state jsonb; v_remaining numeric; v_crossing jsonb; v_id uuid;
begin
  for v_a in select * from public.incident_equipment_assignments
    where incident_id=p_incident_id and released_at is null order by id for update loop
    select * into v_c from public.equipment_cycles where assignment_id=v_a.id and ended_at is null for update;
    if not found or v_c.first_started_at is null then continue; end if;
    v_state:=public.equipment_clock_snapshot(v_a,v_c,p_now);
    v_remaining:=(v_state->>'remaining_seconds')::numeric;
    if v_remaining>v_a.warning_before_seconds_snapshot then continue; end if;
    if not exists(select 1 from public.equipment_cycle_alerts where cycle_id=v_c.id) then
      v_crossing:=public.equipment_threshold_time(v_a,v_c,v_a.full_runtime_seconds_snapshot-v_a.warning_before_seconds_snapshot,p_now);
      insert into public.equipment_cycle_alerts(incident_id,assignment_id,cycle_id,cycle_number,warning_reached_at,detected_at,created_at,updated_at)
      values(p_incident_id,v_a.id,v_c.id,v_c.cycle_number,(v_crossing->>'at')::timestamptz,p_now,p_now,p_now)
      on conflict(cycle_id) do nothing returning id into v_id;
      if found then perform public.log_equipment_threshold(v_a,v_c,'equipment_warning_reached',v_crossing,p_now,v_state); end if;
    end if;
    if v_remaining<=0 then
      v_crossing:=public.equipment_threshold_time(v_a,v_c,v_a.full_runtime_seconds_snapshot,p_now);
      update public.equipment_cycle_alerts set exhausted_at=(v_crossing->>'at')::timestamptz,updated_at=p_now
        where cycle_id=v_c.id and exhausted_at is null and resolved_at is null;
      if found then perform public.log_equipment_threshold(v_a,v_c,'equipment_runtime_exhausted',v_crossing,p_now,v_state); end if;
    end if;
  end loop;
end;
$$;

create function public.equipment_active_alert_state(p_incident_id uuid,p_now timestamptz)
returns table(alert_id uuid,severity text,details jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select al.id,case when (s.state->>'remaining_seconds')::numeric<=0 then 'critical' else 'warning' end,
    s.state || jsonb_build_object('alert_id',al.id,'warning_reached_at',al.warning_reached_at,
      'exhausted_at',al.exhausted_at,'detected_at',al.detected_at,
      'severity',case when (s.state->>'remaining_seconds')::numeric<=0 then 'critical' else 'warning' end,
      'team_name',case when a.team_id is not null then coalesce(t.name,'צוות ' || t.team_number::text) else h.name end)
  from public.equipment_cycle_alerts al
  join public.incident_equipment_assignments a on a.id=al.assignment_id and a.incident_id=al.incident_id
  join public.equipment_cycles c on c.id=al.cycle_id
  left join public.teams t on t.id=a.team_id
  left join public.incident_ad_hoc_teams h on h.id=a.ad_hoc_team_id
  cross join lateral (select public.equipment_clock_snapshot(a,c,p_now) as state) s
  where al.incident_id=p_incident_id and al.resolved_at is null and a.released_at is null
    and c.ended_at is null and c.first_started_at is not null
$$;

create function public.sync_equipment_alerts(p_incident_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_now timestamptz; v_alerts jsonb;
begin
  -- Sync writes automatic audit records, so restrict it to operational editors.
  -- Authorized viewers can SELECT alert history under RLS, but cannot claim.
  perform public.assert_equipment_incident_operation(p_incident_id,false);
  v_now:=clock_timestamp();
  perform public.sync_equipment_alerts_internal(p_incident_id,v_now);
  select coalesce(jsonb_agg(details order by alert_id),'[]'::jsonb) into v_alerts
    from public.equipment_active_alert_state(p_incident_id,v_now);
  return jsonb_build_object('server_now',v_now,'alerts',v_alerts);
end;
$$;

create function public.claim_equipment_alerts(p_incident_id uuid,p_presentation_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid; v_now timestamptz; v_alert record; v_d public.equipment_alert_deliveries;
  v_result jsonb:='[]'::jsonb; v_due boolean;
begin
  if p_presentation_token is null then raise exception 'נדרש מזהה הצגה' using errcode='22023'; end if;
  v_actor:=public.assert_equipment_incident_operation(p_incident_id,false);
  v_now:=clock_timestamp();
  perform public.sync_equipment_alerts_internal(p_incident_id,v_now);
  for v_alert in select * from public.equipment_active_alert_state(p_incident_id,v_now) order by alert_id loop
    insert into public.equipment_alert_deliveries(alert_id,incident_id,user_id,created_at,updated_at)
      values(v_alert.alert_id,p_incident_id,v_actor,v_now,v_now) on conflict(alert_id,user_id) do nothing;
    select * into v_d from public.equipment_alert_deliveries where alert_id=v_alert.alert_id and user_id=v_actor for update;
    if v_d.lease_until>v_now then
      -- Retry by the SAME presentation owner returns its lease without renewal.
      -- Other tokens never steal a live lease, even when severity escalates.
      if v_d.presentation_token=p_presentation_token then
        v_result:=v_result || jsonb_build_array(v_alert.details || jsonb_build_object(
          'presentation_token',v_d.presentation_token,'lease_until',v_d.lease_until,'claimed_severity',v_d.claimed_severity));
      end if;
      continue;
    end if;
    -- Use a fresh UUID for each new presentation attempt (one UUID per batch).
    if v_d.presentation_token=p_presentation_token then continue; end if;
    v_due:=(v_d.next_due_at is null or v_d.next_due_at<=v_now)
      and (v_d.snoozed_until is null or v_d.snoozed_until<=v_now);
    if v_alert.severity='critical' and v_d.last_presented_severity is distinct from 'critical' then v_due:=true; end if;
    if not v_due then continue; end if;
    update public.equipment_alert_deliveries set presentation_token=p_presentation_token,lease_until=v_now+interval '30 seconds',
      claimed_severity=v_alert.severity,presentation_acknowledged=false,dismissed_at=null,updated_at=v_now
      where alert_id=v_alert.alert_id and user_id=v_actor returning * into v_d;
    v_result:=v_result || jsonb_build_array(v_alert.details || jsonb_build_object(
      'presentation_token',v_d.presentation_token,'lease_until',v_d.lease_until,'claimed_severity',v_d.claimed_severity));
  end loop;
  return jsonb_build_object('server_now',v_now,'alerts',v_result);
end;
$$;

-- Token identifies a presentation generation, not a user-supplied actor.
-- Retaining the token after ack permits dismissing the rendered window. Both
-- operations replay without extending deadlines; a later claim fences it out.
create function public.equipment_alert_presentation_command(
  p_action text,p_incident_id uuid,p_alert_id uuid,p_presentation_token uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid; v_now timestamptz; v_al public.equipment_cycle_alerts; v_d public.equipment_alert_deliveries;
begin
  if p_action is null or p_action not in ('ack','dismiss') or p_presentation_token is null then
    raise exception 'נדרשים פעולה ומזהה הצגה תקינים' using errcode='22023';
  end if;
  v_actor:=public.assert_equipment_incident_operation(p_incident_id,false);
  select * into v_al from public.equipment_cycle_alerts where id=p_alert_id and incident_id=p_incident_id for update;
  if not found then raise exception 'ההתראה אינה זמינה באירוע' using errcode='42501'; end if;
  if v_al.resolved_at is not null then raise exception 'ההתראה כבר הסתיימה' using errcode='55000'; end if;
  select * into v_d from public.equipment_alert_deliveries where alert_id=p_alert_id and user_id=v_actor for update;
  if not found or v_d.presentation_token is distinct from p_presentation_token then
    raise exception 'מזהה ההצגה אינו תקף למשתמש' using errcode='42501';
  end if;
  v_now:=clock_timestamp();
  if not v_d.presentation_acknowledged and (v_d.lease_until is null or v_d.lease_until<=v_now) then
    raise exception 'פג תוקף ההצגה. יש לבקש הצגה מחדש' using errcode='55000';
  end if;
  if (p_action='ack' and v_d.presentation_acknowledged) or (p_action='dismiss' and v_d.dismissed_at is not null) then
    return to_jsonb(v_d);
  end if;
  -- Dismissing before ack also acknowledges that presentation, so a reordered
  -- network request cannot leave a live lease or change the five-minute delay.
  update public.equipment_alert_deliveries set
    last_presented_at=case when presentation_acknowledged then last_presented_at else v_now end,
    last_presented_severity=case when presentation_acknowledged then last_presented_severity else claimed_severity end,
    next_due_at=v_now+interval '5 minutes',lease_until=null,presentation_acknowledged=true,
    dismissed_at=case when p_action='dismiss' then v_now else dismissed_at end,
    snoozed_until=case when p_action='dismiss' then v_now+interval '5 minutes' else null end,updated_at=v_now
    where alert_id=p_alert_id and user_id=v_actor returning * into v_d;
  return to_jsonb(v_d);
end;
$$;

create function public.ack_equipment_alert_presented(p_incident_id uuid,p_alert_id uuid,p_presentation_token uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select public.equipment_alert_presentation_command('ack',p_incident_id,p_alert_id,p_presentation_token)
$$;
create function public.dismiss_equipment_alert(p_incident_id uuid,p_alert_id uuid,p_presentation_token uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select public.equipment_alert_presentation_command('dismiss',p_incident_id,p_alert_id,p_presentation_token)
$$;

-- Reusable by the future atomic release operation. Caller already holds the
-- incident/assignment/cycle locks; only the cycle's recorded ending may resolve.
create function public.resolve_equipment_cycle_alert(p_cycle_id uuid,p_at timestamptz,p_reason text,p_actor uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if p_reason is null or p_reason not in ('refueled','released') or p_actor is distinct from auth.uid()
    or p_actor is null or not exists(select 1 from public.equipment_cycles where id=p_cycle_id
      and ended_at=p_at and ended_by=p_actor and end_reason=p_reason and operation_state<>'running') then
    raise exception 'סיום המחזור אינו תקין' using errcode='55000';
  end if;
  update public.equipment_cycle_alerts set resolved_at=p_at,resolution_reason=p_reason,resolved_by=p_actor,updated_at=p_at
    where cycle_id=p_cycle_id and resolved_at is null returning id into v_id;
  if found then
    update public.equipment_alert_deliveries set presentation_token=null,lease_until=null,next_due_at=null,
      snoozed_until=null,presentation_acknowledged=false,claimed_severity=null,updated_at=p_at where alert_id=v_id;
  end if;
end;
$$;

-- Preserve stage 4's signature, result, clock engine, request handling and logs.
-- On replay the old result locates the same ended cycle; resolver is a no-op.
create or replace function public.confirm_equipment_refuel(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_result jsonb; v_old_cycle uuid;
begin
  v_result:=public.equipment_clock_command('refuel',p_incident_id,p_assignment_id,p_expected_version,p_request_id);
  select id into strict v_old_cycle from public.equipment_cycles where assignment_id=p_assignment_id and incident_id=p_incident_id
    and cycle_number=(v_result->>'cycle_number')::integer-1;
  perform public.resolve_equipment_cycle_alert(v_old_cycle,(v_result->>'server_now')::timestamptz,'refueled',auth.uid());
  return v_result;
end;
$$;

alter table public.equipment_cycle_alerts enable row level security;
alter table public.equipment_alert_deliveries enable row level security;
create policy equipment_alerts_read on public.equipment_cycle_alerts for select to authenticated
  using(public.can_read_equipment_incident(incident_id));
-- Deliveries deliberately have NO policies or direct SELECT grant: RPC only.
revoke all on public.equipment_cycle_alerts,public.equipment_alert_deliveries from public,anon,authenticated,service_role;
grant select on public.equipment_cycle_alerts to authenticated;

revoke all on function public.equipment_threshold_time(public.incident_equipment_assignments,public.equipment_cycles,numeric,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.log_equipment_threshold(public.incident_equipment_assignments,public.equipment_cycles,text,jsonb,timestamptz,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.sync_equipment_alerts_internal(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.equipment_active_alert_state(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.equipment_alert_presentation_command(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.resolve_equipment_cycle_alert(uuid,timestamptz,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.sync_equipment_alerts(uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_equipment_alerts(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ack_equipment_alert_presented(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dismiss_equipment_alert(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.confirm_equipment_refuel(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sync_equipment_alerts(uuid) to authenticated;
grant execute on function public.claim_equipment_alerts(uuid,uuid) to authenticated;
grant execute on function public.ack_equipment_alert_presented(uuid,uuid,uuid) to authenticated;
grant execute on function public.dismiss_equipment_alert(uuid,uuid,uuid) to authenticated;
grant execute on function public.confirm_equipment_refuel(uuid,uuid,bigint,uuid) to authenticated;
commit;
