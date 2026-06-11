create or replace function public.create_unit_resident(
  p_unit_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
  p_status_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_status public.status_types%rowtype;
  v_resident_id uuid;
begin
  if nullif(btrim(coalesce(p_first_name, '')), '') is null
    and nullif(btrim(coalesce(p_last_name, '')), '') is null
  then
    raise exception 'Resident first name or last name is required';
  end if;

  if p_age is not null and p_age < 0 then
    raise exception 'Resident age cannot be negative';
  end if;

  select * into v_unit
  from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'create_unit_resident');

  if not v_unit.is_active then
    raise exception 'Cannot add residents to inactive units';
  end if;

  if p_status_id is not null then
    select * into v_status
    from public.status_types
    where id = p_status_id
      and category = 'resident'
      and is_active = true
      and (incident_id = v_unit.incident_id or incident_id is null);

    if not found then
      raise exception 'Resident status % is not valid for this incident', p_status_id;
    end if;
  end if;

  insert into public.unit_residents (
    incident_id,
    site_id,
    unit_id,
    first_name,
    last_name,
    age,
    phone,
    status_id,
    notes,
    created_by,
    updated_by
  )
  values (
    v_unit.incident_id,
    v_unit.site_id,
    v_unit.id,
    nullif(btrim(coalesce(p_first_name, '')), ''),
    nullif(btrim(coalesce(p_last_name, '')), ''),
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    p_status_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_resident_id;

  perform public.create_event_log(
    v_unit.incident_id,
    'unit_resident_created',
    'Unit Resident Created',
    p_notes,
    'operational',
    'normal',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'resident_id', v_resident_id,
      'unit_number', v_unit.unit_number,
      'first_name', p_first_name,
      'last_name', p_last_name,
      'resident_status_key', v_status.status_key,
      'resident_status_label', v_status.hebrew_label
    )
  );

  return v_resident_id;
end;
$$;

create or replace function public.create_general_area_resident(
  p_site_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
  p_status_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_status public.status_types%rowtype;
  v_resident_id uuid;
begin
  if nullif(btrim(coalesce(p_first_name, '')), '') is null
    and nullif(btrim(coalesce(p_last_name, '')), '') is null
  then
    raise exception 'Resident first name or last name is required';
  end if;

  if p_age is not null and p_age < 0 then
    raise exception 'Resident age cannot be negative';
  end if;

  select * into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site % does not exist', p_site_id;
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'create_general_area_resident');

  if p_status_id is not null then
    select * into v_status
    from public.status_types
    where id = p_status_id
      and category = 'resident'
      and is_active = true
      and (incident_id = v_site.incident_id or incident_id is null);

    if not found then
      raise exception 'Resident status % is not valid for this incident', p_status_id;
    end if;
  end if;

  insert into public.unit_residents (
    incident_id,
    site_id,
    unit_id,
    first_name,
    last_name,
    age,
    phone,
    status_id,
    notes,
    created_by,
    updated_by
  )
  values (
    v_site.incident_id,
    v_site.id,
    null,
    nullif(btrim(coalesce(p_first_name, '')), ''),
    nullif(btrim(coalesce(p_last_name, '')), ''),
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    p_status_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_resident_id;

  perform public.create_event_log(
    v_site.incident_id,
    'general_area_resident_created',
    'General Area Resident Created',
    p_notes,
    'operational',
    'normal',
    now(),
    v_site.id,
    null,
    null,
    null,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'resident_id', v_resident_id,
      'area', 'general',
      'first_name', p_first_name,
      'last_name', p_last_name,
      'resident_status_key', v_status.status_key,
      'resident_status_label', v_status.hebrew_label
    )
  );

  return v_resident_id;
end;
$$;

