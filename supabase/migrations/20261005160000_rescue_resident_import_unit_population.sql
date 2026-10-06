-- Restore the last known-good Rescue population methodology; Search remains post-October.

-- Keep site wizard creation and audit event logs in one authorized RPC transaction.
-- Covers both Rescue Sites and Search Sites because Search Site creation wraps create_site_from_wizard.

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
  v_zone_sequence integer;
  v_resident_index integer;
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
  v_is_search_site boolean := coalesce(current_setting('rcc.site_creation_type', true), '') = 'search_site';
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
  if not v_is_search_site then
    v_resident_status_id := public.get_status_id('resident', 'missing', p_incident_id);
  end if;
  v_team_status_id := public.get_status_id('team', 'assigned', p_incident_id);

  if v_site_status_id is null or v_floor_status_id is null or v_unit_status_id is null
    or (not v_is_search_site and v_resident_status_id is null) or v_team_status_id is null
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
          case when v_is_search_site then 0 else v_average_potential end,
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

        if not v_is_search_site then
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
        end if;      end loop;
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

-- The Search wrapper marks its transaction before invoking the shared creator.
-- That preserves the post-October Search model while direct wizard creation
-- restores the established Rescue population model.
create or replace function public.create_search_site_from_wizard(
  p_incident_id uuid, p_site_name text, p_street text, p_house_number text,
  p_city text default null, p_structure_type text default null,
  p_structure_description text default null, p_damage_severity text default null,
  p_image_name text default null, p_image_data_url text default null,
  p_lowest_level integer default 0, p_highest_level integer default 0,
  p_zones jsonb default '[]'::jsonb, p_teams jsonb default '[]'::jsonb,
  p_parent_site_id uuid default null, p_search_reason text default null,
  p_search_priority text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_site_id uuid;
  v_parent_site public.sites%rowtype;
begin
  if p_parent_site_id is not null then
    select * into v_parent_site from public.sites
    where id = p_parent_site_id and incident_id = p_incident_id
      and site_type = 'rescue_site' and is_active = true;
    if not found then raise exception 'Parent rescue site does not exist in this incident'; end if;
  end if;
  perform set_config('rcc.site_creation_type', 'search_site', true);
  v_site_id := public.create_site_from_wizard(p_incident_id, p_site_name, p_street, p_house_number, p_city, p_structure_type, p_structure_description, p_damage_severity, p_image_name, p_image_data_url, p_lowest_level, p_highest_level, p_zones, p_teams);
  perform set_config('rcc.site_creation_type', '', true);
  perform set_config('rcc.allow_structure_write', 'on', true);
  update public.sites set site_type = 'search_site', parent_site_id = p_parent_site_id,
    search_status = 'not_started', search_reason = nullif(btrim(coalesce(p_search_reason, '')), ''),
    search_priority = nullif(btrim(coalesce(p_search_priority, '')), ''), search_completed_at = null,
    updated_by = public.current_actor_id() where id = v_site_id;
  perform set_config('rcc.allow_structure_write', 'off', true);
  return v_site_id;
exception when others then
  perform set_config('rcc.site_creation_type', '', true);
  perform set_config('rcc.allow_structure_write', 'off', true);
  raise;
end;
$$;

-- Reconcile a Rescue resident import into its historic in-unit population.
-- It has no person/operational-number side effects and preserves linked data.
create or replace function public.import_site_residents(p_site_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_site public.sites%rowtype; v_actor uuid := public.current_actor_id(); v_actor_name text;
  v_row jsonb; v_ordinal integer; v_floor text; v_apartment text; v_imported_id uuid; v_unit_id uuid;
  v_unit_count integer; v_resident_id uuid; v_status_id uuid; v_count integer := 0;
  v_prior integer; v_matched integer := 0; v_unmatched integer := 0; v_affected_units uuid[] := array[]::uuid[];
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found or not v_site.is_active or coalesce(v_site.is_cancelled, false) then raise exception 'Active site was not found'; end if;
  perform public.assert_edit_operational_data(v_site.incident_id);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Resident rows must be an array'; end if;
  select coalesce(nullif(btrim(display_name), ''), id::text) into v_actor_name from public.profiles where id = v_actor;
  if coalesce(v_site.site_type, 'rescue_site') = 'rescue_site' then
    v_status_id := public.get_status_id('resident', 'missing', v_site.incident_id);
    if v_status_id is null then raise exception 'Default resident status is unavailable'; end if;
  end if;
  for v_row, v_ordinal in select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality loop
    if nullif(btrim(coalesce(v_row->>'first_name','')), '') is null and nullif(btrim(coalesce(v_row->>'last_name','')), '') is null then continue; end if;
    v_floor := nullif(btrim(coalesce(v_row->>'floor','')), '');
    v_apartment := nullif(btrim(coalesce(v_row->>'apartment','')), '');
    -- A Rescue re-import reuses its staging identity (including duplicate-row
    -- ordinal) instead of creating another operational resident.
    v_imported_id := null;
    if coalesce(v_site.site_type, 'rescue_site') = 'rescue_site' then
      select count(*) into v_prior from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
      where x.ordinality < v_ordinal
        and lower(coalesce(btrim(x.value->>'first_name'),''))=lower(coalesce(btrim(v_row->>'first_name'),''))
        and lower(coalesce(btrim(x.value->>'last_name'),''))=lower(coalesce(btrim(v_row->>'last_name'),''))
        and coalesce(x.value->>'gender','unknown')=coalesce(v_row->>'gender','unknown')
        and regexp_replace(lower(coalesce(btrim(x.value->>'floor'),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_floor,'')), '\s+', '', 'g')
        and regexp_replace(lower(coalesce(btrim(x.value->>'apartment'),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_apartment,'')), '\s+', '', 'g');
      select i.id into v_imported_id from public.imported_site_residents i
      where i.incident_id=v_site.incident_id and i.site_id=v_site.id and i.is_active
        and lower(coalesce(btrim(i.first_name),''))=lower(coalesce(btrim(v_row->>'first_name'),''))
        and lower(coalesce(btrim(i.last_name),''))=lower(coalesce(btrim(v_row->>'last_name'),''))
        and coalesce(i.gender,'unknown')=case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end
        and regexp_replace(lower(coalesce(btrim(i.floor),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_floor,'')), '\s+', '', 'g')
        and regexp_replace(lower(coalesce(btrim(i.apartment),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_apartment,'')), '\s+', '', 'g')
      order by i.created_at,i.id offset v_prior limit 1;
    end if;
    if v_imported_id is null then
      insert into public.imported_site_residents(incident_id,site_id,floor,apartment,first_name,last_name,gender,age,phone,notes,created_by)
      values(v_site.incident_id,v_site.id,v_floor,v_apartment,nullif(btrim(coalesce(v_row->>'first_name','')),''),nullif(btrim(coalesce(v_row->>'last_name','')),''),case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,nullif(btrim(coalesce(v_row->>'phone','')),''),nullif(btrim(coalesce(v_row->>'notes','')),''),v_actor)
      returning id into v_imported_id;
    else
      update public.imported_site_residents set age=case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,phone=nullif(btrim(coalesce(v_row->>'phone','')),''),notes=nullif(btrim(coalesce(v_row->>'notes','')),'') where id=v_imported_id;
    end if;
    v_count := v_count + 1;
    if coalesce(v_site.site_type,'rescue_site') <> 'rescue_site' or v_floor is null or v_apartment is null then continue; end if;
    select count(*), min(u.id) into v_unit_count, v_unit_id
    from public.units u join public.floors f on f.id=u.floor_id
    where u.incident_id=v_site.incident_id and u.site_id=v_site.id and u.is_active and f.is_active
      and regexp_replace(lower(btrim(f.floor_number::text)), '\s+', '', 'g')=regexp_replace(lower(v_floor), '\s+', '', 'g')
      and regexp_replace(lower(btrim(u.unit_number)), '\s+', '', 'g')=regexp_replace(lower(v_apartment), '\s+', '', 'g');
    if v_unit_count <> 1 then v_unmatched := v_unmatched + 1; continue; end if;
    select ur.id into v_resident_id from public.imported_site_residents i join public.unit_residents ur on ur.id=i.linked_resident_id
    where i.id=v_imported_id and ur.unit_id=v_unit_id and ur.is_active for update of ur;
    -- An untouched historical placeholder is the only unlinked record import may replace.
    if not found then select ur.id into v_resident_id from public.unit_residents ur
    join public.status_types st on st.id=ur.status_id
    where ur.unit_id=v_unit_id and ur.is_active and ur.notes='placeholder'
      and ur.first_name ~ '^דייר [0-9]+$' and ur.last_name is null
      and coalesce(ur.gender,'unknown')='unknown' and ur.age is null and ur.phone is null
      and ur.linked_person_id is null and coalesce(ur.requires_medical_evacuation,false)=false
      and st.category='resident' and st.status_key='missing'
    order by ur.created_at,ur.id limit 1 for update skip locked; end if;
    if v_resident_id is null then
      insert into public.unit_residents(incident_id,site_id,unit_id,first_name,last_name,gender,age,phone,status_id,notes,created_by,updated_by)
      values(v_site.incident_id,v_site.id,v_unit_id,nullif(btrim(coalesce(v_row->>'first_name','')),''),nullif(btrim(coalesce(v_row->>'last_name','')),''),case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,nullif(btrim(coalesce(v_row->>'phone','')),''),v_status_id,nullif(btrim(coalesce(v_row->>'notes','')),''),v_actor,v_actor)
      returning id into v_resident_id;
    elsif exists(select 1 from public.unit_residents ur where ur.id=v_resident_id and ur.notes='placeholder' and ur.linked_person_id is null) then
      update public.unit_residents set first_name=nullif(btrim(coalesce(v_row->>'first_name','')),''),last_name=nullif(btrim(coalesce(v_row->>'last_name','')),''),gender=case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,age=case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,phone=nullif(btrim(coalesce(v_row->>'phone','')),''),notes=nullif(btrim(coalesce(v_row->>'notes','')),''),updated_by=v_actor where id=v_resident_id;
    end if;
    update public.imported_site_residents set linked_resident_id=v_resident_id,linked_unit_id=v_unit_id,linked_at=now(),linked_by=v_actor where id=v_imported_id;
    v_affected_units := array_append(v_affected_units,v_unit_id); v_matched := v_matched + 1;
  end loop;
  -- A new import is the current estimate only for resolved units; meaningful and linked residents survive.
  update public.unit_residents ur set is_active=false,updated_by=v_actor,updated_at=now()
  where ur.unit_id=any(v_affected_units) and ur.is_active and ur.notes='placeholder' and ur.first_name ~ '^דייר [0-9]+$'
    and ur.last_name is null and coalesce(ur.gender,'unknown')='unknown' and ur.age is null and ur.phone is null
    and ur.linked_person_id is null and coalesce(ur.requires_medical_evacuation,false)=false
    and exists(select 1 from public.status_types st where st.id=ur.status_id and st.category='resident' and st.status_key='missing');
  update public.units u set known_people_count=(select count(*) from public.unit_residents ur where ur.unit_id=u.id and ur.is_active),updated_by=v_actor,updated_at=now() where u.id=any(v_affected_units);
  perform set_config('rcc.allow_event_log_insert','on',true);
  insert into public.event_logs(incident_id,site_id,log_type,category,reported_at,source_type,source_name,title,description,importance,metadata,created_by)
  values(v_site.incident_id,v_site.id,'site_resident_list_imported','operational',now(),'system',v_actor_name,'רשימת דיירים נטענה','רשימת דיירים נטענה לאתר '||coalesce(v_site.name,v_site.street||' '||v_site.house_number)||' על ידי '||coalesce(v_actor_name,'משתמש לא ידוע')||'.','important',jsonb_build_object('actor_id',v_actor,'actor_name',v_actor_name,'site_id',v_site.id,'imported_count',v_count,'matched_unit_residents_count',v_matched,'unmatched_unit_residents_count',v_unmatched),v_actor);
  perform set_config('rcc.allow_event_log_insert','off',true);
  return v_count;
exception when others then
  perform set_config('rcc.allow_event_log_insert','off',true); raise;
end;
$$;
revoke all on function public.import_site_residents(uuid,jsonb) from public, anon;
grant execute on function public.import_site_residents(uuid,jsonb) to authenticated;

comment on function public.create_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb)
  is 'Creates a complete operational site from the Phase 6A wizard. Apartments are numbered continuously; non-apartment zones are numbered per floor and zone type.';


revoke all on function public.create_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.create_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb) to authenticated;
