-- Validates person creation, reassignment, status update, history, and event logs.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_person_id uuid;
  v_missing_status_id uuid;
  v_trapped_status_id uuid;
  v_created boolean := false;
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

  select id into v_floor_id
  from public.floors
  where site_id = v_site_id
    and floor_number = 1;

  select id into v_unit_id
  from public.units
  where floor_id = v_floor_id
    and unit_number = '1'
    and is_active = true;

  v_missing_status_id := public.get_status_id('person', 'missing', v_incident_id);
  v_trapped_status_id := public.get_status_id('person', 'trapped_located_not_yet_rescued', v_incident_id);

  select id into v_person_id
  from public.persons
  where incident_id = v_incident_id
    and operational_number = 101;

  if v_person_id is null then
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
      'Phase 2 backend validation',
      public.current_actor_id(),
      public.current_actor_id()
    )
    returning id into v_person_id;

    v_created := true;

    perform public.create_event_log(
      v_incident_id,
      'person_created',
      'Person Created',
      'Created person 101 for Phase 2 validation',
      'operational',
      'normal',
      now(),
      null,
      null,
      null,
      v_person_id,
      null,
      null,
      null,
      jsonb_build_object('operational_number', 101)
    );
  end if;

  perform public.reassign_person(
    v_person_id,
    v_site_id,
    v_floor_id,
    v_unit_id,
    'Phase 2 validation reassignment'
  );

  perform public.update_person_status(
    v_person_id,
    v_trapped_status_id,
    now(),
    'test',
    'Phase 2 validation',
    null,
    'Phase 2 validation status update'
  );

  if not exists (
    select 1
    from public.person_status_history
    where person_id = v_person_id
      and new_status_id = v_trapped_status_id
  ) then
    raise exception 'Person status history was not created';
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and person_id = v_person_id
      and log_type = 'person_reassigned'
  ) then
    raise exception 'Person reassignment event log was not created';
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and person_id = v_person_id
      and log_type = 'person_status_changed'
  ) then
    raise exception 'Person status changed event log was not created';
  end if;

  raise notice 'Person 101 workflow validated. Created this run: %', v_created;
end;
$$;

select
  operational_number,
  site_id,
  floor_id,
  unit_id,
  current_status_id,
  is_merged
from public.persons
where operational_number = 101
order by created_at desc
limit 1;
