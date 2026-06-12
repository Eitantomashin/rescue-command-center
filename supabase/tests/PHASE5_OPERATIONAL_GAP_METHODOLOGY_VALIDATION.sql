-- Phase 5 operational gap methodology validation.
--
-- Validates:
-- 1. updated_potential comes only from active resident rows.
-- 2. active operational numbers reduce operational_gap.
-- 3. merged/duplicate operational numbers are not counted.
-- 4. operational_gap never goes below 0.
-- 5. status distribution columns sum to active operational numbers.

do $$
declare
  v_site_potential_mismatches integer;
  v_incident_potential_mismatches integer;
  v_site_gap_mismatches integer;
  v_incident_gap_mismatches integer;
  v_site_distribution_mismatches integer;
  v_incident_distribution_mismatches integer;
  v_negative_gaps integer;
  v_dashboard_group_mismatches integer;
begin
  with actual as (
    select
      ur.site_id,
      count(*) filter (where ur.is_active = true)::integer as active_resident_rows
    from public.unit_residents ur
    group by ur.site_id
  )
  select count(*)::integer
    into v_site_potential_mismatches
  from public.site_dashboard_summary sds
  left join actual on actual.site_id = sds.site_id
  where sds.updated_potential <> coalesce(actual.active_resident_rows, 0);

  if v_site_potential_mismatches > 0 then
    raise exception 'Validation failed: % site dashboard rows have updated_potential mismatches',
      v_site_potential_mismatches;
  end if;

  with actual as (
    select
      ur.incident_id,
      count(*) filter (where ur.is_active = true)::integer as active_resident_rows
    from public.unit_residents ur
    group by ur.incident_id
  )
  select count(*)::integer
    into v_incident_potential_mismatches
  from public.incident_dashboard_summary ids
  left join actual on actual.incident_id = ids.incident_id
  where ids.updated_potential <> coalesce(actual.active_resident_rows, 0)
     or ids.total_updated_potential <> coalesce(actual.active_resident_rows, 0);

  if v_incident_potential_mismatches > 0 then
    raise exception 'Validation failed: % incident dashboard rows have updated_potential mismatches',
      v_incident_potential_mismatches;
  end if;

  with actual as (
    select
      p.site_id,
      count(*)::integer as active_operational_numbers_count
    from public.persons p
    join public.status_types st on st.id = p.current_status_id
    where p.site_id is not null
      and p.is_merged = false
      and st.status_key <> 'duplicate_cancelled'
    group by p.site_id
  )
  select count(*)::integer
    into v_site_gap_mismatches
  from public.site_dashboard_summary sds
  left join actual on actual.site_id = sds.site_id
  where sds.active_operational_numbers_count <> coalesce(actual.active_operational_numbers_count, 0)
     or sds.gap_resolved_count <> coalesce(actual.active_operational_numbers_count, 0)
     or sds.operational_gap <> greatest(
       sds.updated_potential - coalesce(actual.active_operational_numbers_count, 0),
       0
     );

  if v_site_gap_mismatches > 0 then
    raise exception 'Validation failed: % site dashboard rows have operational gap/count mismatches',
      v_site_gap_mismatches;
  end if;

  with actual as (
    select
      p.incident_id,
      count(*)::integer as active_operational_numbers_count
    from public.persons p
    join public.status_types st on st.id = p.current_status_id
    where p.is_merged = false
      and st.status_key <> 'duplicate_cancelled'
    group by p.incident_id
  )
  select count(*)::integer
    into v_incident_gap_mismatches
  from public.incident_dashboard_summary ids
  left join actual on actual.incident_id = ids.incident_id
  where ids.active_operational_numbers_count <> coalesce(actual.active_operational_numbers_count, 0)
     or ids.gap_resolved_count <> coalesce(actual.active_operational_numbers_count, 0)
     or ids.operational_gap <> greatest(
       ids.updated_potential - coalesce(actual.active_operational_numbers_count, 0),
       0
     );

  if v_incident_gap_mismatches > 0 then
    raise exception 'Validation failed: % incident dashboard rows have operational gap/count mismatches',
      v_incident_gap_mismatches;
  end if;

  select count(*)::integer
    into v_negative_gaps
  from (
    select operational_gap from public.site_dashboard_summary
    union all
    select operational_gap from public.incident_dashboard_summary
  ) gaps
  where operational_gap < 0;

  if v_negative_gaps > 0 then
    raise exception 'Validation failed: % dashboard rows have negative operational_gap', v_negative_gaps;
  end if;

  select count(*)::integer
    into v_site_distribution_mismatches
  from public.site_dashboard_summary sds
  where sds.active_operational_numbers_count <> (
    sds.operational_numbers_missing_unknown_count
    + sds.operational_numbers_trapped_located_count
    + sds.operational_numbers_rescued_count
    + sds.operational_numbers_evacuated_count
    + sds.operational_numbers_located_outside_site_count
    + sds.operational_numbers_deceased_count
    + sds.operational_numbers_other_count
  );

  if v_site_distribution_mismatches > 0 then
    raise exception 'Validation failed: % site dashboard rows have status distribution mismatches',
      v_site_distribution_mismatches;
  end if;

  select count(*)::integer
    into v_incident_distribution_mismatches
  from public.incident_dashboard_summary ids
  where ids.active_operational_numbers_count <> (
    ids.operational_numbers_missing_unknown_count
    + ids.operational_numbers_trapped_located_count
    + ids.operational_numbers_rescued_count
    + ids.operational_numbers_evacuated_count
    + ids.operational_numbers_located_outside_site_count
    + ids.operational_numbers_deceased_count
    + ids.operational_numbers_other_count
  );

  if v_incident_distribution_mismatches > 0 then
    raise exception 'Validation failed: % incident dashboard rows have status distribution mismatches',
      v_incident_distribution_mismatches;
  end if;

  select count(*)::integer
    into v_dashboard_group_mismatches
  from public.operational_numbers_dashboard ond
  where ond.is_merged = false
    and (
      ond.dashboard_status_group is null
      or ond.dashboard_status_label is null
      or ond.dashboard_card_color not in ('blue', 'orange', 'green', 'red')
    );

  if v_dashboard_group_mismatches > 0 then
    raise exception 'Validation failed: % operational number dashboard rows have invalid dashboard status metadata',
      v_dashboard_group_mismatches;
  end if;
end $$;

select
  'phase5_operational_gap_methodology_validation_passed' as result,
  count(*) as sites_checked,
  sum(updated_potential) as total_updated_potential,
  sum(active_operational_numbers_count) as total_active_operational_numbers,
  sum(operational_gap) as total_operational_gap
from public.site_dashboard_summary;

select
  incident_id,
  updated_potential,
  active_operational_numbers_count,
  unassigned_operational_numbers_count,
  operational_gap,
  operational_numbers_missing_unknown_count,
  operational_numbers_trapped_located_count,
  operational_numbers_rescued_count,
  operational_numbers_evacuated_count,
  operational_numbers_located_outside_site_count,
  operational_numbers_deceased_count,
  operational_numbers_other_count
from public.incident_dashboard_summary
order by opened_at desc
limit 10;
