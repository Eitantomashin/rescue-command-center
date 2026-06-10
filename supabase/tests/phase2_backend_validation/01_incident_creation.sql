-- Validates incident creation.

do $$
declare
  v_test_user_id uuid;
  v_status_id uuid;
  v_incident_id uuid;
begin
  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '')::uuid;
  if v_test_user_id is null then
    raise exception 'Run 00_SET_TEST_CONTEXT.sql first';
  end if;

  perform set_config('request.jwt.claim.sub', v_test_user_id::text, true);

  select public.get_status_id('incident', 'active', null)
  into v_status_id;

  if v_status_id is null then
    raise exception 'Missing global incident.active status';
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
    'Phase 2 Validation Incident',
    'Test City',
    'Backend Validation Address',
    now(),
    v_status_id,
    auth.uid(),
    auth.uid()
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
    auth.uid(),
    'incident_commander',
    auth.uid()
  )
  on conflict (incident_id, user_id) do nothing;

  perform public.create_event_log(
    v_incident_id,
    'incident_opened',
    'Incident Opened',
    'Phase 2 validation incident created',
    'administrative',
    'normal'
  );

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and log_type = 'incident_opened'
  ) then
    raise exception 'Incident opened event log was not created';
  end if;

  raise notice 'Created validation incident: %', v_incident_id;
end;
$$;

select *
from public.incidents
where name = 'Phase 2 Validation Incident'
order by created_at desc
limit 1;
