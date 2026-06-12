-- Phase 5 operational gap methodology.
--
-- Updated potential comes only from active resident rows.
-- Operational gap is reduced by active operational numbers, regardless of
-- whether the operational number is linked to a resident or already resolved.
-- Existing event_logs remain immutable and untouched.

create or replace function public.operational_status_dashboard_group(p_status_key text)
returns text
language sql
immutable
as $$
  select case
    when p_status_key in ('missing', 'unknown', 'general') then 'missing_unknown'
    when p_status_key = 'trapped_located_not_yet_rescued' then 'trapped_located_not_yet_rescued'
    when p_status_key = 'rescued' then 'rescued'
    when p_status_key in (
      'evacuated',
      'evacuated_to_napal',
      'evacuated_from_site',
      'injured_evacuated_to_ccp',
      'injured_evacuated_from_site'
    ) then 'evacuated'
    when p_status_key = 'located_outside_site' then 'located_outside_site'
    when p_status_key in (
      'deceased',
      'deceased_evacuated',
      'fatality_evacuated',
      'dead'
    ) then 'deceased'
    else 'other'
  end
$$;

create or replace function public.operational_status_dashboard_label(p_status_key text)
returns text
language sql
immutable
as $$
  select case public.operational_status_dashboard_group(p_status_key)
    when 'missing_unknown' then 'נעדר / לא ידוע'
    when 'trapped_located_not_yet_rescued' then 'לכוד אותר וטרם חולץ'
    when 'rescued' then 'חולץ'
    when 'evacuated' then 'פונה'
    when 'located_outside_site' then 'אותר מחוץ לאתר'
    when 'deceased' then 'הרוג / נפטר'
    else 'אחר'
  end
$$;

create or replace function public.operational_status_card_color(p_status_key text)
returns text
language sql
immutable
as $$
  select case public.operational_status_dashboard_group(p_status_key)
    when 'missing_unknown' then 'blue'
    when 'trapped_located_not_yet_rescued' then 'orange'
    when 'rescued' then 'green'
    when 'evacuated' then 'green'
    when 'located_outside_site' then 'green'
    when 'deceased' then 'red'
    else 'orange'
  end
$$;

create or replace view public.operational_numbers_dashboard as
with linked_residents as (
  select distinct on (ur.linked_person_id)
    ur.linked_person_id as person_id,
    ur.id as resident_id,
    ur.first_name as resident_first_name,
    ur.last_name as resident_last_name,
    ur.unit_id as resident_unit_id
  from public.unit_residents ur
  where ur.linked_person_id is not null
    and ur.is_active = true
  order by ur.linked_person_id, ur.updated_at desc, ur.created_at desc
),
latest_reports as (
  select distinct on (opr.person_id)
    opr.*
  from public.operational_reports opr
  order by opr.person_id, opr.reported_at desc, opr.created_at desc
)
select
  p.incident_id,
  p.site_id,
  p.id as person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  p.first_name,
  p.last_name,
  p.current_status_id,
  current_status.status_key as current_status_key,
  current_status.hebrew_label as current_status_label,
  current_status.counts_as_gap_resolved,
  p.unit_id,
  u.unit_number,
  f.floor_number,
  lr.resident_id,
  lr.resident_first_name,
  lr.resident_last_name,
  latest.id as latest_report_id,
  latest.status_id as latest_report_status_id,
  latest_status.status_key as latest_report_status_key,
  latest_status.hebrew_label as latest_report_status_label,
  latest.information_source_type as latest_source_type,
  latest.information_source_name as latest_source_name,
  latest.source_phone as latest_source_phone,
  latest.grid_cell as latest_grid_cell,
  latest.confidence_level as latest_confidence_level,
  latest.notes as latest_notes,
  latest.reported_at as latest_reported_at,
  latest.created_at as latest_report_created_at,
  p.is_merged,
  p.merged_into_person_id,
  public.operational_status_dashboard_group(current_status.status_key) as dashboard_status_group,
  public.operational_status_dashboard_label(current_status.status_key) as dashboard_status_label,
  public.operational_status_card_color(current_status.status_key) as dashboard_card_color
from public.persons p
join public.status_types current_status on current_status.id = p.current_status_id
left join latest_reports latest on latest.person_id = p.id
left join public.status_types latest_status on latest_status.id = latest.status_id
left join linked_residents lr on lr.person_id = p.id
left join public.units u on u.id = coalesce(p.unit_id, lr.resident_unit_id)
left join public.floors f on f.id = u.floor_id;

