-- Stage 9.1D.2B-1: planning potential is not operational resident population.
-- Preserves the current wizard function except operational initialization.

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
  v_team_status_id uuid;
  v_level integer;
  v_zone jsonb;
  v_zone_level integer;
  v_zone_name text;
  v_zone_type text;
  v_quantity integer;
  v_average_potential integer;
  v_zone_index integer;
  v_zone_sequence integer;
  v_total_units integer := 0;
  v_initial_potential integer := 0;
  v_apartment_number integer := 0;
  v_unit_number text;
  v_unit_zone_name text;
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

  if jsonb_array_length(coalesce(p_teams, '[]'::jsonb)) = 0 then
    raise exception 'At least one team is required';
  end if;

  v_site_status_id := public.get_status_id('site', 'created', p_incident_id);
  v_floor_status_id := public.get_status_id('floor', 'active', p_incident_id);
  v_unit_status_id := public.get_status_id('unit', 'unknown', p_incident_id);
  v_team_status_id := public.get_status_id('team', 'assigned', p_incident_id);

  if v_site_status_id is null or v_floor_status_id is null or v_unit_status_id is null
    or v_team_status_id is null
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
        if v_zone_type = 'apartment' then
          v_apartment_number := v_apartment_number + 1;
          v_zone_sequence := v_apartment_number;
          v_unit_number := v_apartment_number::text;
          v_unit_zone_name := null;
        else
          select count(*)::integer + 1
          into v_zone_sequence
          from public.units
          where floor_id = v_floor_id
            and zone_type = v_zone_type;

          v_unit_number := v_zone_type || '-' || v_zone_sequence;
          v_unit_zone_name := v_zone_name;
        end if;

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
          v_unit_number,
          null,
          0,
          v_unit_status_id,
          v_unit_zone_name,
          v_zone_type,
          v_level || ':' || v_zone_name || ':' || v_zone_type,
          v_zone_sequence,
          v_average_potential,
          v_zone_name,
          public.current_actor_id(),
          public.current_actor_id()
        )
        returning id into v_unit_id;

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

  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
    team_id,
    log_type,
    category,
    reported_at,
    source_type,
    source_name,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    p_incident_id,
    v_site_id,
    null,
    null,
    null,
    null,
    'site_created_from_wizard',
    'operational',
    now(),
    'ui',
    null,
    'יצירת אתר',
    'אתר ' || v_site_number || ' נוצר דרך אשף הקמת אתר',
    'normal',
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
      'updated_potential', v_initial_potential,
      'numbering_model', 'phase6a_continuous_apartments_local_zones'
    ),
    public.current_actor_id()
  );

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
    team_id,
    log_type,
    category,
    reported_at,
    source_type,
    source_name,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    p_incident_id,
    v_site_id,
    null,
    null,
    null,
    null,
    'site_structure_generated',
    'operational',
    now(),
    'system',
    null,
    'יצירת מבנה אתר',
    'נוצרו ' || v_floors_count || ' מפלסים, ' || v_total_units || ' אזורים ו-' || v_initial_potential || ' רשומות פוטנציאל',
    'normal',
    jsonb_build_object(
      'zones', p_zones,
      'teams', p_teams,
      'teams_assigned', v_team_count,
      'numbering_model', 'phase6a_continuous_apartments_local_zones'
    ),
    public.current_actor_id()
  );

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_site_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    perform set_config('rcc.allow_event_log_insert', 'off', true);
    raise;
end;
$$;

-- Stage 9.1D.2B-2: structural planning does not create operational residents.
-- These replace the latest active structural creators while retaining their current
-- permissions, locking, numbering, history, and event logging behavior.

