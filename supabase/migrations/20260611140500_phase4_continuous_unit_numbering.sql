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
  v_lowest_floor_number integer := 1;
  v_unit_index integer;
  v_continuous_unit_number integer;
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

  for v_floor_number in v_lowest_floor_number..(v_lowest_floor_number + p_floors_count - 1) loop
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

    for v_unit_index in 1..p_default_units_per_floor loop
      v_continuous_unit_number :=
        ((v_floor_number - v_lowest_floor_number) * p_default_units_per_floor) + v_unit_index;

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
        v_continuous_unit_number::text,
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
      'lowest_floor_number', v_lowest_floor_number,
      'default_units_per_floor', p_default_units_per_floor,
      'default_people_per_unit', p_default_people_per_unit,
      'additional_potential', coalesce(p_additional_potential, 0),
      'initial_potential', v_initial_potential,
      'updated_potential', v_initial_potential,
      'unit_numbering', 'continuous_across_floors'
    )
  );

  return v_site_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.renumber_site_units_continuous(
  p_site_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_lowest_floor_number integer;
  v_units_per_floor integer;
  v_updated_count integer := 0;
begin
  select * into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site % does not exist', p_site_id;
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'renumber_site_units_continuous');

  select min(floor_number) into v_lowest_floor_number
  from public.floors
  where site_id = p_site_id;

  if v_lowest_floor_number is null then
    return 0;
  end if;

  v_units_per_floor := nullif(v_site.default_units_per_floor, 0);

  if v_units_per_floor is null then
    select max(unit_count)::integer into v_units_per_floor
    from (
      select count(*) as unit_count
      from public.units u
      join public.floors f on f.id = u.floor_id
      where u.site_id = p_site_id
      group by f.id
    ) floor_counts;
  end if;

  if v_units_per_floor is null or v_units_per_floor <= 0 then
    return 0;
  end if;

  perform set_config('rcc.allow_structure_write', 'on', true);

  with numbered_units as (
    select
      u.id,
      (
        ((f.floor_number - v_lowest_floor_number) * v_units_per_floor)
        + row_number() over (
            partition by f.id
            order by
              case when u.unit_number ~ '^[0-9]+$' then u.unit_number::integer else null end,
              u.created_at,
              u.id
          )
      )::text as new_unit_number
    from public.units u
    join public.floors f on f.id = u.floor_id
    where u.site_id = p_site_id
  )
  update public.units u
  set
    unit_number = nu.new_unit_number,
    updated_by = auth.uid()
  from numbered_units nu
  where u.id = nu.id
    and u.unit_number is distinct from nu.new_unit_number;

  get diagnostics v_updated_count = row_count;

  perform set_config('rcc.allow_structure_write', 'off', true);

  return v_updated_count;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

select set_config('rcc.allow_structure_write', 'on', true);

with site_floor_context as (
  select
    s.id as site_id,
    coalesce(nullif(s.default_units_per_floor, 0), floor_counts.max_units_per_floor)::integer as units_per_floor,
    min(f.floor_number) as lowest_floor_number
  from public.sites s
  join public.floors f on f.site_id = s.id
  join (
    select
      counted_floors.site_id,
      max(counted_floors.unit_count)::integer as max_units_per_floor
    from (
      select
        f2.site_id,
        f2.id as floor_id,
        count(u2.id) as unit_count
      from public.floors f2
      left join public.units u2 on u2.floor_id = f2.id
      group by f2.site_id, f2.id
    ) counted_floors
    group by counted_floors.site_id
  ) floor_counts on floor_counts.site_id = s.id
  where s.is_active = true
  group by s.id, s.default_units_per_floor, floor_counts.max_units_per_floor
),
numbered_units as (
  select
    u.id,
    (
      ((f.floor_number - sfc.lowest_floor_number) * sfc.units_per_floor)
      + row_number() over (
          partition by f.id
          order by
            case when u.unit_number ~ '^[0-9]+$' then u.unit_number::integer else null end,
            u.created_at,
            u.id
        )
    )::text as new_unit_number
  from public.units u
  join public.floors f on f.id = u.floor_id
  join site_floor_context sfc on sfc.site_id = u.site_id
  where sfc.units_per_floor > 0
)
update public.units u
set unit_number = numbered_units.new_unit_number
from numbered_units
where u.id = numbered_units.id
  and u.unit_number is distinct from numbered_units.new_unit_number;

select set_config('rcc.allow_structure_write', 'off', true);

comment on function public.renumber_site_units_continuous(uuid)
  is 'Safely renumbers existing units in a site so apartment numbers continue across floors. Unit IDs, residents, links, and event logs are preserved.';