create or replace function public.create_site_with_structure(
  p_incident_id uuid,
  p_site_number integer,
  p_street text,
  p_house_number text,
  p_floors_count integer,
  p_default_units_per_floor integer,
  p_name text default null,
  p_city text default null,
  p_default_people_per_unit integer default 5,
  p_additional_potential integer default 0,
  p_additional_potential_reason text default null,
  p_status_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_site_status_id uuid;
  v_floor_status_id uuid;
  v_unit_status_id uuid;
  v_resident_status_id uuid;
  v_initial_potential integer;
  v_floor_number integer;
  v_unit_number integer;
  v_resident_number integer;
begin
  perform public.assert_incident_writable(p_incident_id, 'create_site_with_structure');

  if p_site_number <= 0 then
    raise exception 'Site number must be positive';
  end if;

  if p_floors_count < 0 or p_default_units_per_floor < 0 or p_default_people_per_unit < 0 then
    raise exception 'Floor, unit, and people counts cannot be negative';
  end if;

  if coalesce(p_additional_potential, 0) > 0
    and nullif(btrim(p_additional_potential_reason), '') is null
  then
    raise exception 'Additional potential reason is required';
  end if;

  v_site_status_id := coalesce(p_status_id, public.get_status_id('site', 'created', p_incident_id));
  v_floor_status_id := public.get_status_id('floor', 'active', p_incident_id);
  v_unit_status_id := public.get_status_id('unit', 'unknown', p_incident_id);
  v_resident_status_id := public.get_status_id('resident', 'missing', p_incident_id);

  if v_site_status_id is null
    or not exists (
      select 1
      from public.status_types st
      where st.id = v_site_status_id
        and st.category = 'site'
        and st.is_active = true
        and (st.incident_id = p_incident_id or st.incident_id is null)
    )
  then
    raise exception 'Valid site status is required';
  end if;

  if v_floor_status_id is null or v_unit_status_id is null or v_resident_status_id is null then
    raise exception 'Default floor/unit/resident statuses are missing';
  end if;

  v_initial_potential :=
    (p_floors_count * p_default_units_per_floor * p_default_people_per_unit)
    + coalesce(p_additional_potential, 0);

  perform set_config('rcc.allow_structure_write', 'on', true);

  insert into public.sites (
    incident_id,
    site_number,
    name,
    city,
    street,
    house_number,
    floors_count,
    default_units_per_floor,
    default_people_per_unit,
    additional_potential,
    additional_potential_reason,
    initial_potential,
    updated_potential,
    status_id,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    p_site_number,
    p_name,
    p_city,
    p_street,
    p_house_number,
    p_floors_count,
    p_default_units_per_floor,
    p_default_people_per_unit,
    coalesce(p_additional_potential, 0),
    p_additional_potential_reason,
    v_initial_potential,
    v_initial_potential,
    v_site_status_id,
    auth.uid(),
    auth.uid()
  )
  returning id into v_site_id;

  for v_floor_number in 1..p_floors_count loop
    insert into public.floors (
      incident_id,
      site_id,
      floor_number,
      units_count,
      status_id,
      created_by,
      updated_by
    )
    values (
      p_incident_id,
      v_site_id,
      v_floor_number,
      p_default_units_per_floor,
      v_floor_status_id,
      auth.uid(),
      auth.uid()
    )
    returning id into v_floor_id;

    for v_unit_number in 1..p_default_units_per_floor loop
      insert into public.units (
        incident_id,
        site_id,
        floor_id,
        unit_number,
        status_id,
        created_by,
        updated_by
      )
      values (
        p_incident_id,
        v_site_id,
        v_floor_id,
        v_unit_number::text,
        v_unit_status_id,
        auth.uid(),
        auth.uid()
      )
      returning id into v_unit_id;

      for v_resident_number in 1..p_default_people_per_unit loop
        insert into public.unit_residents (
          incident_id,
          site_id,
          unit_id,
          first_name,
          status_id,
          notes,
          created_by,
          updated_by
        )
        values (
          p_incident_id,
          v_site_id,
          v_unit_id,
          'דייר ' || v_resident_number,
          v_resident_status_id,
          'placeholder',
          auth.uid(),
          auth.uid()
        );
      end loop;
    end loop;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    p_incident_id,
    'site_created',
    'Site Created',
    null,
    'operational',
    'normal',
    now(),
    v_site_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'site_number', p_site_number,
      'floors_count', p_floors_count,
      'default_units_per_floor', p_default_units_per_floor,
      'default_people_per_unit', p_default_people_per_unit,
      'additional_potential', coalesce(p_additional_potential, 0),
      'initial_potential', v_initial_potential,
      'updated_potential', v_initial_potential
    )
  );

  return v_site_id;
end;
$$;

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
  (coalesce(rp.updated_potential, 0) - coalesce(r.resolved_persons, 0))::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(t.active_teams, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments
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
    count(*) filter (where ur.is_active = true)::integer as updated_potential
  from public.unit_residents ur
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
  (
    coalesce(rp.updated_potential, 0)
    - count(distinct p.id) filter (
        where p.is_merged = false
          and person_status.is_dashboard_counted = true
          and person_status.is_open = false
          and person_status.status_key <> 'duplicate_cancelled'
      )
  )::integer as operational_gap
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
  rp.updated_potential;