create or replace function public.add_apartment_to_floor(
  p_floor_id uuid,
  p_position integer default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor public.floors%rowtype;
  v_site public.sites%rowtype;
  v_position integer;
  v_new_unit public.units%rowtype;
begin
  select * into v_floor from public.floors where id = p_floor_id;
  if not found then
    raise exception 'Floor does not exist';
  end if;

  select * into v_site from public.sites where id = v_floor.site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_edit_operational_data(v_floor.incident_id);

  if v_site.lifecycle_status = 'closed' or exists (
    select 1 from public.incidents i
    where i.id = v_floor.incident_id
      and (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  ) then
    raise exception 'Cannot change structure for a closed or archived incident/site';
  end if;

  perform public.dynamic_structure_release_inactive_site_numbers(v_floor.site_id);

  if p_position is null then
    select coalesce(max(public.dynamic_structure_apartment_base(u.unit_number)), 0) + 1 into v_position
    from public.units u
    join public.floors f on f.id = u.floor_id
    where u.site_id = v_floor.site_id
      and u.is_active = true
      and coalesce(u.zone_type, 'apartment') = 'apartment';
  else
    v_position := greatest(1, p_position);
  end if;

  perform public.renumber_site_apartments_from(
    v_floor.site_id,
    v_floor.floor_number,
    v_position,
    v_position + 1,
    p_reason
  );

  perform set_config('rcc.allow_structure_write', 'on', true);

  insert into public.units (
    incident_id,
    site_id,
    floor_id,
    unit_number,
    known_people_count,
    is_active,
    zone_type,
    zone_name,
    zone_sequence,
    expected_occupants,
    structure_change_type,
    structure_changed_at,
    structure_changed_by,
    structure_change_reason,
    created_by,
    updated_by
  )
  values (
    v_floor.incident_id,
    v_floor.site_id,
    v_floor.id,
    v_position::text,
    0,
    true,
    'apartment',
    U&'\05D3\05D9\05E8\05D4',
    v_position,
    5,
    'apartment_added',
    now(),
    public.current_actor_id(),
    p_reason,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning * into v_new_unit;

  perform set_config('rcc.allow_structure_write', 'off', true);
  perform public.dynamic_structure_record_history(
    v_new_unit,
    'apartment_added',
    null,
    public.dynamic_structure_unit_label(v_new_unit),
    p_reason,
    jsonb_build_object('floor_id', p_floor_id, 'position', v_position, 'default_potential', 5, 'scope', 'site')
  );

  perform public.create_event_log(
    v_new_unit.incident_id,
    'apartment_added',
    U&'\05D4\05D5\05E1\05E4\05EA \05D3\05D9\05E8\05D4',
    U&'\05E0\05D5\05E1\05E4\05D4 \05D3\05D9\05E8\05D4 ' || v_new_unit.unit_number || U&' \05D1\05E7\05D5\05DE\05D4 ' || v_floor.floor_number,
    'operational',
    'important',
    now(),
    v_new_unit.site_id,
    v_new_unit.floor_id,
    v_new_unit.id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object('unit_id', v_new_unit.id, 'floor_number', v_floor.floor_number, 'current_label', v_new_unit.unit_number, 'scope', 'site')
  );

  return v_new_unit.id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.split_apartment_unit(
  p_unit_id uuid,
  p_suffixes text[] default array[U&'\05D0\05F3', U&'\05D1\05F3'],
  p_reason text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_site public.sites%rowtype;
  v_suffix text;
  v_suffixes text[];
  v_base_label text;
  v_new_number text;
  v_created_ids uuid[] := array[]::uuid[];
  v_first boolean := true;
  v_new_unit public.units%rowtype;
  v_keep_count integer;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if not found then
    raise exception 'Unit does not exist';
  end if;

  select * into v_site from public.sites where id = v_unit.site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_edit_operational_data(v_unit.incident_id);

  if coalesce(v_unit.zone_type, 'apartment') <> 'apartment' then
    raise exception 'Only apartments can be split';
  end if;

  if v_site.lifecycle_status = 'closed' or exists (
    select 1 from public.incidents i
    where i.id = v_unit.incident_id
      and (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  ) then
    raise exception 'Cannot change structure for a closed or archived incident/site';
  end if;

  v_suffixes := array(
    select nullif(btrim(item), '')
    from unnest(coalesce(p_suffixes, array[]::text[])) item
    where nullif(btrim(item), '') is not null
  );

  if array_length(v_suffixes, 1) is null or array_length(v_suffixes, 1) < 2 then
    raise exception 'Split requires at least two suffixes';
  end if;

  v_base_label := v_unit.unit_number;
  perform set_config('rcc.allow_structure_write', 'on', true);

  foreach v_suffix in array v_suffixes loop
    v_new_number := v_base_label || v_suffix;

    if v_first then
      update public.units
      set previous_unit_label = coalesce(previous_unit_label, v_base_label),
          original_unit_label = coalesce(original_unit_label, v_base_label),
          unit_number = v_new_number,
          expected_occupants = 2,
          structure_change_type = 'apartment_split',
          structure_changed_at = now(),
          structure_changed_by = public.current_actor_id(),
          structure_change_reason = p_reason,
          updated_by = public.current_actor_id(),
          updated_at = now()
      where id = v_unit.id
      returning * into v_new_unit;

      v_created_ids := array_append(v_created_ids, v_new_unit.id);

      select count(*) into v_keep_count
      from public.unit_residents ur
      where ur.unit_id = v_new_unit.id
        and ur.is_active = true
        and (
          ur.linked_person_id is not null
          or public.dynamic_structure_has_important_resident_data(v_new_unit.id)
        );

      if v_keep_count = 0 then
        update public.unit_residents ur
        set is_active = false,
            notes = coalesce(nullif(ur.notes, ''), 'placeholder') || '; inactive_after_split',
            updated_by = public.current_actor_id(),
            updated_at = now()
        where ur.unit_id = v_new_unit.id
          and ur.is_active = true
          and ur.id not in (
            select id
            from public.unit_residents
            where unit_id = v_new_unit.id and is_active = true
            order by created_at, id
            limit 2
          );
      end if;

      v_first := false;
    else
      insert into public.units (
        incident_id,
        site_id,
        floor_id,
        unit_number,
        previous_unit_label,
        original_unit_label,
        known_people_count,
        is_active,
        zone_type,
        zone_name,
        zone_sequence,
        expected_occupants,
        structure_change_type,
        structure_changed_at,
        structure_changed_by,
        structure_change_reason,
        created_by,
        updated_by
      )
      values (
        v_unit.incident_id,
        v_unit.site_id,
        v_unit.floor_id,
        v_new_number,
        v_base_label,
        v_base_label,
        0,
        true,
        'apartment',
        U&'\05D3\05D9\05E8\05D4',
        v_unit.zone_sequence,
        2,
        'apartment_split',
        now(),
        public.current_actor_id(),
        p_reason,
        public.current_actor_id(),
        public.current_actor_id()
      )
      returning * into v_new_unit;

      v_created_ids := array_append(v_created_ids, v_new_unit.id);
      perform set_config('rcc.allow_structure_write', 'on', true);
    end if;

    perform public.dynamic_structure_record_history(
      v_new_unit,
      'apartment_split',
      U&'\05D3\05D9\05E8\05D4 ' || v_base_label,
      public.dynamic_structure_unit_label(v_new_unit),
      p_reason,
      jsonb_build_object('original_unit_id', p_unit_id, 'base_label', v_base_label, 'suffix', v_suffix)
    );
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_unit.incident_id,
    'apartment_split',
    U&'\05E4\05D9\05E6\05D5\05DC \05D3\05D9\05E8\05D4',
    U&'\05D3\05D9\05E8\05D4 ' || v_base_label || U&' \05E4\05D5\05E6\05DC\05D4 \05DC-' || array_to_string(v_suffixes, ', '),
    'operational',
    'important',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    p_unit_id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object('original_unit_id', p_unit_id, 'base_label', v_base_label, 'suffixes', v_suffixes, 'unit_ids', v_created_ids)
  );

  return v_created_ids;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

-- Stage 9.1D.2B-3: remove only untouched historical structural placeholders.
-- The candidate set is retained by the CTE so only units affected by this cleanup
-- receive an operational known-people-count reconciliation.
with strict_placeholders as materialized (
  select ur.id, ur.unit_id
  from public.unit_residents ur
  join public.status_types st on st.id = ur.status_id
  where ur.is_active = true
    and ur.notes = 'placeholder'
    and ur.first_name ~ '^דייר [0-9]+$'
    and ur.last_name is null
    and ur.gender = 'unknown'
    and ur.age is null
    and ur.phone is null
    and ur.linked_person_id is null
    and coalesce(ur.requires_medical_evacuation, false) = false
    and st.category = 'resident'
    and st.status_key = 'missing'
), deactivated_placeholders as (
  update public.unit_residents ur
  set is_active = false
  from strict_placeholders sp
  where ur.id = sp.id
  returning ur.id, ur.unit_id
), affected_units as materialized (
  select distinct unit_id
  from deactivated_placeholders
), remaining_operational_residents as (
  select
    au.unit_id,
    count(ur.id)::integer as active_resident_count
  from affected_units au
  left join public.unit_residents ur
    on ur.unit_id = au.unit_id
   and ur.is_active = true
   and not exists (
     select 1
     from strict_placeholders sp
     where sp.id = ur.id
   )
  group by au.unit_id
)
update public.units u
set known_people_count = r.active_resident_count
from remaining_operational_residents r
where u.id = r.unit_id
  and u.known_people_count is not null;

-- Stage 9.1D.2B-4: operational scan counts and residents are independent of planning.
create or replace function public.save_search_unit_card(
  p_site_id uuid, p_unit_id uuid, p_known_people_count integer, p_has_apartment_damage boolean default false,
  p_apartment_damage_notes text default null, p_notes text default null, p_residents jsonb default '[]'::jsonb,
  p_deactivate_resident_ids jsonb default '[]'::jsonb, p_action text default 'save'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_site public.sites%rowtype; v_unit public.units%rowtype; v_previous public.site_search_units%rowtype; v_result_id uuid;
  v_resident jsonb; v_resident_id uuid; v_status_key text; v_status_id uuid; v_gender text; v_requires_evacuation boolean;
  v_active_count integer := 0; v_anxiety_count integer := 0; v_physical_count integer := 0; v_deceased_count integer := 0; v_evacuation_count integer := 0;
  v_has_casualties boolean := false; v_had_casualties boolean := false; v_all_clear boolean := false; v_new_status text := 'not_visited';
begin
  if p_known_people_count is not null and (p_known_people_count < 0 or p_known_people_count > 10) then raise exception 'Known people count must be between 0 and 10'; end if;
  if p_action not in ('save','no_answer','clear','complete_casualties') then raise exception 'Invalid search card action'; end if;
  if jsonb_typeof(coalesce(p_residents,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_deactivate_resident_ids,'[]'::jsonb)) <> 'array' then raise exception 'Residents must be arrays'; end if;
  if p_known_people_count is not null and jsonb_array_length(p_residents) <> p_known_people_count then raise exception 'Resident entries must exactly match known people count'; end if;
  select * into v_site from public.sites where id=p_site_id and site_type='search_site'; if not found then raise exception 'Search Site not found'; end if;
  perform public.assert_edit_search_site_data(v_site.incident_id);
  select * into v_unit from public.units where id=p_unit_id and site_id=p_site_id and incident_id=v_site.incident_id for update; if not found then raise exception 'Unit must belong to the selected Search Site'; end if;
  select * into v_previous from public.site_search_units where site_id=p_site_id and unit_id=p_unit_id for update;
  update public.unit_residents ur
  set is_active=false,updated_by=public.current_actor_id()
  from public.status_types st
  where ur.status_id=st.id
    and ur.unit_id=v_unit.id
    and ur.incident_id=v_site.incident_id
    and ur.site_id=v_site.id
    and ur.is_active=true
    and ur.notes='placeholder'
    and ur.first_name ~ '^דייר [0-9]+$'
    and ur.last_name is null
    and ur.gender='unknown'
    and ur.age is null
    and ur.phone is null
    and ur.linked_person_id is null
    and coalesce(ur.requires_medical_evacuation,false)=false
    and st.category='resident'
    and st.status_key='missing';
  v_had_casualties := coalesce(v_previous.search_status='casualties',false) or coalesce(v_previous.casualty_psych,false) or coalesce(v_previous.casualty_body,false) or coalesce(v_previous.medical_evacuation,false) or coalesce(v_previous.casualties_resolved,false)
    or exists (select 1 from public.unit_residents ur join public.status_types st on st.id=ur.status_id where ur.unit_id=v_unit.id and st.category='resident' and st.status_key in ('anxiety_casualty','physical_casualty','medical_evacuation','deceased'));
  for v_resident in select value from jsonb_array_elements(p_residents) loop
    v_resident_id := nullif(v_resident->>'id','')::uuid; v_status_key := coalesce(nullif(v_resident->>'status_key',''),'not_checked');
    if v_status_key='medical_evacuation' then v_status_key := 'physical_casualty'; v_requires_evacuation := true; else v_requires_evacuation := coalesce((v_resident->>'requires_medical_evacuation')::boolean,false); end if;
    v_gender := coalesce(nullif(v_resident->>'gender',''),'unknown');
    if v_status_key not in ('not_checked','resident_clear','anxiety_casualty','physical_casualty','deceased') or v_gender not in ('unknown','male','female') then raise exception 'Invalid resident status or gender'; end if;
    v_requires_evacuation := v_status_key='physical_casualty' and v_requires_evacuation;
    v_status_id := public.get_status_id('resident',v_status_key,v_site.incident_id); if v_status_id is null then raise exception 'Resident status is unavailable'; end if;
    if v_resident_id is null then
      insert into public.unit_residents (incident_id,site_id,unit_id,first_name,last_name,age,phone,status_id,gender,requires_medical_evacuation,notes,created_by,updated_by)
      values (v_site.incident_id,v_site.id,v_unit.id,nullif(btrim(v_resident->>'first_name'),''),nullif(btrim(v_resident->>'last_name'),''),nullif(v_resident->>'age','')::integer,nullif(btrim(v_resident->>'phone'),''),v_status_id,v_gender,v_requires_evacuation,nullif(btrim(v_resident->>'notes'),''),public.current_actor_id(),public.current_actor_id());
    else
      update public.unit_residents set first_name=nullif(btrim(v_resident->>'first_name'),''),last_name=nullif(btrim(v_resident->>'last_name'),''),age=nullif(v_resident->>'age','')::integer,phone=nullif(btrim(v_resident->>'phone'),''),status_id=v_status_id,gender=v_gender,requires_medical_evacuation=v_requires_evacuation,notes=nullif(btrim(v_resident->>'notes'),''),updated_by=public.current_actor_id() where id=v_resident_id and incident_id=v_site.incident_id and site_id=v_site.id and unit_id=v_unit.id and is_active=true;
      if not found then raise exception 'Resident does not belong to this unit'; end if;
    end if;
  end loop;
  update public.unit_residents set is_active=false,updated_by=public.current_actor_id() where id in (select value::text::uuid from jsonb_array_elements_text(p_deactivate_resident_ids)) and incident_id=v_site.incident_id and site_id=v_site.id and unit_id=v_unit.id and is_active=true;
  select count(*),count(*) filter(where st.status_key='anxiety_casualty'),count(*) filter(where st.status_key='physical_casualty'),count(*) filter(where st.status_key='deceased'),count(*) filter(where st.status_key='physical_casualty' and ur.requires_medical_evacuation),coalesce(bool_or(st.status_key in ('anxiety_casualty','physical_casualty','deceased')),false),coalesce(bool_and(st.status_key='resident_clear'),false)
  into v_active_count,v_anxiety_count,v_physical_count,v_deceased_count,v_evacuation_count,v_has_casualties,v_all_clear from public.unit_residents ur join public.status_types st on st.id=ur.status_id where ur.unit_id=v_unit.id and ur.is_active=true;
  if p_known_people_count is not null and v_active_count > p_known_people_count then raise exception 'Reduce residents explicitly before reducing the known people count'; end if;
  if p_action='no_answer' then v_new_status:='no_answer'; elsif v_has_casualties and p_action <> 'complete_casualties' then v_new_status:='casualties'; elsif p_action='clear' then if p_known_people_count is null or (p_known_people_count>0 and (v_active_count<>p_known_people_count or not v_all_clear)) then raise exception 'All known residents must be marked clear before clearance'; end if; if v_had_casualties then raise exception 'Reported casualties require explicit completion'; end if; v_new_status:='clear'; elsif p_action='complete_casualties' then if not(v_has_casualties or v_had_casualties) then raise exception 'No reported casualties require completion'; end if; v_new_status:='completed'; elsif p_known_people_count is not null or jsonb_array_length(p_residents)>0 or coalesce(p_has_apartment_damage,false) or nullif(btrim(coalesce(p_notes,'')),'') is not null then v_new_status:='not_visited'; end if;
  update public.units set known_people_count=p_known_people_count,updated_by=public.current_actor_id() where id=v_unit.id;
  insert into public.site_search_units (incident_id,site_id,unit_id,occupants_count,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,has_apartment_damage,apartment_damage_notes,casualties_resolved,casualties_resolved_at,notes,searched_by,searched_at,completed_at)
  values(v_site.incident_id,v_site.id,v_unit.id,p_known_people_count,v_new_status,v_anxiety_count>0,v_physical_count>0,v_evacuation_count>0,v_anxiety_count,v_physical_count,coalesce(p_has_apartment_damage,false),nullif(btrim(coalesce(p_apartment_damage_notes,'')),''),p_action='complete_casualties',case when p_action='complete_casualties' then now() end,nullif(btrim(coalesce(p_notes,'')),''),public.current_actor_id(),now(),case when v_new_status in ('clear','completed') then now() end)
  on conflict(site_id,unit_id) do update set occupants_count=excluded.occupants_count,search_status=excluded.search_status,casualty_psych=excluded.casualty_psych,casualty_body=excluded.casualty_body,medical_evacuation=excluded.medical_evacuation,anxiety_casualties_count=excluded.anxiety_casualties_count,physical_casualties_count=excluded.physical_casualties_count,has_apartment_damage=excluded.has_apartment_damage,apartment_damage_notes=excluded.apartment_damage_notes,casualties_resolved=excluded.casualties_resolved or public.site_search_units.casualties_resolved,casualties_resolved_at=case when excluded.casualties_resolved then now() else public.site_search_units.casualties_resolved_at end,notes=excluded.notes,searched_by=excluded.searched_by,searched_at=excluded.searched_at,completed_at=excluded.completed_at returning id into v_result_id;
  insert into public.event_logs (incident_id,site_id,floor_id,unit_id,log_type,category,reported_at,source_type,title,importance,metadata,created_by) values(v_site.incident_id,v_site.id,v_unit.floor_id,v_unit.id,'search_unit_card_saved','operational',now(),'system','כרטיס סריקת דירה עודכן',case when v_new_status='casualties' then 'important' else 'normal' end,jsonb_build_object('old_search_status',v_previous.search_status,'new_search_status',v_new_status,'known_people_count',p_known_people_count,'resident_summary',jsonb_build_object('total',v_active_count,'clear',v_active_count-v_anxiety_count-v_physical_count-v_deceased_count,'anxiety',v_anxiety_count,'physical',v_physical_count,'deceased',v_deceased_count,'medical_evacuation',v_evacuation_count),'action',p_action),public.current_actor_id());
  return v_result_id;
end $$;

revoke all on function public.save_search_unit_card(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text) from public;
grant execute on function public.save_search_unit_card(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text) to authenticated;
