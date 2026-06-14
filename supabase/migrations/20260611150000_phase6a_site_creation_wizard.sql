-- Phase 6A site creation wizard foundation.
--
-- Adds operational site/zone metadata and a function that creates a complete
-- site from a wizard payload: site, levels, zones/units, resident placeholders,
-- team assignments, and immutable EventLog rows.

alter table public.sites
  add column if not exists structure_type text,
  add column if not exists structure_description text,
  add column if not exists damage_severity text,
  add column if not exists image_name text,
  add column if not exists image_data_url text;

alter table public.sites
  drop constraint if exists sites_structure_type_check,
  add constraint sites_structure_type_check
    check (
      structure_type is null
      or structure_type in ('residential', 'office', 'commercial', 'mixed', 'school', 'medical', 'other')
    );

alter table public.sites
  drop constraint if exists sites_damage_severity_check,
  add constraint sites_damage_severity_check
    check (
      damage_severity is null
      or damage_severity in ('light', 'medium', 'heavy', 'collapse')
    );

alter table public.units
  add column if not exists zone_name text,
  add column if not exists zone_type text,
  add column if not exists zone_group_key text,
  add column if not exists zone_sequence integer,
  add column if not exists expected_occupants integer;

alter table public.units
  drop constraint if exists units_zone_type_check,
  add constraint units_zone_type_check
    check (
      zone_type is null
      or zone_type in (
        'apartment',
        'store',
        'office',
        'parking_area',
        'lobby',
        'shelter',
        'warehouse',
        'machine_room',
        'commercial_area',
        'other'
      )
    );

alter table public.units
  drop constraint if exists units_expected_occupants_check,
  add constraint units_expected_occupants_check
    check (expected_occupants is null or expected_occupants >= 0);

alter table public.teams
  add column if not exists phone text;

create or replace function public.prevent_site_initial_potential_change()
returns trigger
language plpgsql
as $$
begin
  if old.initial_potential is distinct from new.initial_potential then
    raise exception 'Initial potential is immutable after site creation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_site_initial_potential_change on public.sites;

create trigger trg_prevent_site_initial_potential_change
  before update of initial_potential on public.sites
  for each row
  execute function public.prevent_site_initial_potential_change();

create or replace function public.next_site_number(p_incident_id uuid)
returns integer
language sql
stable
as $$
  select coalesce(max(site_number), 0) + 1
  from public.sites
  where incident_id = p_incident_id;
$$;

