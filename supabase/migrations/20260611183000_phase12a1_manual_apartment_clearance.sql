-- Phase 12A.1: Manual apartment clearance.
-- Adds manual clearance metadata and subtracts cleared apartment residents from
-- updated potential without deleting or hiding resident data.

alter table public.units
  add column if not exists cleared_at timestamptz,
  add column if not exists cleared_by uuid references public.profiles(id),
  add column if not exists cleared_reason text,
  add column if not exists cleared_potential_delta integer not null default 0 check (cleared_potential_delta >= 0),
  add column if not exists cleared_method text check (cleared_method in ('manual', 'automatic')),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.profiles(id);

create or replace function public.set_unit_clearance(
  p_unit_id uuid,
  p_is_fully_cleared boolean,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_status_id uuid;
  v_reason text;
  v_delta integer := 0;
  v_site_status text;
  v_incident_closed boolean;
begin
  select * into v_unit
  from public.units
  where id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_edit_operational_data(v_unit.incident_id);

  select s.lifecycle_status
  into v_site_status
  from public.sites s
  where s.id = v_unit.site_id;

  select (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  into v_incident_closed
  from public.incidents i
  where i.id = v_unit.incident_id;

  if coalesce(v_site_status, 'open') = 'closed' or coalesce(v_incident_closed, false) then
    raise exception 'Cannot change apartment clearance for a closed incident or site';
  end if;

  if not v_unit.is_active then
    raise exception 'Inactive units cannot be cleared or reopened';
  end if;

  v_reason := nullif(btrim(coalesce(p_override_reason, '')), '');

  if p_is_fully_cleared and v_reason is null then
    raise exception 'Clearance reason is required';
  end if;

  if p_is_fully_cleared then
    v_status_id := public.get_status_id('unit', 'fully_cleared', v_unit.incident_id);

    select count(*)::integer
    into v_delta
    from public.unit_residents ur
    where ur.unit_id = p_unit_id
      and ur.is_active = true;
  else
    v_status_id := public.get_status_id('unit', 'active_investigation', v_unit.incident_id);
    v_delta := 0;
  end if;

  perform set_config('rcc.allow_unit_operational_write', 'on', true);

  update public.units
  set
    is_fully_cleared = p_is_fully_cleared,
    status_id = coalesce(v_status_id, status_id),
    cleared_at = case when p_is_fully_cleared then now() else cleared_at end,
    cleared_by = case when p_is_fully_cleared then public.current_actor_id() else cleared_by end,
    cleared_reason = case when p_is_fully_cleared then v_reason else cleared_reason end,
    cleared_method = case when p_is_fully_cleared then 'manual' else cleared_method end,
    cleared_potential_delta = v_delta,
    reopened_at = case when p_is_fully_cleared then reopened_at else now() end,
    reopened_by = case when p_is_fully_cleared then reopened_by else public.current_actor_id() end,
    updated_by = public.current_actor_id(),
    updated_at = now()
  where id = p_unit_id;

  perform set_config('rcc.allow_unit_operational_write', 'off', true);

  perform public.create_event_log(
    v_unit.incident_id,
    case when p_is_fully_cleared then 'unit_cleared' else 'unit_clearance_removed' end,
    case when p_is_fully_cleared then U&'\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05DB\05DE\05D6\05D5\05DB\05D4' else U&'\05D3\05D9\05E8\05D4 \05D4\05D5\05D7\05D6\05E8\05D4 \05DC\05E4\05E2\05D9\05DC\05D5\05EA' end,
    case
      when p_is_fully_cleared
      then public.dynamic_structure_unit_label(v_unit) || U&' \05E1\05D5\05DE\05E0\05D4 \05DB\05DE\05D6\05D5\05DB\05D4. \05E1\05D9\05D1\05D4: ' || v_reason
      else public.dynamic_structure_unit_label(v_unit) || U&' \05D4\05D5\05D7\05D6\05E8\05D4 \05DC\05E4\05E2\05D9\05DC\05D5\05EA'
    end,
    'clearance',
    case when p_is_fully_cleared then 'important' else 'normal' end,
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object(
      'unit_id', v_unit.id,
      'unit_number', v_unit.unit_number,
      'previous_is_fully_cleared', v_unit.is_fully_cleared,
      'new_is_fully_cleared', p_is_fully_cleared,
      'cleared_reason', v_reason,
      'cleared_method', case when p_is_fully_cleared then 'manual' else null end,
      'cleared_potential_delta', v_delta
    )
  );
end;
$$;

create or replace view public.incident_dashboard_summary
with (security_invoker = true) as
with resolved as (
  select
    p.incident_id,
    count(*) filter (
      where p.is_merged = false
        and st.is_dashboard_counted = true
        and st.is_open = false
        and st.status_key <> 'duplicate_cancelled'
    )::integer as resolved_persons
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  group by p.incident_id
),
resident_count as (
  select
    ur.incident_id,
    count(*) filter (where ur.is_active = true)::integer as active_residents
  from public.unit_residents ur
  group by ur.incident_id
),
clearance_deductions as (
  select
    u.incident_id,
    coalesce(sum(u.cleared_potential_delta) filter (
      where u.is_active = true and u.is_fully_cleared = true
    ), 0)::integer as cleared_potential_delta
  from public.units u
  group by u.incident_id
),
resident_potential as (
  select
    rc.incident_id,
    greatest(rc.active_residents - coalesce(cd.cleared_potential_delta, 0), 0)::integer as updated_potential
  from resident_count rc
  left join clearance_deductions cd on cd.incident_id = rc.incident_id
),
operational_numbers as (
  select
    p.incident_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (
      where public.operational_number_team_number(p.operational_number) <> 9
    )::integer as active_rescue_teams_count,
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
    count(*) filter (where st.status_key = 'available')::integer as available_teams
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
  greatest(coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0), 0)::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_teams,
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
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_rescue_teams_count
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
  onm.active_rescue_teams_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count,
  t.total_teams,
  t.available_teams,
  a.active_assignments;

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
with resident_count as (
  select
    ur.site_id,
    count(*) filter (where ur.is_active = true)::integer as active_residents
  from public.unit_residents ur
  group by ur.site_id
),
clearance_deductions as (
  select
    u.site_id,
    coalesce(sum(u.cleared_potential_delta) filter (
      where u.is_active = true and u.is_fully_cleared = true
    ), 0)::integer as cleared_potential_delta
  from public.units u
  group by u.site_id
),
resident_potential as (
  select
    rc.site_id,
    greatest(rc.active_residents - coalesce(cd.cleared_potential_delta, 0), 0)::integer as updated_potential
  from resident_count rc
  left join clearance_deductions cd on cd.site_id = rc.site_id
),
operational_numbers as (
  select
    p.site_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (
      where public.operational_number_team_number(p.operational_number) <> 9
    )::integer as active_rescue_teams_count,
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
  greatest(coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0), 0)::integer as operational_gap,
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
  onm.active_rescue_teams_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count;

grant execute on function public.set_unit_clearance(uuid, boolean, text) to authenticated;
