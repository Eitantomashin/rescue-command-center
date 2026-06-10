-- Validates create_site_with_structure(), floor generation, unit generation, and potential calculations.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_site_id uuid;
  v_floor_count integer;
  v_unit_count integer;
  v_initial_potential integer;
  v_updated_potential integer;
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

  if v_incident_id is null then
    raise exception 'Run 01_incident_creation.sql first';
  end if;

  select id into v_site_id
  from public.sites
  where incident_id = v_incident_id
    and site_number = 1;

  if v_site_id is null then
    v_site_id := public.create_site_with_structure(
      v_incident_id,
      1,
      'Validation Street',
      '10',
      3,
      4,
      'Validation Site 1',
      'Test City',
      5,
      0,
      null,
      null
    );
  end if;

  select count(*)::integer into v_floor_count
  from public.floors
  where site_id = v_site_id
    and is_active = true;

  select count(*)::integer into v_unit_count
  from public.units
  where site_id = v_site_id
    and is_active = true;

  select initial_potential, updated_potential
  into v_initial_potential, v_updated_potential
  from public.sites
  where id = v_site_id;

  if v_floor_count <> 3 then
    raise exception 'Expected 3 active floors, got %', v_floor_count;
  end if;

  if v_unit_count <> 12 then
    raise exception 'Expected 12 active units, got %', v_unit_count;
  end if;

  if v_initial_potential <> 60 or v_updated_potential <> 60 then
    raise exception 'Expected potential 60/60, got %/%', v_initial_potential, v_updated_potential;
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and site_id = v_site_id
      and log_type = 'site_created'
  ) then
    raise exception 'Site created event log was not found';
  end if;

  raise notice 'Site %, floors %, active units %, potential %/%',
    v_site_id, v_floor_count, v_unit_count, v_initial_potential, v_updated_potential;
end;
$$;

select *
from public.site_dashboard_summary
where site_number = 1
order by site_id desc
limit 1;
