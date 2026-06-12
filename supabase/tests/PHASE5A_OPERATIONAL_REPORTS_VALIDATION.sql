-- Phase 5A operational reports validation.
-- Run with a user/context that can write to the selected incident.
-- In Supabase SQL Editor, enable the Phase 2.2 validation context first.
--
-- This script appends one operational number, two reports, status history, and event logs.
-- It does not update, rewrite, or delete existing event_logs.

do $$
declare
  v_incident_id uuid;
  v_site_id uuid;
  v_missing_status_id uuid;
  v_second_status_id uuid;
  v_team_number integer := 9;
  v_sequence integer;
  v_operational_number integer;
  v_person_id uuid;
  v_report_id uuid;
  v_latest_record record;
  v_history_count integer;
  v_number_event_count integer;
  v_report_event_count integer;
  v_direct_insert_blocked boolean := false;
begin
  select s.incident_id, s.id
    into v_incident_id, v_site_id
  from public.sites s
  join public.incidents i on i.id = s.incident_id
  where i.is_closed = false
  order by s.created_at desc
  limit 1;

  if v_incident_id is null or v_site_id is null then
    raise exception 'Validation failed: no open incident/site found';
  end if;

  select st.id into v_missing_status_id
  from public.status_types st
  where st.category = 'person'
    and st.status_key = 'missing'
    and st.is_active = true
    and (st.incident_id = v_incident_id or st.incident_id is null)
  order by st.incident_id is null
  limit 1;

  if v_missing_status_id is null then
    raise exception 'Validation failed: missing person status was not found';
  end if;

  select st.id into v_second_status_id
  from public.status_types st
  where st.category = 'person'
    and st.status_key in ('rescued', 'trapped_located_not_yet_rescued', 'evacuated', 'resolved')
    and st.is_active = true
    and (st.incident_id = v_incident_id or st.incident_id is null)
  order by
    case st.status_key
      when 'rescued' then 1
      when 'trapped_located_not_yet_rescued' then 2
      when 'evacuated' then 3
      else 4
    end,
    st.incident_id is null
  limit 1;

  if v_second_status_id is null then
    raise exception 'Validation failed: no second person status was found';
  end if;

  select coalesce(max(public.operational_number_sequence(p.operational_number)), 0) + 1
    into v_sequence
  from public.persons p
  where p.incident_id = v_incident_id
    and public.operational_number_team_number(p.operational_number) = v_team_number;

  if v_sequence > 99 then
    raise exception 'Validation failed: no remaining team 9 operational number slots';
  end if;

  v_operational_number := v_team_number * 100 + v_sequence;

  v_person_id := public.create_operational_number(
    v_incident_id,
    v_site_id,
    v_team_number,
    v_operational_number,
    v_missing_status_id,
    null,
    null,
    'Phase 5A validation initial report',
    'חפ"ק',
    'PHASE5A_OPERATIONAL_REPORTS_VALIDATION',
    null,
    'A3',
    'לא ידוע',
    now() - interval '5 minutes'
  );

  if v_person_id is null then
    raise exception 'Validation failed: create_operational_number returned null';
  end if;

  v_report_id := public.create_operational_report(
    v_person_id,
    v_second_status_id,
    'מחלצים',
    'צוות 9',
    null,
    'A3',
    'גבוהה',
    'Phase 5A validation second report',
    now()
  );

  if v_report_id is null then
    raise exception 'Validation failed: create_operational_report returned null';
  end if;

  select *
    into v_latest_record
  from public.operational_numbers_dashboard ond
  where ond.person_id = v_person_id;

  if v_latest_record.person_id is null then
    raise exception 'Validation failed: operational_numbers_dashboard did not return the new person';
  end if;

  if v_latest_record.latest_report_id <> v_report_id then
    raise exception 'Validation failed: dashboard latest report is %, expected %',
      v_latest_record.latest_report_id,
      v_report_id;
  end if;

  if v_latest_record.current_status_id <> v_second_status_id then
    raise exception 'Validation failed: current status was not updated from latest report';
  end if;

  select count(*)::integer
    into v_history_count
  from public.operational_report_history orh
  where orh.person_id = v_person_id;

  if v_history_count <> 2 then
    raise exception 'Validation failed: expected 2 report history rows, found %', v_history_count;
  end if;

  select count(*)::integer
    into v_number_event_count
  from public.event_logs el
  where el.incident_id = v_incident_id
    and el.person_id = v_person_id
    and el.log_type = 'operational_number_created'
    and el.title = 'יצירת מספר מבצעי'
    and el.metadata->>'person_id' = v_person_id::text
    and (el.metadata->>'operational_number')::integer = v_operational_number
    and el.metadata ? 'report_id'
    and el.metadata ? 'status_id'
    and el.metadata ? 'information_source_type'
    and el.metadata ? 'source_name'
    and el.metadata ? 'grid_cell'
    and el.metadata ? 'confidence_level';

  if v_number_event_count = 0 then
    raise exception 'Validation failed: operational_number_created EventLog was not written with required metadata';
  end if;

  select count(*)::integer
    into v_report_event_count
  from public.event_logs el
  where el.incident_id = v_incident_id
    and el.person_id = v_person_id
    and el.log_type = 'operational_report_created'
    and el.title = 'דיווח מבצעי חדש'
    and el.metadata->>'person_id' = v_person_id::text
    and (el.metadata->>'operational_number')::integer = v_operational_number
    and el.metadata->>'report_id' = v_report_id::text
    and el.metadata ? 'status_id'
    and el.metadata ? 'information_source_type'
    and el.metadata ? 'source_name'
    and el.metadata ? 'grid_cell'
    and el.metadata ? 'confidence_level';

  if v_report_event_count = 0 then
    raise exception 'Validation failed: operational_report_created EventLog was not written with required metadata';
  end if;

  begin
    insert into public.operational_reports (
      incident_id,
      site_id,
      person_id,
      status_id,
      information_source_type,
      confidence_level,
      notes
    )
    values (
      v_incident_id,
      v_site_id,
      v_person_id,
      v_second_status_id,
      'חפ"ק',
      'לא ידוע',
      'This direct insert must be blocked'
    );
  exception
    when others then
      v_direct_insert_blocked := true;
  end;

  if not v_direct_insert_blocked then
    raise exception 'Validation failed: direct operational_reports insert was not blocked';
  end if;
end $$;

select
  person_id,
  operational_number,
  team_number,
  sequence_number,
  latest_report_status_label,
  latest_source_type,
  latest_source_name,
  latest_grid_cell,
  latest_confidence_level,
  latest_notes,
  latest_reported_at
from public.operational_numbers_dashboard
order by latest_reported_at desc nulls last
limit 10;

select
  operational_number,
  status_label,
  information_source_type,
  information_source_name,
  grid_cell,
  confidence_level,
  notes,
  reported_at
from public.operational_report_history
order by reported_at desc, created_at desc
limit 10;

select
  log_type,
  title,
  description,
  metadata
from public.event_logs
where log_type in ('operational_number_created', 'operational_report_created')
order by created_at desc
limit 10;