create or replace view public.incident_dashboard_summary
with (security_invoker = true) as
with resolved as (
  select
    p.incident_id,
    count(*)::integer as resolved_persons
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  where p.is_merged = false
    and st.is_dashboard_counted = true
    and st.is_open = false
    and st.status_key <> 'duplicate_cancelled'
  group by p.incident_id
),
resident_potential as (
  select
    ur.incident_id,
    count(*) filter (where ur.is_active = true)::integer as updated_potential
  from public.unit_residents ur
  group by ur.incident_id
),
operational_numbers as (
  select
    p.incident_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer
      as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer
      as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer
      as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer
      as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer
      as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer
      as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer
      as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id
    from public.unit_residents ur
    where ur.linked_person_id = p.id
      and ur.is_active = true
    limit 1
  ) linked_resident on true
  where p.is_merged = false
    and st.status_key <> 'duplicate_cancelled'
  group by p.incident_id
),
teams as (
  select
    t.incident_id,
    count(*)::integer as total_teams,
    count(*) filter (
      where st.status_key in ('assigned', 'en_route', 'operating')
    )::integer as active_teams,
    count(*) filter (
      where st.status_key = 'available'
    )::integer as available_teams
  from public.teams t
  left join public.status_types st on st.id = t.status_id
  where t.is_active = true
  group by t.incident_id
),
assignments as (
  select
    incident_id,
    count(*) filter (where assignment_status = 'active')::integer as active_assignments
  from public.team_site_assignments
  group by incident_id
)
select
  i.id as incident_id,
  i.name,
  i.city,
  i.address,
  i.opened_at,
  i.ended_at,
  i.is_closed,
  i.status_id,
  incident_status.status_key as incident_status_key,
  incident_status.hebrew_label as incident_status_label,
  count(distinct s.id)::integer as total_sites,
  coalesce(sum(s.initial_potential), 0)::integer as total_initial_potential,
  coalesce(rp.updated_potential, 0)::integer as total_updated_potential,
  coalesce(r.resolved_persons, 0)::integer as resolved_persons,
  greatest(
    coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0),
    0
  )::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(t.active_teams, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments,
  coalesce(sum(s.initial_potential), 0)::integer as initial_potential,
  coalesce(rp.updated_potential, 0)::integer as updated_potential,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count
from public.incidents i
join public.status_types incident_status on incident_status.id = i.status_id
left join public.sites s on s.incident_id = i.id and s.is_active = true
left join resolved r on r.incident_id = i.id
left join resident_potential rp on rp.incident_id = i.id
left join operational_numbers onm on onm.incident_id = i.id
left join teams t on t.incident_id = i.id
left join assignments a on a.incident_id = i.id
group by
  i.id,
  incident_status.status_key,
  incident_status.hebrew_label,
  rp.updated_potential,
  r.resolved_persons,
  onm.active_operational_numbers_count,
  onm.unassigned_operational_numbers_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count,
  t.total_teams,
  t.active_teams,
  t.available_teams,
  a.active_assignments;

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
with resident_potential as (
  select
    ur.site_id,
    count(*) filter (where ur.is_active = true)::integer as updated_potential
  from public.unit_residents ur
  group by ur.site_id
),
operational_numbers as (
  select
    p.site_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer
      as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer
      as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer
      as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer
      as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer
      as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer
      as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer
      as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id
    from public.unit_residents ur
    where ur.linked_person_id = p.id
      and ur.is_active = true
    limit 1
  ) linked_resident on true
  where p.is_merged = false
    and p.site_id is not null
    and st.status_key <> 'duplicate_cancelled'
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
  coalesce(rp.updated_potential, 0)::integer as updated_potential,
  count(distinct u.id) filter (where u.is_active = true)::integer as total_active_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = true)::integer as fully_cleared_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = false)::integer as open_units,
  coalesce(onm.active_operational_numbers_count, 0)::integer as total_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_open = true)::integer as open_persons,
  count(distinct p.id) filter (
    where p.is_merged = false
      and person_status.is_dashboard_counted = true
      and person_status.is_open = false
      and person_status.status_key <> 'duplicate_cancelled'
  )::integer as resolved_persons,
  greatest(
    coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0),
    0
  )::integer as operational_gap,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count
from public.sites s
join public.status_types site_status on site_status.id = s.status_id
left join resident_potential rp on rp.site_id = s.id
left join operational_numbers onm on onm.site_id = s.id
left join public.units u on u.site_id = s.id
left join public.persons p on p.site_id = s.id
left join public.status_types person_status on person_status.id = p.current_status_id
where s.is_active = true
group by
  s.incident_id,
  s.id,
  site_status.status_key,
  site_status.hebrew_label,
  rp.updated_potential,
  onm.active_operational_numbers_count,
  onm.unassigned_operational_numbers_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count;
