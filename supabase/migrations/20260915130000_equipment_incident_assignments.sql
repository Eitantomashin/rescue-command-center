-- Stage 3 only: assignments, initial off cycles, transfer, location and release.
-- No operation-state actions, refuel, alert delivery, UI or per-second writes.
begin;

-- Composite foreign keys enforce incident ownership, including privileged writes.
create unique index equipment_teams_incident_key on public.teams(id, incident_id);
create unique index equipment_ad_hoc_teams_incident_key on public.incident_ad_hoc_teams(id, incident_id);

create table public.incident_equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  equipment_item_id uuid not null references public.equipment_items(id) on delete restrict,
  team_id uuid,
  ad_hoc_team_id uuid,
  location text,
  notes text,
  equipment_type_id_snapshot uuid not null references public.equipment_types(id) on delete restrict,
  equipment_type_name_snapshot text not null,
  category_snapshot text not null,
  instructions_snapshot text,
  asset_identifier_snapshot text not null,
  full_runtime_seconds_snapshot integer not null check (full_runtime_seconds_snapshot > 0),
  warning_before_seconds_snapshot integer not null check (
    warning_before_seconds_snapshot > 0 and warning_before_seconds_snapshot <= full_runtime_seconds_snapshot),
  allocated_at timestamptz not null default now(),
  allocated_by uuid not null references public.profiles(id),
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  release_reason text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  unique (id, incident_id),
  check (num_nonnulls(team_id, ad_hoc_team_id) = 1),
  check ((released_at is null and released_by is null and release_reason is null)
    or (released_at is not null and released_by is not null and released_at >= allocated_at
      and release_reason is not null and release_reason ~ '[^[:space:]]')),
  -- Deferred NO ACTION lets the existing incident purge delete teams before
  -- deleting the incident, which then cascades these operational rows.
  foreign key (team_id, incident_id) references public.teams(id, incident_id)
    deferrable initially deferred,
  foreign key (ad_hoc_team_id, incident_id) references public.incident_ad_hoc_teams(id, incident_id)
    deferrable initially deferred
);
create unique index equipment_one_open_assignment_per_item
  on public.incident_equipment_assignments(equipment_item_id) where released_at is null;
create index equipment_assignments_incident_idx on public.incident_equipment_assignments(incident_id, allocated_at desc);
create index equipment_assignments_team_idx on public.incident_equipment_assignments(team_id) where released_at is null;
create index equipment_assignments_ad_hoc_idx on public.incident_equipment_assignments(ad_hoc_team_id) where released_at is null;

create table public.equipment_cycles (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  incident_id uuid not null,
  cycle_number integer not null check (cycle_number > 0),
  operation_state text not null default 'off' check (operation_state in ('off', 'running', 'paused')),
  accumulated_active_seconds numeric(20,6) not null default 0
    check (accumulated_active_seconds >= 0 and accumulated_active_seconds <> 'NaN'::numeric),
  running_since timestamptz,
  first_started_at timestamptz,
  opened_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id),
  end_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  foreign key (assignment_id, incident_id) references public.incident_equipment_assignments(id, incident_id) on delete cascade,
  unique (assignment_id, cycle_number),
  check ((operation_state = 'running') = (running_since is not null)),
  check (operation_state <> 'running' or (first_started_at is not null and running_since >= first_started_at)),
  check (operation_state <> 'off' or (accumulated_active_seconds = 0 and first_started_at is null)),
  check ((ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null
      and end_reason ~ '[^[:space:]]' and ended_at >= opened_at and operation_state <> 'running'))
);
create unique index equipment_one_open_cycle on public.equipment_cycles(assignment_id) where ended_at is null;
create index equipment_cycles_incident_idx on public.equipment_cycles(incident_id);

