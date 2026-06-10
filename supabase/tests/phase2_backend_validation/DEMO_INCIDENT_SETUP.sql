-- Demo incident setup for manual backend validation.
--
-- Run 00_SET_TEST_CONTEXT.sql first and set rcc.test_user_id to a real user.
-- This script is non-destructive. If "Demo Rescue Event" already exists, it reuses the latest one.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_site_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_unit_1_1 uuid;
  v_unit_2_2 uuid;
  v_unit_4_3 uuid;
  v_incident_status_id uuid;
  v_team_status_available uuid;
  v_resident_status_unknown uuid;
begin
  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '')::uuid;
  if v_test_user_id is null then
    raise exception 'Run 00_SET_TEST_CONTEXT.sql first';
  end if;

  perform set_config('rcc.sql_editor_validation_mode', 'on', true);
  perform set_config('rcc.test_user_id', v_test_user_id::text, true);

  v_incident_status_id := public.get_status_id('incident', 'active', null);
  v_team_status_available := public.get_status_id('team', 'available', null);
  v_resident_status_unknown := public.get_status_id('resident', 'unknown', null);

  select id into v_incident_id
  from public.incidents
  where name = 'Demo Rescue Event'
  order by created_at desc
  limit 1;

  if v_incident_id is null then
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
      'Demo Rescue Event',
      'Demo City',
      'Demo Street 1',
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
      'Demo Rescue Event created',
      'administrative',
      'normal'
    );
  end if;

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

  select id into v_site_id
  from public.sites
  where incident_id = v_incident_id
    and site_number = 1;

  if v_site_id is null then
    v_site_id := public.create_site_with_structure(
      v_incident_id,
      1,
      'Demo Street',
      '1',
      5,
      4,
      'Site 1',
      'Demo City',
      5,
      0,
      null,
      null
    );
  end if;

  select id into v_team1_id
  from public.teams
  where incident_id = v_incident_id
    and team_number = 1;

  if v_team1_id is null then
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
      'Team 1',
      'Commander 1',
      6,
      v_team_status_available,
      public.current_actor_id(),
      public.current_actor_id()
    )
    returning id into v_team1_id;

    perform public.create_event_log(
      v_incident_id,
      'team_created',
      'Team Created',
      'Demo Team 1 created',
      'operational',
      'normal',
      now(),
      null,
      null,
      null,
      null,
      v_team1_id,
      null,
      null,
      jsonb_build_object('team_number', 1)
    );
  end if;

  select id into v_team2_id
  from public.teams
  where incident_id = v_incident_id
    and team_number = 2;

  if v_team2_id is null then
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
      2,
      'Team 2',
      'Commander 2',
      5,
      v_team_status_available,
      public.current_actor_id(),
      public.current_actor_id()
    )
    returning id into v_team2_id;

    perform public.create_event_log(
      v_incident_id,
      'team_created',
      'Team Created',
      'Demo Team 2 created',
      'operational',
      'normal',
      now(),
      null,
      null,
      null,
      null,
      v_team2_id,
      null,
      null,
      jsonb_build_object('team_number', 2)
    );
  end if;

  select u.id into v_unit_1_1
  from public.units u
  join public.floors f on f.id = u.floor_id
  where u.site_id = v_site_id
    and f.floor_number = 1
    and u.unit_number = '1';

  select u.id into v_unit_2_2
  from public.units u
  join public.floors f on f.id = u.floor_id
  where u.site_id = v_site_id
    and f.floor_number = 2
    and u.unit_number = '2';

  select u.id into v_unit_4_3
  from public.units u
  join public.floors f on f.id = u.floor_id
  where u.site_id = v_site_id
    and f.floor_number = 4
    and u.unit_number = '3';

  if not exists (
    select 1 from public.unit_residents
    where unit_id = v_unit_1_1 and first_name = 'Noa' and last_name = 'Levi'
  ) then
    insert into public.unit_residents (
      incident_id,
      unit_id,
      first_name,
      last_name,
      age,
      phone,
      status_id,
      notes,
      created_by,
      updated_by
    )
    values
      (v_incident_id, v_unit_1_1, 'Noa', 'Levi', 34, '050-0000001', v_resident_status_unknown, 'Demo resident', public.current_actor_id(), public.current_actor_id()),
      (v_incident_id, v_unit_1_1, 'Amit', 'Levi', 8, null, v_resident_status_unknown, 'Demo resident', public.current_actor_id(), public.current_actor_id()),
      (v_incident_id, v_unit_2_2, 'Daniel', 'Cohen', 42, '050-0000002', v_resident_status_unknown, 'Demo resident', public.current_actor_id(), public.current_actor_id()),
      (v_incident_id, v_unit_4_3, 'Maya', 'Mizrahi', 29, '050-0000003', v_resident_status_unknown, 'Demo resident', public.current_actor_id(), public.current_actor_id());
  end if;

  raise notice 'Demo Rescue Event ready. Incident %, Site %, Team1 %, Team2 %',
    v_incident_id, v_site_id, v_team1_id, v_team2_id;
end;
$$;

select *
from public.incident_dashboard_summary
where name = 'Demo Rescue Event'
order by opened_at desc
limit 1;

select
  f.floor_number,
  count(u.id) filter (where u.is_active = true) as active_units,
  count(u.id) as total_units
from public.floors f
join public.units u on u.floor_id = f.id
where f.site_id = (
  select id
  from public.sites
  where site_number = 1
    and incident_id = (
      select id
      from public.incidents
      where name = 'Demo Rescue Event'
      order by created_at desc
      limit 1
    )
  limit 1
)
group by f.floor_number
order by f.floor_number;
