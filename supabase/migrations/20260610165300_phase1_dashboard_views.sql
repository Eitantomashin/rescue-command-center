-- RCC Phase 1 dashboard projection views.
-- Dashboard views calculate from operational source tables and do not store independent data.

create or replace view public.person_status_counts
with (security_invoker = true) as
select
  p.incident_id,
  p.site_id,
  p.current_status_id as status_id,
  st.status_key,
  st.name,
  st.hebrew_label,
  st.color,
  st.is_open,
  st.is_dashboard_counted,
  count(*)::integer as person_count
from public.persons p
join public.status_types st on st.id = p.current_status_id
where p.is_merged = false
  and st.status_key <> 'duplicate_cancelled'
group by
  p.incident_id,
  p.site_id,
  p.current_status_id,
  st.status_key,
  st.name,
  st.hebrew_label,
  st.color,
  st.is_open,
  st.is_dashboard_counted;

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
  coalesce(sum(s.updated_potential), 0)::integer as total_updated_potential,
  coalesce(r.resolved_persons, 0)::integer as resolved_persons,
  (coalesce(sum(s.updated_potential), 0) - coalesce(r.resolved_persons, 0))::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(t.active_teams, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments
from public.incidents i
join public.status_types incident_status on incident_status.id = i.status_id
left join public.sites s on s.incident_id = i.id and s.is_active = true
left join resolved r on r.incident_id = i.id
left join teams t on t.incident_id = i.id
left join assignments a on a.incident_id = i.id
group by
  i.id,
  incident_status.status_key,
  incident_status.hebrew_label,
  r.resolved_persons,
  t.total_teams,
  t.active_teams,
  t.available_teams,
  a.active_assignments;

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
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
  s.updated_potential,
  count(distinct u.id) filter (where u.is_active = true)::integer as total_active_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = true)::integer as fully_cleared_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = false)::integer as open_units,
  count(distinct p.id) filter (where p.is_merged = false)::integer as total_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_open = true)::integer as open_persons,
  count(distinct p.id) filter (
    where p.is_merged = false
      and person_status.is_dashboard_counted = true
      and person_status.is_open = false
      and person_status.status_key <> 'duplicate_cancelled'
  )::integer as resolved_persons,
  (
    s.updated_potential
    - count(distinct p.id) filter (
        where p.is_merged = false
          and person_status.is_dashboard_counted = true
          and person_status.is_open = false
          and person_status.status_key <> 'duplicate_cancelled'
      )
  )::integer as operational_gap
from public.sites s
join public.status_types site_status on site_status.id = s.status_id
left join public.units u on u.site_id = s.id
left join public.persons p on p.site_id = s.id
left join public.status_types person_status on person_status.id = p.current_status_id
where s.is_active = true
group by
  s.incident_id,
  s.id,
  site_status.status_key,
  site_status.hebrew_label;

create or replace view public.recent_event_logs
with (security_invoker = true) as
select
  el.*,
  s.site_number,
  p.operational_number,
  t.team_number
from public.event_logs el
left join public.sites s on s.id = el.site_id
left join public.persons p on p.id = el.person_id
left join public.teams t on t.id = el.team_id
order by el.reported_at desc, el.created_at desc;
