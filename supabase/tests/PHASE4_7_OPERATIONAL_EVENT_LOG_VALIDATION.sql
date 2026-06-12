-- Phase 4.7 operational EventLog validation.
-- Run with a user/context that can write to the selected incident.
-- This script appends new event_logs rows; it does not modify old event logs.

do $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_resident public.unit_residents%rowtype;
  v_resident_new_status_id uuid;
  v_resident_event_count integer;
  v_person public.persons%rowtype;
  v_person_new_status_id uuid;
  v_person_event_count integer;
  v_operational_number integer;
begin
  select * into v_resident
  from public.unit_residents
  where is_active = true
  order by created_at
  limit 1;

  if not found then
    raise exception 'Validation failed: no active resident found';
  end if;

  select st.id into v_resident_new_status_id
  from public.status_types st
  where st.category = 'resident'
    and st.status_key = case
      when exists (
        select 1
        from public.status_types current_status
        where current_status.id = v_resident.status_id
          and current_status.status_key = 'rescued'
      )
      then 'missing'
      else 'rescued'
    end
    and st.is_active = true
    and (st.incident_id = v_resident.incident_id or st.incident_id is null)
  order by st.incident_id is null
  limit 1;

  if v_resident_new_status_id is null then
    raise exception 'Validation failed: resident validation status is missing';
  end if;

  perform public.update_unit_resident(
    v_resident.id,
    v_resident.first_name,
    v_resident.last_name,
    v_resident.age,
    v_resident.phone,
    v_resident_new_status_id,
    v_resident.notes
  );

  select count(*)::integer into v_resident_event_count
  from public.event_logs el
  where el.incident_id = v_resident.incident_id
    and el.log_type = 'resident_status_changed'
    and el.created_at >= v_started_at
    and el.metadata->>'resident_id' = v_resident.id::text
    and el.metadata ? 'old_status_id'
    and el.metadata ? 'new_status_id'
    and el.metadata ? 'old_status_label'
    and el.metadata ? 'new_status_label'
    and el.metadata ? 'old_status_key'
    and el.metadata ? 'new_status_key';

  if v_resident_event_count = 0 then
    raise exception 'Validation failed: resident_status_changed event was not written';
  end if;

  if v_resident.linked_person_id is not null then
    select * into v_person
    from public.persons
    where id = v_resident.linked_person_id;
  else
    select coalesce(max(p.operational_number), 9000) + 1
    into v_operational_number
    from public.persons p
    where p.incident_id = v_resident.incident_id;

    perform public.link_operational_number_to_resident(
      v_resident.id,
      v_operational_number,
      'Phase 4.7 validation'
    );

    select p.* into v_person
    from public.persons p
    join public.unit_residents ur on ur.linked_person_id = p.id
    where ur.id = v_resident.id;
  end if;

  if v_person.id is null then
    raise exception 'Validation failed: operational person could not be selected or created';
  end if;

  select st.id into v_person_new_status_id
  from public.status_types st
  where st.category = 'person'
    and st.status_key = case
      when exists (
        select 1
        from public.status_types current_status
        where current_status.id = v_person.current_status_id
          and current_status.status_key = 'trapped_located_not_yet_rescued'
      )
      then 'missing'
      else 'trapped_located_not_yet_rescued'
    end
    and st.is_active = true
    and (st.incident_id = v_person.incident_id or st.incident_id is null)
  order by st.incident_id is null
  limit 1;

  if v_person_new_status_id is null then
    raise exception 'Validation failed: person validation status is missing';
  end if;

  perform public.update_person_status(
    v_person.id,
    v_person_new_status_id,
    now(),
    'validation',
    'PHASE4_7_OPERATIONAL_EVENT_LOG_VALIDATION',
    null,
    'Phase 4.7 validation'
  );

  select count(*)::integer into v_person_event_count
  from public.event_logs el
  where el.incident_id = v_person.incident_id
    and el.log_type = 'person_status_changed'
    and el.created_at >= v_started_at
    and el.person_id = v_person.id
    and el.metadata->>'person_id' = v_person.id::text
    and el.metadata ? 'linked_resident_id'
    and el.metadata ? 'old_status_id'
    and el.metadata ? 'new_status_id'
    and el.metadata ? 'old_status_label'
    and el.metadata ? 'new_status_label'
    and el.metadata ? 'old_status_key'
    and el.metadata ? 'new_status_key';

  if v_person_event_count = 0 then
    raise exception 'Validation failed: person_status_changed event was not written';
  end if;
end $$;

select
  log_type,
  title,
  description,
  metadata
from public.event_logs
where log_type in ('resident_status_changed', 'person_status_changed')
order by created_at desc
limit 10;
