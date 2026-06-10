-- Validates merge_persons(), dashboard counts, and event log coverage.

do $$
declare
  v_test_user_id uuid;
  v_incident_id uuid;
  v_primary_person_id uuid;
  v_merged_person_id uuid;
  v_missing_status_id uuid;
  v_merge_id uuid;
  v_duplicate_status_id uuid;
  v_dashboard record;
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

  select id into v_primary_person_id
  from public.persons
  where incident_id = v_incident_id
    and operational_number = 101;

  if v_primary_person_id is null then
    raise exception 'Run 04_person_workflow.sql first';
  end if;

  v_missing_status_id := public.get_status_id('person', 'missing', v_incident_id);
  v_duplicate_status_id := public.get_status_id('person', 'duplicate_cancelled', v_incident_id);

  select id into v_merged_person_id
  from public.persons
  where incident_id = v_incident_id
    and operational_number = 901;

  if v_merged_person_id is null then
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
      'Phase 2 backend validation',
      auth.uid(),
      auth.uid()
    )
    returning id into v_merged_person_id;

    perform public.create_event_log(
      v_incident_id,
      'person_created',
      'Person Created',
      'Created person 901 for merge validation',
      'operational',
      'normal',
      now(),
      null,
      null,
      null,
      v_merged_person_id,
      null,
      null,
      null,
      jsonb_build_object('operational_number', 901)
    );
  end if;

  if not exists (
    select 1
    from public.person_merges
    where incident_id = v_incident_id
      and primary_person_id = v_primary_person_id
      and merged_person_id = v_merged_person_id
  ) then
    v_merge_id := public.merge_persons(
      v_primary_person_id,
      v_merged_person_id,
      'Phase 2 validation duplicate merge'
    );
  end if;

  if not exists (
    select 1
    from public.persons
    where id = v_merged_person_id
      and is_merged = true
      and merged_into_person_id = v_primary_person_id
      and current_status_id = v_duplicate_status_id
  ) then
    raise exception 'Merged person 901 was not marked as merged duplicate/cancelled';
  end if;

  if not exists (
    select 1
    from public.event_logs
    where incident_id = v_incident_id
      and log_type = 'person_merged'
  ) then
    raise exception 'Person merge event log was not created';
  end if;

  select * into v_dashboard
  from public.incident_dashboard_summary
  where incident_id = v_incident_id;

  if v_dashboard.incident_id is null then
    raise exception 'Incident dashboard row was not found';
  end if;

  if exists (
    select 1
    from public.person_status_counts
    where incident_id = v_incident_id
      and status_key = 'duplicate_cancelled'
  ) then
    raise exception 'Duplicate/cancelled persons should not appear in person_status_counts';
  end if;

  raise notice 'Dashboard validated: initial %, updated %, resolved %, gap %',
    v_dashboard.total_initial_potential,
    v_dashboard.total_updated_potential,
    v_dashboard.resolved_persons,
    v_dashboard.operational_gap;
end;
$$;

select *
from public.incident_dashboard_summary
where name = 'Phase 2 Validation Incident'
order by opened_at desc
limit 1;

select
  log_type,
  count(*) as count
from public.event_logs
where incident_id = (
  select id
  from public.incidents
  where name = 'Phase 2 Validation Incident'
  order by created_at desc
  limit 1
)
group by log_type
order by log_type;
