-- Phase 4 resident-potential validation.
-- Run after applying all Phase 4 migrations.

do $$
declare
  v_units_below_min integer;
  v_missing_resident_statuses text[];
  v_site_mismatches integer;
  v_incident_mismatches integer;
begin
  select count(*)::integer
  into v_units_below_min
  from (
    select
      u.id,
      count(ur.id) filter (where ur.is_active = true) as active_residents
    from public.units u
    left join public.unit_residents ur on ur.unit_id = u.id
    group by u.id
    having count(ur.id) filter (where ur.is_active = true) < 5
  ) units_missing_placeholders;

  if v_units_below_min > 0 then
    raise exception 'Validation failed: % units have fewer than 5 active residents', v_units_below_min;
  end if;

  select array_agg(required_status.status_key order by required_status.status_key)
  into v_missing_resident_statuses
  from (
    values
      ('missing'),
      ('unknown'),
      ('general'),
      ('in_progress'),
      ('trapped_located_not_yet_rescued'),
      ('rescued'),
      ('evacuated_to_napal'),
      ('evacuated_from_site'),
      ('deceased_evacuated'),
      ('evacuated'),
      ('located_outside_site'),
      ('resolved')
  ) as required_status(status_key)
  where not exists (
    select 1
    from public.status_types st
    where st.category = 'resident'
      and st.status_key = required_status.status_key
      and st.is_active = true
  );

  if coalesce(array_length(v_missing_resident_statuses, 1), 0) > 0 then
    raise exception 'Validation failed: missing resident statuses %', v_missing_resident_statuses;
  end if;

  select count(*)::integer
  into v_site_mismatches
  from public.site_dashboard_summary sds
  join (
    select
      ur.site_id,
      count(*) filter (where ur.is_active = true)::integer as active_resident_rows
    from public.unit_residents ur
    group by ur.site_id
  ) actual on actual.site_id = sds.site_id
  where sds.updated_potential <> actual.active_resident_rows;

  if v_site_mismatches > 0 then
    raise exception 'Validation failed: % site dashboard rows have updated_potential mismatches', v_site_mismatches;
  end if;

  select count(*)::integer
  into v_incident_mismatches
  from public.incident_dashboard_summary ids
  join (
    select
      ur.incident_id,
      count(*) filter (where ur.is_active = true)::integer as active_resident_rows
    from public.unit_residents ur
    group by ur.incident_id
  ) actual on actual.incident_id = ids.incident_id
  where ids.updated_potential <> actual.active_resident_rows
    or ids.total_updated_potential <> actual.active_resident_rows;

  if v_incident_mismatches > 0 then
    raise exception 'Validation failed: % incident dashboard rows have updated_potential mismatches', v_incident_mismatches;
  end if;
end $$;

select
  'phase4_resident_potential_validation_passed' as result,
  count(distinct u.id) as units_checked,
  count(ur.id) filter (where ur.is_active = true) as active_resident_rows
from public.units u
left join public.unit_residents ur on ur.unit_id = u.id;
