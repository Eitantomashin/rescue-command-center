-- Phase 2.1 Run All Backend Validations
--
-- Replace the UUID below with a real auth.users.id that has public.profiles.role = system_administrator.
-- Then run this entire file in Supabase SQL Editor.
--
-- This script validates:
-- - Incident creation
-- - Site generation
-- - Floor generation
-- - Unit generation
-- - Person workflow
-- - Team workflow
-- - Merge workflow
-- - Event log workflow
-- - Dashboard views

do $$
declare
  v_test_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_incident_status_id uuid;
  v_site_id uuid;
  v_incident_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_person_101_id uuid;
  v_person_901_id uuid;
  v_team_id uuid;
  v_assignment_id uuid;
  v_missing_status_id uuid;
  v_trapped_status_id uuid;
  v_duplicate_status_id uuid;
  v_team_status_available uuid;
  v_team_status_assigned uuid;
  v_floor_count integer;
  v_active_unit_count integer;
  v_total_unit_count integer;
  v_inactive_top_floor_units integer;
  v_event_count integer;
  v_dashboard record;
begin
  if v_test_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace v_test_user_id with a real system_administrator auth.users.id';
  end if;

  perform set_config('rcc.sql_editor_validation_mode', 'on', true);
  perform set_config('rcc.test_user_id', v_test_user_id::text, true);

  if not exists (
    select 1
    from public.profiles
    where id = v_test_user_id
      and role = 'system_administrator'
  ) then
    raise exception 'Test user % is not a system_administrator profile', v_test_user_id;
  end if;

  raise notice '1/9 Test context active for system administrator %', v_test_user_id;

  v_incident_status_id := public.get_status_id('incident', 'active', null);
  v_missing_status_id := public.get_status_id('person', 'missing', null);
  v_trapped_status_id := public.get_status_id('person', 'trapped_located_not_yet_rescued', null);
  v_duplicate_status_id := public.get_status_id('person', 'duplicate_cancelled', null);
  v_team_status_available := public.get_status_id('team', 'available', null);
  v_team_status_assigned := public.get_status_id('team', 'assigned', null);

  if v_incident_status_id is null
    or v_missing_status_id is null
    or v_trapped_status_id is null
    or v_duplicate_status_id is null
    or v_team_status_available is null
    or v_team_status_assigned is null
  then
    raise exception 'One or more required default statuses are missing';
  end if;

  insert into public.incidents (
    name,
    city,
    address,
    opened_at,
    status_id,
    created_by,
    updated_by
  )
  values (
    'Phase 2.1 Validation Incident',
    'Validation City',
    'Validation Address 21',
    now(),
    v_incident_status_id,
    public.current_actor_id(),
    public.current_actor_id()
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
    public.current_actor_id(),
    'incident_commander',
    public.current_actor_id()
  )
  on conflict (incident_id, user_id) do nothing;

  perform public.create_event_log(
    v_incident_id,
    'incident_opened',
    'Incident Opened',
    'Phase 2.1 validation incident created',
    'administrative',
    'normal'
  );

  raise notice '2/9 Incident created: %', v_incident_id;

  v_site_id := public.create_site_with_structure(
    v_incident_id,
    1,
    'Validation Street',
    '21',
    3,
    4,
    'Validation Site 1',
    'Validation City',
    5,
    0,
    null,
    null
  );

  select count(*)::integer into v_floor_count
  from public.floors
  where site_id = v_site_id
    and is_active = true;

  select count(*)::integer into v_active_unit_count
  from public.units
  where site_id = v_site_id
    and is_active = true;

  if v_floor_count <> 3 then
    raise exception 'Expected 3 active floors, got %', v_floor_count;
  end if;

  if v_active_unit_count <> 12 then
    raise exception 'Expected 12 active units, got %', v_active_unit_count;
  end if;

  raise notice '3/9 Site/floor/unit generation validated: site %, floors %, active units %',
    v_site_id, v_floor_count, v_active_unit_count;

  select id into v_floor_id
  from public.floors
  where site_id = v_site_id
    and floor_number = 3;

  perform public.set_floor_unit_count(
    v_floor_id,
    2,
    'Phase 2.1 validation floor reduction'
  );

  select count(*)::integer into v_active_unit_count
  from public.units
  where floor_id = v_floor_id
    and is_active = true;

  select count(*)::integer into v_inactive_top_floor_units
  from public.units
  where floor_id = v_floor_id
    and is_active = false;

  select count(*)::integer into v_total_unit_count
  from public.units
  where floor_id = v_floor_id;

  if v_active_unit_count <> 2
    or v_inactive_top_floor_units <> 2
    or v_total_unit_count <> 4
  then
    raise exception 'Floor reduction failed. Active %, inactive %, total %',
      v_active_unit_count, v_inactive_top_floor_units, v_total_unit_count;
  end if;

  raise notice '4/9 Floor reduction validated: active %, inactive %, total %',
    v_active_unit_count, v_inactive_top_floor_units, v_total_unit_count;

  insert into public.persons (
    incident_id,
    operational_number,
    current_status_id,
    first_name,
    last_name,
    source,
    created_by,
    updated_by
  )
  values (
    v_incident_id,
    101,
    v_missing_status_id,
    'Validation',
    'Person',
    'Phase 2.1 validation',
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_person_101_id;

  perform public.create_event_log(
    v_incident_id,
    'person_created',
    'Person Created',
    'Created person 101',
    'operational',
    'normal',
    now(),
    null,
    null,
    null,
    v_person_101_id,
    null,
    null,
    null,
    jsonb_build_object('operational_number', 101)
  );

  select u.id into v_unit_id
  from public.units u
  join public.floors f on f.id = u.floor_id
  where u.site_id = v_site_id
    and f.floor_number = 1
    and u.unit_number = '1'
    and u.is_active = true;

  perform public.reassign_person(
    v_person_101_id,
    v_site_id,
    (select floor_id from public.units where id = v_unit_id),
    v_unit_id,
    'Phase 2.1 validation reassignment'
  );

  perform public.update_person_status(
    v_person_101_id,
    v_trapped_status_id,
    now(),
    'validation',
    'Phase 2.1',
    null,
    'Phase 2.1 status update'
  );

  if not exists (
    select 1
    from public.person_status_history
    where person_id = v_person_101_id
      and new_status_id = v_trapped_status_id
  ) then
    raise exception 'Person status history missing for person 101';
  end if;

  raise notice '5/9 Person workflow validated: person 101 %', v_person_101_id;

  insert into public.teams (
    incident_id,
    team_number,
    name,
    commander_name,
    personnel_count,
    status_id,
    created_by,
    updated_by
  )
  values (
    v_incident_id,
    1,
    'Validation Team 1',
    'Commander One',
    6,
    v_team_status_available,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_team_id;

  perform public.create_event_log(
    v_incident_id,
    'team_created',
    'Team Created',
    'Created validation Team 1',
    'operational',
    'normal',
    now(),
    null,
    null,
    null,
    null,
    v_team_id,
    null,
    null,
    jsonb_build_object('team_number', 1)
  );

  insert into public.team_site_assignments (
    incident_id,
    team_id,
    site_id,
    assigned_at,
    assignment_status,
    notes,
    created_by,
    updated_by
  )
  values (
    v_incident_id,
    v_team_id,
    v_site_id,
    now(),
    'active',
    'Phase 2.1 validation assignment',
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_assignment_id;

  update public.teams
  set
    status_id = v_team_status_assigned,
    updated_by = public.current_actor_id()
  where id = v_team_id;

  perform public.create_event_log(
    v_incident_id,
    'team_assigned',
    'Team Assigned',
    'Assigned validation Team 1 to Site 1',
    'assignment',
    'normal',
    now(),
    v_site_id,
    null,
    null,
    null,
    v_team_id,
    null,
    null,
    jsonb_build_object('assignment_id', v_assignment_id)
  );

  raise notice '6/9 Team workflow validated: team %, assignment %', v_team_id, v_assignment_id;

  insert into public.persons (
    incident_id,
    operational_number,
    current_status_id,
    first_name,
    last_name,
    source,
    created_by,
    updated_by
  )
  values (
    v_incident_id,
    901,
    v_missing_status_id,
    'Duplicate',
    'Candidate',
    'Phase 2.1 validation',
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_person_901_id;

  perform public.create_event_log(
    v_incident_id,
    'person_created',
    'Person Created',
    'Created person 901',
    'operational',
    'normal',
    now(),
    null,
    null,
    null,
    v_person_901_id,
    null,
    null,
    null,
    jsonb_build_object('operational_number', 901)
  );

  perform public.merge_persons(
    v_person_101_id,
    v_person_901_id,
    'Phase 2.1 validation merge'
  );

  if not exists (
    select 1
    from public.persons
    where id = v_person_901_id
      and is_merged = true
      and merged_into_person_id = v_person_101_id
      and current_status_id = v_duplicate_status_id
  ) then
    raise exception 'Merge workflow failed for person 901';
  end if;

  raise notice '7/9 Merge workflow validated: 901 -> 101';

  select count(*)::integer into v_event_count
  from public.event_logs
  where incident_id = v_incident_id
    and log_type in (
      'incident_opened',
      'site_created',
      'floor_unit_count_changed',
      'person_created',
      'person_reassigned',
      'person_status_changed',
      'team_created',
      'team_assigned',
      'person_merged'
    );

  if v_event_count < 9 then
    raise exception 'Expected at least 9 key event logs, got %', v_event_count;
  end if;

  raise notice '8/9 Event log workflow validated: % key logs', v_event_count;

  select * into v_dashboard
  from public.incident_dashboard_summary
  where incident_id = v_incident_id;

  if v_dashboard.incident_id is null then
    raise exception 'Incident dashboard summary missing';
  end if;

  if v_dashboard.total_sites <> 1 then
    raise exception 'Expected dashboard total_sites = 1, got %', v_dashboard.total_sites;
  end if;

  if v_dashboard.total_initial_potential <> 60
    or v_dashboard.total_updated_potential <> 60
  then
    raise exception 'Expected dashboard potential 60/60, got %/%',
      v_dashboard.total_initial_potential,
      v_dashboard.total_updated_potential;
  end if;

  if exists (
    select 1
    from public.person_status_counts
    where incident_id = v_incident_id
      and status_key = 'duplicate_cancelled'
  ) then
    raise exception 'Duplicate/cancelled status appears in person_status_counts';
  end if;

  raise notice '9/9 Dashboard views validated: sites %, initial %, updated %, resolved %, gap %',
    v_dashboard.total_sites,
    v_dashboard.total_initial_potential,
    v_dashboard.total_updated_potential,
    v_dashboard.resolved_persons,
    v_dashboard.operational_gap;

  raise notice 'PHASE 2.1 BACKEND VALIDATION PASSED. Incident id: %', v_incident_id;
end;
$$;

select
  i.id as incident_id,
  i.name,
  ids.total_sites,
  ids.total_initial_potential,
  ids.total_updated_potential,
  ids.resolved_persons,
  ids.operational_gap,
  ids.total_teams,
  ids.active_team_site_assignments
from public.incidents i
join public.incident_dashboard_summary ids on ids.incident_id = i.id
where i.name = 'Phase 2.1 Validation Incident'
order by i.created_at desc
limit 1;

select
  log_type,
  count(*) as log_count
from public.event_logs
where incident_id = (
  select id
  from public.incidents
  where name = 'Phase 2.1 Validation Incident'
  order by created_at desc
  limit 1
)
group by log_type
order by log_type;
