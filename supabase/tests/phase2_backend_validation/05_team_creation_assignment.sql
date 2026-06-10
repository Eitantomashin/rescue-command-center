-- Validates team creation, team assignment, and assignment event log.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_site_id uuid;
  v_team_status_available uuid;
  v_team_status_assigned uuid;
  v_team_id uuid;
  v_assignment_id uuid;
begin
  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '')::uuid;
  if v_test_user_id is null then
    raise exception 'Run 00_SET_TEST_CONTEXT.sql first';
  end if;

  perform set_config('rcc.sql_editor_validation_mode', 'on', true);
  perform set_config('rcc.test_user_id', v_test_user_id::text, true);

  select id into v_incident_id
  from public.incidents
  where name = 'Phase 2 Validation Incident'
  order by created_at desc
  limit 1;

  select id into v_site_id
  from public.sites
  where incident_id = v_incident_id
    and site_number = 1;

  v_team_status_available := public.get_status_id('team', 'available', v_incident_id);
  v_team_status_assigned := public.get_status_id('team', 'assigned', v_incident_id);

  select id into v_team_id
  from public.teams
  where incident_id = v_incident_id
    and team_number = 1;

  if v_team_id is null then
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
      'Created Team 1 for Phase 2 validation',
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
  end if;

  select id into v_assignment_id
  from public.team_site_assignments
  where incident_id = v_incident_id
    and team_id = v_team_id
    and site_id = v_site_id
    and assignment_status = 'active';

  if v_assignment_id is null then
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
      'Phase 2 validation assignment',
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
      'Assigned Team 1 to Site 1 for Phase 2 validation',
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
      jsonb_build_object('assignment_id', v_assignment_id, 'team_number', 1)
    );
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and team_id = v_team_id
      and log_type = 'team_assigned'
  ) then
    raise exception 'Team assigned event log was not created';
  end if;

  raise notice 'Team assignment validated: team %, assignment %', v_team_id, v_assignment_id;
end;
$$;

select *
from public.team_site_assignments
order by created_at desc
limit 5;
