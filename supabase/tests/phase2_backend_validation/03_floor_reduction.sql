-- Validates reducing a floor unit count without deleting units.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_site_id uuid;
  v_floor_id uuid;
  v_active_units integer;
  v_inactive_units integer;
  v_total_units integer;
begin
  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '')::uuid;
  if v_test_user_id is null then
    raise exception 'Run 00_SET_TEST_CONTEXT.sql first';
  end if;

  perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);

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
    and floor_number = 3;

  if v_floor_id is null then
    raise exception 'Run 02_site_floor_unit_generation.sql first';
  end if;

  perform public.set_floor_unit_count(
    v_floor_id,
    2,
    'Phase 2 validation: reduce top floor to actual layout'
  );

  select count(*)::integer into v_active_units
  from public.units
  where floor_id = v_floor_id
    and is_active = true;

  select count(*)::integer into v_inactive_units
  from public.units
  where floor_id = v_floor_id
    and is_active = false;

  select count(*)::integer into v_total_units
  from public.units
  where floor_id = v_floor_id;

  if v_active_units <> 2 then
    raise exception 'Expected 2 active units on floor 3, got %', v_active_units;
  end if;

  if v_inactive_units <> 2 or v_total_units <> 4 then
    raise exception 'Expected 2 inactive and 4 total units on floor 3, got inactive %, total %',
      v_inactive_units, v_total_units;
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and floor_id = v_floor_id
      and log_type = 'floor_unit_count_changed'
  ) then
    raise exception 'Floor unit count changed event log was not found';
  end if;

  raise notice 'Floor 3 reduction validated: active %, inactive %, total %',
    v_active_units, v_inactive_units, v_total_units;
end;
$$;
