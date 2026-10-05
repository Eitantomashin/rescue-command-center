-- Stage 9.1D.3F.2: Canonical Search Site population and operational gap.
-- Search Sites use scanner-reported units.known_people_count; Rescue Sites retain
-- the existing resident/clearance and operational-number semantics.

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
with resident_count as (
  select ur.site_id, count(*) filter (where ur.is_active = true)::integer as active_residents
  from public.unit_residents ur
  group by ur.site_id
),
clearance_deductions as (
  select u.site_id,
    coalesce(sum(u.cleared_potential_delta) filter (where u.is_active = true and u.is_fully_cleared = true), 0)::integer as cleared_potential_delta
  from public.units u
  group by u.site_id
),
resident_potential as (
  select rc.site_id,
    greatest(rc.active_residents - coalesce(cd.cleared_potential_delta, 0), 0)::integer as updated_potential
  from resident_count rc
  left join clearance_deductions cd on cd.site_id = rc.site_id
),
search_unit_population as (
  select
    u.site_id,
    u.id as unit_id,
    u.known_people_count,
    least(
      u.known_people_count,
      count(ur.id) filter (
        where ur.is_active = true
          and resident_status.category = 'resident'
          and (
            resident_status.status_key = 'resident_clear'
            or (
              resident_status.status_key in ('anxiety_casualty', 'physical_casualty', 'deceased')
              and coalesce(ssu.casualties_resolved, false) = true
              and (coalesce(ur.requires_evacuation, false) = false or ur.evacuated_at is not null)
            )
          )
      )::integer
    )::integer as closed_people
  from public.units u
  join public.sites search_site on search_site.id = u.site_id
    and search_site.incident_id = u.incident_id
    and search_site.site_type = 'search_site'
  left join public.site_search_units ssu
    on ssu.site_id = u.site_id
    and ssu.unit_id = u.id
    and ssu.incident_id = u.incident_id
  left join public.unit_residents ur
    on ur.unit_id = u.id
    and ur.site_id = u.site_id
    and ur.incident_id = u.incident_id
  left join public.status_types resident_status on resident_status.id = ur.status_id
  where u.is_active = true
    and u.known_people_count is not null
  group by u.site_id, u.id, u.known_people_count
),
search_population as (
  select
    site_id,
    coalesce(sum(known_people_count), 0)::integer as updated_potential,
    coalesce(sum(greatest(known_people_count - closed_people, 0)), 0)::integer as operational_gap
  from search_unit_population
  group by site_id
),
operational_numbers as (
  select
    p.site_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (where public.operational_number_team_number(p.operational_number) <> 9)::integer as active_rescue_teams_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id from public.unit_residents ur
    where ur.linked_person_id = p.id and ur.is_active = true
    limit 1
  ) linked_resident on true
  where p.is_merged = false and p.site_id is not null and st.status_key <> 'duplicate_cancelled'
  group by p.site_id
)
select
  s.incident_id,
  s.id as site_id,
  s.site_number,
  s.name,
  s.city,
  s.street,
  s.house_number,
  s.status_id,
  site_status.status_key as site_status_key,
  site_status.hebrew_label as site_status_label,
  s.initial_potential,
  case when s.site_type = 'search_site' then coalesce(sp.updated_potential, 0) else coalesce(rp.updated_potential, 0) end::integer as updated_potential,
  count(distinct u.id) filter (where u.is_active = true)::integer as total_active_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = true)::integer as fully_cleared_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = false)::integer as open_units,
  coalesce(onm.active_operational_numbers_count, 0)::integer as total_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_open = true)::integer as open_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_dashboard_counted = true and person_status.is_open = false and person_status.status_key <> 'duplicate_cancelled')::integer as resolved_persons,
  case when s.site_type = 'search_site' then coalesce(sp.operational_gap, 0) else greatest(coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0), 0) end::integer as operational_gap,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_rescue_teams_count
from public.sites s
join public.status_types site_status on site_status.id = s.status_id
left join resident_potential rp on rp.site_id = s.id
left join search_population sp on sp.site_id = s.id
left join operational_numbers onm on onm.site_id = s.id
left join public.units u on u.site_id = s.id
left join public.persons p on p.site_id = s.id
left join public.status_types person_status on person_status.id = p.current_status_id
where s.is_active = true
group by
  s.incident_id, s.id, site_status.status_key, site_status.hebrew_label, s.site_type,
  s.initial_potential, rp.updated_potential, sp.updated_potential, sp.operational_gap,
  onm.active_operational_numbers_count, onm.unassigned_operational_numbers_count,
  onm.active_rescue_teams_count, onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count, onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count, onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count, onm.operational_numbers_other_count;

create or replace view public.incident_dashboard_summary
with (security_invoker = true) as
with resolved as (
  select p.incident_id,
    count(*) filter (where p.is_merged = false and st.is_dashboard_counted = true and st.is_open = false and st.status_key <> 'duplicate_cancelled')::integer as resolved_persons
  from public.persons p join public.status_types st on st.id = p.current_status_id
  group by p.incident_id
),
site_population as (
  select incident_id,
    count(*)::integer as total_sites,
    coalesce(sum(initial_potential), 0)::integer as initial_potential,
    coalesce(sum(updated_potential), 0)::integer as updated_potential,
    coalesce(sum(operational_gap), 0)::integer as operational_gap
  from public.site_dashboard_summary
  group by incident_id
),
operational_numbers as (
  select
    p.incident_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (where public.operational_number_team_number(p.operational_number) <> 9)::integer as active_rescue_teams_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id from public.unit_residents ur where ur.linked_person_id = p.id and ur.is_active = true limit 1
  ) linked_resident on true
  where p.is_merged = false and st.status_key <> 'duplicate_cancelled'
  group by p.incident_id
),
teams as (
  select t.incident_id, count(*)::integer as total_teams, count(*) filter (where st.status_key = 'available')::integer as available_teams
  from public.teams t left join public.status_types st on st.id = t.status_id
  where t.is_active = true group by t.incident_id
),
assignments as (
  select incident_id, count(*) filter (where assignment_status = 'active')::integer as active_assignments
  from public.team_site_assignments group by incident_id
)
select
  i.id as incident_id, i.name, i.city, i.address, i.opened_at, i.ended_at, i.is_closed, i.status_id,
  incident_status.status_key as incident_status_key, incident_status.hebrew_label as incident_status_label,
  coalesce(sp.total_sites, 0)::integer as total_sites,
  coalesce(sp.initial_potential, 0)::integer as total_initial_potential,
  coalesce(sp.updated_potential, 0)::integer as total_updated_potential,
  coalesce(r.resolved_persons, 0)::integer as resolved_persons,
  coalesce(sp.operational_gap, 0)::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments,
  coalesce(sp.initial_potential, 0)::integer as initial_potential,
  coalesce(sp.updated_potential, 0)::integer as updated_potential,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_rescue_teams_count
from public.incidents i
join public.status_types incident_status on incident_status.id = i.status_id
left join site_population sp on sp.incident_id = i.id
left join resolved r on r.incident_id = i.id
left join operational_numbers onm on onm.incident_id = i.id
left join teams t on t.incident_id = i.id
left join assignments a on a.incident_id = i.id;
