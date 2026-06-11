alter table public.status_types
  add column if not exists counts_as_gap_resolved boolean not null default false;

update public.status_types
set counts_as_gap_resolved = false
where category in ('resident', 'person')
  and status_key in ('missing', 'unknown', 'general', 'in_progress');

insert into public.status_types (
  incident_id,
  category,
  status_key,
  name,
  hebrew_label,
  color,
  is_open,
  is_dashboard_counted,
  is_default,
  counts_as_gap_resolved,
  sort_order
)
values
  (null, 'resident', 'unknown', 'Unknown', 'לא ידוע', 'blue', true, true, true, false, 35),
  (null, 'resident', 'general', 'General', 'כללי', 'gray', true, true, true, false, 36),
  (null, 'resident', 'trapped_located_not_yet_rescued', 'Trapped Located Not Yet Rescued', 'לכודים שאותרו וטרם חולצו', 'green', true, true, true, true, 55),
  (null, 'resident', 'evacuated_to_napal', 'Evacuated To Napal', 'פצועים שפונו לנאפל', 'green', false, true, true, true, 61),
  (null, 'resident', 'evacuated_from_site', 'Evacuated From Site', 'פצועים שפונו מהאתר', 'green', false, true, true, true, 62),
  (null, 'resident', 'deceased_evacuated', 'Deceased Evacuated', 'הרוגים שפונו', 'green', false, true, true, true, 63),
  (null, 'person', 'evacuated_to_napal', 'Evacuated To Napal', 'פצועים שפונו לנאפל', 'yellow', false, true, true, true, 31),
  (null, 'person', 'evacuated_from_site', 'Evacuated From Site', 'פצועים שפונו מהאתר', 'green', false, true, true, true, 41),
  (null, 'person', 'deceased_evacuated', 'Deceased Evacuated', 'הרוגים שפונו', 'black', false, true, true, true, 51),
  (null, 'person', 'rescued', 'Rescued', 'חולץ', 'green', false, true, true, true, 70),
  (null, 'person', 'evacuated', 'Evacuated', 'פונה', 'green', false, true, true, true, 80),
  (null, 'person', 'resolved', 'Resolved', 'טופל', 'green', false, true, true, true, 90),
  (null, 'person', 'unknown', 'Unknown', 'לא ידוע', 'blue', true, true, true, false, 5),
  (null, 'person', 'general', 'General', 'כללי', 'gray', true, true, true, false, 6),
  (null, 'person', 'in_progress', 'In Progress', 'בטיפול', 'orange', true, true, true, false, 15)
on conflict do nothing;

update public.status_types
set counts_as_gap_resolved = true
where category in ('resident', 'person')
  and status_key in (
    'located_outside_site',
    'evacuated_to_napal',
    'evacuated_from_site',
    'deceased_evacuated',
    'trapped_located_not_yet_rescued',
    'rescued',
    'evacuated',
    'resolved',
    'injured_evacuated_to_ccp',
    'injured_evacuated_from_site',
    'fatality_evacuated'
  );

update public.status_types
set hebrew_label = case status_key
  when 'located_outside_site' then 'אזרחים שאותרו לא באתר'
  when 'evacuated_to_napal' then 'פצועים שפונו לנאפל'
  when 'evacuated_from_site' then 'פצועים שפונו מהאתר'
  when 'deceased_evacuated' then 'הרוגים שפונו'
  when 'trapped_located_not_yet_rescued' then 'לכודים שאותרו וטרם חולצו'
  when 'rescued' then 'חולץ'
  when 'evacuated' then 'פונה'
  when 'resolved' then 'טופל'
  else hebrew_label
end
where category in ('resident', 'person')
  and status_key in (
    'located_outside_site',
    'evacuated_to_napal',
    'evacuated_from_site',
    'deceased_evacuated',
    'trapped_located_not_yet_rescued',
    'rescued',
    'evacuated',
    'resolved'
  );

update public.status_types
set
  counts_as_gap_resolved = false,
  color = case
    when status_key = 'missing' then 'blue'
    when status_key = 'unknown' then 'blue'
    when status_key = 'in_progress' then 'orange'
    when status_key = 'general' then 'gray'
    else color
  end
where category in ('resident', 'person')
  and status_key in ('missing', 'unknown', 'general', 'in_progress');

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
    count(*) filter (where ur.is_active = true)::integer as updated_potential,
    count(*) filter (
      where ur.is_active = true
        and (
          coalesce(resident_status.counts_as_gap_resolved, false) = true
          or coalesce(person_status.counts_as_gap_resolved, false) = true
        )
    )::integer as gap_resolved_count
  from public.unit_residents ur
  left join public.status_types resident_status on resident_status.id = ur.status_id
  left join public.persons linked_person on linked_person.id = ur.linked_person_id
    and linked_person.is_merged = false
  left join public.status_types person_status on person_status.id = linked_person.current_status_id
  group by ur.incident_id
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
    coalesce(rp.updated_potential, 0) - coalesce(rp.gap_resolved_count, 0),
    0
  )::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(t.active_teams, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments,
  coalesce(sum(s.initial_potential), 0)::integer as initial_potential,
  coalesce(rp.updated_potential, 0)::integer as updated_potential,
  coalesce(rp.gap_resolved_count, 0)::integer as gap_resolved_count
from public.incidents i
join public.status_types incident_status on incident_status.id = i.status_id
left join public.sites s on s.incident_id = i.id and s.is_active = true
left join resolved r on r.incident_id = i.id
left join resident_potential rp on rp.incident_id = i.id
left join teams t on t.incident_id = i.id
left join assignments a on a.incident_id = i.id
group by
  i.id,
  incident_status.status_key,
  incident_status.hebrew_label,
  rp.updated_potential,
  rp.gap_resolved_count,
  r.resolved_persons,
  t.total_teams,
  t.active_teams,
  t.available_teams,
  a.active_assignments;

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
with resident_potential as (
  select
    ur.site_id,
    count(*) filter (where ur.is_active = true)::integer as updated_potential,
    count(*) filter (
      where ur.is_active = true
        and (
          coalesce(resident_status.counts_as_gap_resolved, false) = true
          or coalesce(person_status.counts_as_gap_resolved, false) = true
        )
    )::integer as gap_resolved_count
  from public.unit_residents ur
  left join public.status_types resident_status on resident_status.id = ur.status_id
  left join public.persons linked_person on linked_person.id = ur.linked_person_id
    and linked_person.is_merged = false
  left join public.status_types person_status on person_status.id = linked_person.current_status_id
  group by ur.site_id
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
  count(distinct p.id) filter (where p.is_merged = false)::integer as total_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_open = true)::integer as open_persons,
  count(distinct p.id) filter (
    where p.is_merged = false
      and person_status.is_dashboard_counted = true
      and person_status.is_open = false
      and person_status.status_key <> 'duplicate_cancelled'
  )::integer as resolved_persons,
  greatest(
    coalesce(rp.updated_potential, 0) - coalesce(rp.gap_resolved_count, 0),
    0
  )::integer as operational_gap,
  coalesce(rp.gap_resolved_count, 0)::integer as gap_resolved_count
from public.sites s
join public.status_types site_status on site_status.id = s.status_id
left join resident_potential rp on rp.site_id = s.id
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
  rp.gap_resolved_count;