create or replace function public.create_site_from_wizard(
  p_incident_id uuid,
  p_site_name text,
  p_street text,
  p_house_number text,
  p_city text default null,
  p_structure_type text default null,
  p_structure_description text default null,
  p_damage_severity text default null,
  p_image_name text default null,
  p_image_data_url text default null,
  p_lowest_level integer default 0,
  p_highest_level integer default 0,
  p_zones jsonb default '[]'::jsonb,
  p_teams jsonb default '[]'::jsonb
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
  v_site_number integer;
  v_site_status_id uuid;
  v_floor_status_id uuid;
  v_unit_status_id uuid;
  v_resident_status_id uuid;
  v_team_status_id uuid;
  v_level integer;
  v_zone jsonb;
  v_zone_level integer;
  v_zone_name text;
  v_zone_type text;
  v_quantity integer;
  v_average_potential integer;
  v_zone_index integer;
  v_resident_index integer;
  v_total_units integer := 0;
  v_initial_potential integer := 0;
  v_unit_number integer := 0;
  v_team jsonb;
  v_team_number integer;
  v_team_id uuid;
  v_team_count integer := 0;
  v_floors_count integer;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  perform public.assert_incident_writable(p_incident_id, 'create_site_from_wizard');

  if nullif(btrim(coalesce(p_street, '')), '') is null then
    raise exception 'Street is required';
  end if;

  if nullif(btrim(coalesce(p_house_number, '')), '') is null then
    raise exception 'House number is required';
  end if;

  if p_lowest_level is null or p_highest_level is null or p_lowest_level > p_highest_level then
    raise exception 'Lowest level must be lower than or equal to highest level';
  end if;

  if p_structure_type is not null
    and p_structure_type not in ('residential', 'office', 'commercial', 'mixed', 'school', 'medical', 'other')
  then
    raise exception 'Invalid structure type %', p_structure_type;
  end if;

  if p_damage_severity is not null
    and p_damage_severity not in ('light', 'medium', 'heavy', 'collapse')
  then
    raise exception 'Invalid damage severity %', p_damage_severity;
  end if;

  if jsonb_typeof(coalesce(p_zones, '[]'::jsonb)) <> 'array' then
    raise exception 'Zones payload must be an array';
  end if;

  if jsonb_array_length(coalesce(p_zones, '[]'::jsonb)) = 0 then
    raise exception 'At least one zone is required';
  end if;

  if jsonb_typeof(coalesce(p_teams, '[]'::jsonb)) <> 'array' then
    raise exception 'Teams payload must be an array';
  end if;

  v_site_status_id := public.get_status_id('site', 'created', p_incident_id);
  v_floor_status_id := public.get_status_id('floor', 'active', p_incident_id);
  v_unit_status_id := public.get_status_id('unit', 'unknown', p_incident_id);
  v_resident_status_id := public.get_status_id('resident', 'missing', p_incident_id);
  v_team_status_id := public.get_status_id('team', 'assigned', p_incident_id);

  if v_site_status_id is null or v_floor_status_id is null or v_unit_status_id is null
    or v_resident_status_id is null or v_team_status_id is null
  then
    raise exception 'Default statuses for site setup are missing';
  end if;

  for v_zone in select value from jsonb_array_elements(p_zones) loop
    v_zone_level := (v_zone->>'level')::integer;
    v_zone_name := nullif(btrim(coalesce(v_zone->>'name', '')), '');
    v_zone_type := nullif(btrim(coalesce(v_zone->>'type', '')), '');
    v_quantity := coalesce((v_zone->>'quantity')::integer, 0);
    v_average_potential := coalesce((v_zone->>'averagePotential')::integer, 0);

    if v_zone_level < p_lowest_level or v_zone_level > p_highest_level then
      raise exception 'Zone level % is outside configured site levels', v_zone_level;
    end if;

    if v_zone_name is null then
      raise exception 'Zone name is required';
    end if;

    if v_zone_type not in (
      'apartment',
      'store',
      'office',
      'parking_area',
      'lobby',
      'shelter',
      'warehouse',
      'machine_room',
      'commercial_area',
      'other'
    ) then
      raise exception 'Invalid zone type %', v_zone_type;
    end if;

    if v_quantity <= 0 or v_average_potential < 0 then
      raise exception 'Zone quantity must be positive and potential cannot be negative';
    end if;

    v_total_units := v_total_units + v_quantity;
    v_initial_potential := v_initial_potential + (v_quantity * v_average_potential);
  end loop;

  v_floors_count := p_highest_level - p_lowest_level + 1;
  v_site_number := public.next_site_number(p_incident_id);

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
    initial_potential,
    updated_potential,
    status_id,
    structure_type,
    structure_description,
    damage_severity,
    image_name,
    image_data_url,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_site_number,
    nullif(btrim(coalesce(p_site_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    btrim(p_street),
    btrim(p_house_number),
    v_floors_count,
    0,
    0,
    0,
    v_initial_potential,
    v_initial_potential,
    v_site_status_id,
    p_structure_type,
    nullif(btrim(coalesce(p_structure_description, '')), ''),
    p_damage_severity,
    nullif(btrim(coalesce(p_image_name, '')), ''),
    nullif(btrim(coalesce(p_image_data_url, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_site_id;

  for v_level in p_lowest_level..p_highest_level loop
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
      v_level,
      0,
      v_floor_status_id,
      public.current_actor_id(),
      public.current_actor_id()
    )
    returning id into v_floor_id;

    for v_zone in
      select value
      from jsonb_array_elements(p_zones)
      where (value->>'level')::integer = v_level
    loop
      v_zone_name := nullif(btrim(coalesce(v_zone->>'name', '')), '');
      v_zone_type := nullif(btrim(coalesce(v_zone->>'type', '')), '');
      v_quantity := coalesce((v_zone->>'quantity')::integer, 0);
      v_average_potential := coalesce((v_zone->>'averagePotential')::integer, 0);

      for v_zone_index in 1..v_quantity loop
        v_unit_number := v_unit_number + 1;

        insert into public.units (
          incident_id,
          site_id,
          floor_id,
          unit_number,
          family_name,
          known_people_count,
          status_id,
          zone_name,
          zone_type,
          zone_group_key,
          zone_sequence,
          expected_occupants,
          notes,
          created_by,
          updated_by
        )
        values (
          p_incident_id,
          v_site_id,
          v_floor_id,
          v_unit_number::text,
          case when v_zone_type = 'apartment' then v_zone_name else null end,
          v_average_potential,
          v_unit_status_id,
          case when v_quantity = 1 then v_zone_name else v_zone_name || ' ' || v_zone_index end,
          v_zone_type,
          v_level || ':' || v_zone_name || ':' || v_zone_type,
          v_zone_index,
          v_average_potential,
          v_zone_name,
          public.current_actor_id(),
          public.current_actor_id()
        )
        returning id into v_unit_id;

        for v_resident_index in 1..v_average_potential loop
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
            'דייר ' || v_resident_index,
            v_resident_status_id,
            'placeholder',
            public.current_actor_id(),
            public.current_actor_id()
          );
        end loop;
      end loop;
    end loop;

    update public.floors
    set
      units_count = (
        select count(*)::integer
        from public.units
        where floor_id = v_floor_id
          and is_active = true
      ),
      updated_by = public.current_actor_id()
    where id = v_floor_id;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  for v_team in select value from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) loop
    v_team_number := coalesce((v_team->>'teamNumber')::integer, 0);

    if v_team_number <= 0 then
      raise exception 'Team number must be positive';
    end if;

    insert into public.teams (
      incident_id,
      team_number,
      name,
      commander_name,
      phone,
      personnel_count,
      status_id,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_incident_id,
      v_team_number,
      case when v_team_number = 9 then 'צוות 9 אוכלוסייה' else 'צוות ' || v_team_number end,
      nullif(btrim(coalesce(v_team->>'leader', '')), ''),
      nullif(btrim(coalesce(v_team->>'phone', '')), ''),
      nullif(v_team->>'rescuers', '')::integer,
      v_team_status_id,
      true,
      public.current_actor_id(),
      public.current_actor_id()
    )
    on conflict (incident_id, team_number) do update
      set
        commander_name = excluded.commander_name,
        phone = excluded.phone,
        personnel_count = excluded.personnel_count,
        status_id = excluded.status_id,
        is_active = true,
        updated_by = public.current_actor_id()
    returning id into v_team_id;

    if not exists (
      select 1
      from public.team_site_assignments tsa
      where tsa.incident_id = p_incident_id
        and tsa.team_id = v_team_id
        and tsa.site_id = v_site_id
        and tsa.assignment_status = 'active'
    ) then
      insert into public.team_site_assignments (
        incident_id,
        team_id,
        site_id,
        assignment_status,
        notes,
        created_by,
        updated_by
      )
      values (
        p_incident_id,
        v_team_id,
        v_site_id,
        'active',
        'שיוך בעת יצירת אתר',
        public.current_actor_id(),
        public.current_actor_id()
      );
    end if;

    v_team_count := v_team_count + 1;
  end loop;

  perform public.create_event_log(
    p_incident_id,
    'site_created_from_wizard',
    'יצירת אתר',
    'אתר ' || v_site_number || ' נוצר דרך אשף הקמת אתר',
    'operational',
    'normal',
    now(),
    v_site_id,
    null,
    null,
    null,
    null,
    'ui',
    null,
    jsonb_build_object(
      'site_id', v_site_id,
      'site_number', v_site_number,
      'structure_type', p_structure_type,
      'damage_severity', p_damage_severity,
      'lowest_level', p_lowest_level,
      'highest_level', p_highest_level,
      'levels_count', v_floors_count,
      'zones_count', jsonb_array_length(p_zones),
      'units_count', v_total_units,
      'initial_potential', v_initial_potential,
      'updated_potential', v_initial_potential
    )
  );

  perform public.create_event_log(
    p_incident_id,
    'site_structure_generated',
    'יצירת מבנה אתר',
    'נוצרו ' || v_floors_count || ' מפלסים, ' || v_total_units || ' אזורים ו-' || v_initial_potential || ' רשומות פוטנציאל',
    'operational',
    'normal',
    now(),
    v_site_id,
    null,
    null,
    null,
    null,
    'system',
    null,
    jsonb_build_object(
      'zones', p_zones,
      'teams', p_teams,
      'teams_assigned', v_team_count
    )
  );

  return v_site_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

comment on function public.create_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb)
  is 'Creates a complete operational site from the Phase 6A wizard, including levels, zones, resident placeholders, team assignments, and immutable EventLog rows.';