create table public.equipment_operation_requests (
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  action_type text not null check (action_type in ('assign', 'update', 'transfer', 'release')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
create index equipment_requests_incident_idx on public.equipment_operation_requests(incident_id);

create function public.can_read_equipment_incident(p_incident_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.deleted_at is null
  ) and coalesce(public.can_read_incident(p_incident_id), false)
$$;

create function public.assert_equipment_incident_editor(p_incident_id uuid)
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active
      and p.deleted_at is null and p.role in ('admin', 'commander', 'editor')
  ) or public.can_read_equipment_incident(p_incident_id) is not true
    or public.can_edit_operational_data(p_incident_id) is not true then
    raise exception 'אין הרשאה לניהול ציוד באירוע זה' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Shared, locked lifecycle gate for current and future equipment operations.
-- Only NEW allocation requires active; existing equipment also operates paused.
-- Stage 4 can reuse the default false without duplicating lifecycle checks.
create function public.assert_equipment_incident_operation(p_incident_id uuid, p_is_new_assignment boolean default false)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.assert_equipment_incident_editor(p_incident_id);
  v_incident public.incidents%rowtype;
begin
  select * into v_incident from public.incidents where id=p_incident_id for update;
  if not found then raise exception 'האירוע אינו זמין' using errcode='42501'; end if;
  v_actor := public.assert_equipment_incident_editor(p_incident_id);
  if v_incident.archived_at is not null or v_incident.is_closed
    or v_incident.lifecycle_status is null or v_incident.lifecycle_status not in ('active','paused') then
    raise exception 'אירוע סגור או מאורכב אינו מאפשר פעולות ציוד רגילות' using errcode='55000';
  end if;
  if p_is_new_assignment is null then
    raise exception 'יש לציין אם הפעולה היא הקצאה חדשה' using errcode='22023';
  end if;
  if p_is_new_assignment and v_incident.lifecycle_status <> 'active' then
    raise exception 'הקצאת ציוד חדש מותרת רק באירוע פעיל' using errcode='55000';
  end if;
  return v_actor;
end;
$$;

create function public.lock_equipment_assignment_team(p_incident_id uuid, p_team_id uuid, p_ad_hoc_team_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if num_nonnulls(p_team_id, p_ad_hoc_team_id) <> 1 then
    raise exception 'יש לבחור צוות אחד בדיוק' using errcode = '22023';
  end if;
  if p_team_id is not null then
    perform 1 from public.teams where id = p_team_id and incident_id = p_incident_id and is_active for update;
  else
    perform 1 from public.incident_ad_hoc_teams
      where id = p_ad_hoc_team_id and incident_id = p_incident_id and status = 'active' and archived_at is null for update;
  end if;
  if not found then raise exception 'הצוות אינו פעיל או אינו שייך לאירוע' using errcode = '22023'; end if;
end;
$$;

-- Snapshot and identity remain immutable even if a future RPC updates the row.
create function public.guard_equipment_assignment_update()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if (to_jsonb(new) - array['team_id','ad_hoc_team_id','location','notes','released_at','released_by','release_reason','version','updated_at','updated_by'])
    is distinct from
    (to_jsonb(old) - array['team_id','ad_hoc_team_id','location','notes','released_at','released_by','release_reason','version','updated_at','updated_by']) then
    raise exception 'נתוני המקור של ההקצאה אינם ניתנים לשינוי' using errcode = '23514';
  end if;
  if old.released_at is not null then
    raise exception 'הקצאה ששוחררה אינה ניתנת לשינוי' using errcode = '23514';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'גרסת הקצאה אינה תקינה' using errcode = '23514';
  end if;
  if new.released_at is not null and exists (
    select 1 from public.equipment_cycles c where c.assignment_id = old.id
      and (c.ended_at is null or c.operation_state = 'running')
  ) then
    raise exception 'יש לסיים מחזור שאינו פועל לפני שחרור ציוד' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger equipment_assignment_update_guard before update on public.incident_equipment_assignments
  for each row execute function public.guard_equipment_assignment_update();

-- Core implementation is private (no application EXECUTE privilege).
-- Lock order: incident -> request -> assignment (when present) -> item -> type
-- -> destination team -> cycle. Archive RPC uses incident -> ad-hoc team.
create function public.equipment_assignment_command(
  p_action text, p_incident_id uuid, p_request_id uuid,
  p_assignment_id uuid, p_equipment_item_id uuid,
  p_team_id uuid, p_ad_hoc_team_id uuid,
  p_location text, p_notes text, p_release_reason text, p_expected_version bigint
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_assignment public.incident_equipment_assignments%rowtype;
  v_item public.equipment_items%rowtype;
  v_type public.equipment_types%rowtype;
  v_cycle public.equipment_cycles%rowtype;
  v_request public.equipment_operation_requests%rowtype;
  v_before jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_log_type text;
  v_title text;
  v_now timestamptz;
  v_log_setting text;
begin
  if p_request_id is null or p_action is null or p_action not in ('assign','update','transfer','release') then
    raise exception 'מזהה בקשה וסוג פעולה תקינים נדרשים' using errcode = '22023';
  end if;
  v_actor := public.assert_equipment_incident_operation(p_incident_id,p_action='assign');
  v_payload := jsonb_build_object('incident_id',p_incident_id,'assignment_id',p_assignment_id,
    'equipment_item_id',p_equipment_item_id,'team_id',p_team_id,'ad_hoc_team_id',p_ad_hoc_team_id,
    'location',p_location,'notes',p_notes,'release_reason',p_release_reason,'expected_version',p_expected_version);
  insert into public.equipment_operation_requests(actor_id,request_id,incident_id,action_type,payload)
    values(v_actor,p_request_id,p_incident_id,p_action,v_payload)
    on conflict (actor_id,request_id) do nothing;
  select * into v_request from public.equipment_operation_requests
    where actor_id = v_actor and request_id = p_request_id for update;
  if v_request.action_type is distinct from p_action or v_request.payload is distinct from v_payload then
    raise exception 'מזהה הבקשה כבר שימש לתוכן אחר' using errcode = '22023';
  end if;
  -- Replay returns the original result, not a new mutation or the latest version.
  -- Authentication, incident authorization and lifecycle apply to every replay.
  if v_request.result is not null then return v_request.result; end if;

  if p_action = 'assign' then
    select * into v_item from public.equipment_items where id = p_equipment_item_id for update;
    if not found then raise exception 'פריט הציוד אינו זמין להקצאה' using errcode = '55000'; end if;
    select * into v_type from public.equipment_types where id = v_item.equipment_type_id for update;
    if not found or not v_item.is_active or v_item.serviceability <> 'serviceable' or not v_type.is_active then
      raise exception 'פריט הציוד או סוגו אינם פעילים וכשירים להקצאה' using errcode = '55000';
    end if;
    if exists (select 1 from public.incident_equipment_assignments where equipment_item_id = v_item.id and released_at is null) then
      -- Never return another incident's ID, team, name or assignment.
      raise exception 'פריט הציוד אינו פנוי להקצאה' using errcode = '55000';
    end if;
    perform public.lock_equipment_assignment_team(p_incident_id,p_team_id,p_ad_hoc_team_id);
    v_now := clock_timestamp();
    insert into public.incident_equipment_assignments (
      incident_id,equipment_item_id,team_id,ad_hoc_team_id,location,notes,
      equipment_type_id_snapshot,equipment_type_name_snapshot,category_snapshot,instructions_snapshot,
      asset_identifier_snapshot,full_runtime_seconds_snapshot,warning_before_seconds_snapshot,
      allocated_at,allocated_by,created_at,updated_at,updated_by
    ) values (
      p_incident_id,v_item.id,p_team_id,p_ad_hoc_team_id,nullif(btrim(p_location),''),nullif(btrim(p_notes),''),
      v_type.id,v_type.name,v_type.category,v_type.instructions,v_item.asset_identifier,
      v_type.full_runtime_seconds,v_type.warning_before_seconds,v_now,v_actor,v_now,v_now,v_actor
    ) returning * into v_assignment;
    insert into public.equipment_cycles(assignment_id,incident_id,cycle_number,operation_state,
      accumulated_active_seconds,running_since,first_started_at,opened_at,created_at,created_by,updated_at,updated_by)
    values(v_assignment.id,p_incident_id,1,'off',0,null,null,v_now,v_now,v_actor,v_now,v_actor)
    returning * into v_cycle;
    v_log_type := 'equipment_assigned'; v_title := 'ציוד הוקצה לאירוע';
  else
    select * into v_assignment from public.incident_equipment_assignments
      where id = p_assignment_id and incident_id = p_incident_id for update;
    if not found then raise exception 'הקצאת הציוד לא נמצאה באירוע' using errcode = 'P0002'; end if;
    if p_expected_version is null or p_expected_version <> v_assignment.version then
      raise exception 'ההקצאה השתנתה. יש לרענן ולנסות שוב' using errcode = '40001';
    end if;
    if v_assignment.released_at is not null then
      raise exception 'הציוד כבר שוחרר מהאירוע' using errcode = '55000';
    end if;
    v_before := to_jsonb(v_assignment);
    if p_action = 'transfer' then
      perform public.lock_equipment_assignment_team(p_incident_id,p_team_id,p_ad_hoc_team_id);
    end if;
    select * into v_cycle from public.equipment_cycles
      where assignment_id = v_assignment.id and ended_at is null for update;
    if not found then raise exception 'לא נמצא מחזור פתוח להקצאה' using errcode = '55000'; end if;
    v_now := clock_timestamp();
    if p_action = 'release' then
      if v_cycle.operation_state = 'running' then
        raise exception 'לא ניתן לשחרר ציוד פועל. נדרשת עצירה מפורשת' using errcode = '55000';
      end if;
      -- Stage 3 only exposes off release; paused is reserved for the next stage.
      if v_cycle.operation_state <> 'off' then
        raise exception 'בשלב זה ניתן לשחרר רק ציוד שטרם הופעל' using errcode = '55000';
      end if;
      if nullif(btrim(p_release_reason),'') is null then
        raise exception 'יש להזין סיבת שחרור' using errcode = '22023';
      end if;
      update public.equipment_cycles set ended_at=v_now,ended_by=v_actor,end_reason='released',
        updated_at=v_now,updated_by=v_actor where id=v_cycle.id returning * into v_cycle;
    end if;
    update public.incident_equipment_assignments set
      location=case when p_action='update' then nullif(btrim(p_location),'') else location end,
      notes=case when p_action='update' then nullif(btrim(p_notes),'') else notes end,
      team_id=case when p_action='transfer' then p_team_id else team_id end,
      ad_hoc_team_id=case when p_action='transfer' then p_ad_hoc_team_id else ad_hoc_team_id end,
      released_at=case when p_action='release' then v_now else null end,
      released_by=case when p_action='release' then v_actor else null end,
      release_reason=case when p_action='release' then btrim(p_release_reason) else null end,
      version=version+1,updated_at=v_now,updated_by=v_actor
    where id=v_assignment.id returning * into v_assignment;
    v_log_type := case p_action when 'update' then 'equipment_assignment_updated'
      when 'transfer' then 'equipment_transferred' else 'equipment_released' end;
    v_title := case p_action when 'update' then 'מיקום או הערות ציוד עודכנו'
      when 'transfer' then 'ציוד הועבר בין צוותים' else 'ציוד שוחרר מהאירוע' end;
  end if;

  v_log_setting := current_setting('rcc.allow_event_log_insert',true);
  perform public.append_audit_event(
    p_incident_id=>p_incident_id,p_log_type=>v_log_type,p_title=>v_title,
    p_description=>v_assignment.equipment_type_name_snapshot || ' — ' || v_assignment.asset_identifier_snapshot,
    p_team_id=>v_assignment.team_id,p_entity_type=>'equipment_assignment',p_entity_id=>v_assignment.id,
    p_before_state=>v_before,p_after_state=>to_jsonb(v_assignment),p_actor_id=>v_actor,
    p_metadata=>jsonb_build_object('request_id',p_request_id,'equipment_item_id',v_assignment.equipment_item_id,
      'equipment_type_id',v_assignment.equipment_type_id_snapshot,'equipment_type_name',v_assignment.equipment_type_name_snapshot,
      'asset_identifier',v_assignment.asset_identifier_snapshot,'previous_team_id',v_before->'team_id',
      'previous_ad_hoc_team_id',v_before->'ad_hoc_team_id','team_id',v_assignment.team_id,
      'ad_hoc_team_id',v_assignment.ad_hoc_team_id,'location',v_assignment.location,
      'cycle_id',v_cycle.id,'release_reason',v_assignment.release_reason)
  );
  perform set_config('rcc.allow_event_log_insert',coalesce(v_log_setting,''),true);
  v_result := jsonb_build_object('assignment_id',v_assignment.id,'cycle_id',v_cycle.id,'version',v_assignment.version);
  update public.equipment_operation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
  return v_result;
end;
$$;

create function public.assign_equipment(p_incident_id uuid,p_equipment_item_id uuid,p_request_id uuid,
  p_team_id uuid default null,p_ad_hoc_team_id uuid default null,p_location text default null,p_notes text default null)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_assignment_command('assign',p_incident_id,p_request_id,null,p_equipment_item_id,
  p_team_id,p_ad_hoc_team_id,p_location,p_notes,null,null) $$;

create function public.update_equipment_assignment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,
  p_request_id uuid,p_location text default null,p_notes text default null)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_assignment_command('update',p_incident_id,p_request_id,p_assignment_id,null,
  null,null,p_location,p_notes,null,p_expected_version) $$;

create function public.transfer_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,
  p_request_id uuid,p_team_id uuid default null,p_ad_hoc_team_id uuid default null)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_assignment_command('transfer',p_incident_id,p_request_id,p_assignment_id,null,
  p_team_id,p_ad_hoc_team_id,null,null,null,p_expected_version) $$;

create function public.release_equipment(p_incident_id uuid,p_assignment_id uuid,p_expected_version bigint,
  p_request_id uuid,p_release_reason text)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.equipment_assignment_command('release',p_incident_id,p_request_id,p_assignment_id,null,
  null,null,null,null,p_release_reason,p_expected_version) $$;

-- Also protect direct updates allowed by the existing ad-hoc team RLS policy.
-- This trigger never locks the incident (avoids inverse team->incident order).
create function public.guard_ad_hoc_equipment_archive()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if (new.status = 'archived' or new.archived_at is not null) and exists (
    select 1 from public.incident_equipment_assignments where ad_hoc_team_id=old.id and released_at is null
  ) then
    raise exception 'לא ניתן לארכב צוות עם ציוד מוקצה. יש להעביר או לשחרר את הציוד' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger ad_hoc_equipment_archive_guard before update on public.incident_ad_hoc_teams
  for each row execute function public.guard_ad_hoc_equipment_archive();

create or replace function public.archive_incident_ad_hoc_team(p_incident_id uuid,p_ad_hoc_team_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_team public.incident_ad_hoc_teams%rowtype; v_actor uuid;
begin
  v_actor := public.assert_equipment_incident_editor(p_incident_id);
  perform 1 from public.incidents where id=p_incident_id for update;
  v_actor := public.assert_equipment_incident_editor(p_incident_id);
  select * into v_team from public.incident_ad_hoc_teams
    where id=p_ad_hoc_team_id and incident_id=p_incident_id for update;
  if not found then raise exception 'Ad-hoc team not found'; end if;
  update public.incident_ad_hoc_teams set status='archived',archived_at=clock_timestamp(),
    archived_by=v_actor,updated_by=v_actor where id=p_ad_hoc_team_id;
  perform public.log_incident_personnel_event_internal(p_incident_id,'incident_ad_hoc_team_archived',
    'צוות אד־הוק הועבר לארכיון','צוות אד־הוק "' || v_team.name || '" הועבר לארכיון.',
    'important',null,jsonb_build_object('ad_hoc_team_id',p_ad_hoc_team_id));
end;
$$;

alter table public.incident_equipment_assignments enable row level security;
alter table public.equipment_cycles enable row level security;
alter table public.equipment_operation_requests enable row level security;
create policy equipment_assignments_read on public.incident_equipment_assignments
  for select to authenticated using (public.can_read_equipment_incident(incident_id));
create policy equipment_cycles_read on public.equipment_cycles
  for select to authenticated using (public.can_read_equipment_incident(incident_id));
create policy equipment_requests_read on public.equipment_operation_requests
  for select to authenticated using (actor_id=auth.uid() and public.can_read_equipment_incident(incident_id));
revoke all on public.incident_equipment_assignments,public.equipment_cycles,public.equipment_operation_requests
  from public,anon,authenticated,service_role;
grant select on public.incident_equipment_assignments,public.equipment_cycles,public.equipment_operation_requests to authenticated;

revoke all on function public.can_read_equipment_incident(uuid) from public,anon,authenticated,service_role;
revoke all on function public.assert_equipment_incident_editor(uuid) from public,anon,authenticated,service_role;
revoke all on function public.assert_equipment_incident_operation(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.lock_equipment_assignment_team(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.guard_equipment_assignment_update() from public,anon,authenticated,service_role;
revoke all on function public.equipment_assignment_command(text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.assign_equipment(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.update_equipment_assignment(uuid,uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.transfer_equipment(uuid,uuid,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.release_equipment(uuid,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.guard_ad_hoc_equipment_archive() from public,anon,authenticated,service_role;
revoke all on function public.archive_incident_ad_hoc_team(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_read_equipment_incident(uuid) to authenticated;
grant execute on function public.assign_equipment(uuid,uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.update_equipment_assignment(uuid,uuid,bigint,uuid,text,text) to authenticated;
grant execute on function public.transfer_equipment(uuid,uuid,bigint,uuid,uuid,uuid) to authenticated;
grant execute on function public.release_equipment(uuid,uuid,bigint,uuid,text) to authenticated;
grant execute on function public.archive_incident_ad_hoc_team(uuid,uuid) to authenticated;

commit;
