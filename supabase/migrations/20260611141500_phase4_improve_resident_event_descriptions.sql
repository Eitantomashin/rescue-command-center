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
  v_status_id uuid;
  v_resident_id uuid;
  v_next_index integer;
  v_first_name text;
  v_last_name text;
  v_notes text;
  v_resident_name text;
  v_description text;
begin
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

  v_status_id := coalesce(p_status_id, public.get_status_id('resident', 'missing', v_unit.incident_id));

  if v_status_id is null then
    raise exception 'Default resident missing status is missing';
  end if;

  select * into v_status
  from public.status_types
  where id = v_status_id
    and category = 'resident'
    and is_active = true
    and (incident_id = v_unit.incident_id or incident_id is null);

  if not found then
    raise exception 'Resident status % is not valid for this incident', v_status_id;
  end if;

  select count(*)::integer + 1 into v_next_index
  from public.unit_residents
  where unit_id = v_unit.id
    and is_active = true;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if v_first_name is null and v_last_name is null then
    v_first_name := 'דייר ' || v_next_index;
    v_notes := coalesce(v_notes, 'placeholder');
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
    v_first_name,
    v_last_name,
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_status.id,
    v_notes,
    auth.uid(),
    auth.uid()
  )
  returning id into v_resident_id;

  v_resident_name := nullif(btrim(concat_ws(' ', v_first_name, v_last_name)), '');
  v_description := case
    when v_resident_name is null or v_resident_name ~ '^דייר [0-9]+$'
    then 'נוצר דייר חדש בדירה ' || v_unit.unit_number
    else 'נוצר דייר ' || v_resident_name
  end;

  perform public.create_event_log(
    v_unit.incident_id,
    'unit_resident_created',
    'יצירת דייר',
    v_description,
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
      'first_name', v_first_name,
      'last_name', v_last_name,
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
  v_status_id uuid;
  v_resident_id uuid;
  v_next_index integer;
  v_first_name text;
  v_last_name text;
  v_resident_name text;
  v_description text;
begin
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

  v_status_id := coalesce(p_status_id, public.get_status_id('resident', 'missing', v_site.incident_id));

  if v_status_id is null then
    raise exception 'Default resident missing status is missing';
  end if;

  select * into v_status
  from public.status_types
  where id = v_status_id
    and category = 'resident'
    and is_active = true
    and (incident_id = v_site.incident_id or incident_id is null);

  if not found then
    raise exception 'Resident status % is not valid for this incident', v_status_id;
  end if;

  select count(*)::integer + 1 into v_next_index
  from public.unit_residents
  where site_id = v_site.id
    and unit_id is null
    and is_active = true;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null and v_last_name is null then
    v_first_name := 'אזור כללי ' || v_next_index;
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
    v_first_name,
    v_last_name,
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_status.id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_resident_id;

  v_resident_name := nullif(btrim(concat_ws(' ', v_first_name, v_last_name)), '');
  v_description := case
    when v_resident_name is null or v_resident_name ~ '^אזור כללי [0-9]+$'
    then 'נוצר דייר חדש באזור כללי'
    else 'נוצר דייר ' || v_resident_name
  end;

  perform public.create_event_log(
    v_site.incident_id,
    'general_area_resident_created',
    'יצירת דייר',
    v_description,
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
      'first_name', v_first_name,
      'last_name', v_last_name,
      'resident_status_key', v_status.status_key,
      'resident_status_label', v_status.hebrew_label
    )
  );

  return v_resident_id;
end;
$$;

create or replace function public.update_unit_resident(
  p_resident_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
  p_status_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_old_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
  v_linked_person public.persons%rowtype;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_unit_number text;
  v_old_name text;
  v_new_name text;
  v_old_is_placeholder boolean;
  v_new_is_real_name boolean;
  v_status_description text;
  v_details_description text;
  v_status_changed boolean;
  v_non_status_changed boolean;
begin
  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  if p_age is not null and p_age < 0 then
    raise exception 'Resident age cannot be negative';
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'update_unit_resident');

  if v_resident.unit_id is not null then
    select * into v_unit
    from public.units
    where id = v_resident.unit_id;

    if not found then
      raise exception 'Resident unit % does not exist', v_resident.unit_id;
    end if;

    v_site_id := v_unit.site_id;
    v_floor_id := v_unit.floor_id;
    v_unit_id := v_unit.id;
    v_unit_number := v_unit.unit_number;
  else
    v_site_id := v_resident.site_id;
    v_floor_id := null;
    v_unit_id := null;
    v_unit_number := null;
  end if;

  if v_resident.status_id is not null then
    select * into v_old_status
    from public.status_types
    where id = v_resident.status_id;
  end if;

  if p_status_id is not null then
    select * into v_new_status
    from public.status_types
    where id = p_status_id
      and category = 'resident'
      and is_active = true
      and (incident_id = v_resident.incident_id or incident_id is null);

    if not found then
      raise exception 'Resident status % is not valid for this incident', p_status_id;
    end if;
  end if;

  if v_resident.linked_person_id is not null then
    select * into v_linked_person
    from public.persons
    where id = v_resident.linked_person_id;
  end if;

  v_old_name := coalesce(
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
    'דייר ללא שם'
  );
  v_new_name := coalesce(
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), ''),
    nullif(btrim(coalesce(p_first_name, '')), ''),
    v_old_name
  );
  v_old_is_placeholder := v_resident.last_name is null
    and coalesce(v_resident.first_name, '') ~ '^דייר [0-9]+$';
  v_new_is_real_name := not (v_new_name ~ '^דייר [0-9]+$' or v_new_name = 'דייר ללא שם');

  v_status_changed := v_resident.status_id is distinct from p_status_id;
  v_non_status_changed :=
    v_resident.first_name is distinct from nullif(btrim(coalesce(p_first_name, '')), '')
    or v_resident.last_name is distinct from nullif(btrim(coalesce(p_last_name, '')), '')
    or v_resident.age is distinct from p_age
    or v_resident.phone is distinct from nullif(btrim(coalesce(p_phone, '')), '')
    or v_resident.notes is distinct from nullif(btrim(coalesce(p_notes, '')), '');

  update public.unit_residents
  set
    first_name = nullif(btrim(coalesce(p_first_name, '')), ''),
    last_name = nullif(btrim(coalesce(p_last_name, '')), ''),
    age = p_age,
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    status_id = p_status_id,
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid()
  where id = v_resident.id;

  if v_status_changed then
    v_status_description := case
      when v_resident.linked_person_id is not null and v_linked_person.id is not null
      then '#' || v_linked_person.operational_number || ' - ' || v_new_name || ': '
      else v_new_name || ': '
    end
    || coalesce(v_old_status.hebrew_label, 'ללא סטטוס')
    || ' → '
    || coalesce(v_new_status.hebrew_label, 'ללא סטטוס');

    perform public.create_event_log(
      v_resident.incident_id,
      'resident_status_changed',
      'שינוי סטטוס דייר',
      v_status_description,
      'status_change',
      'normal',
      now(),
      v_site_id,
      v_floor_id,
      v_unit_id,
      v_resident.linked_person_id,
      null,
      'ui',
      'RCC',
      jsonb_build_object(
        'resident_id', v_resident.id,
        'linked_person_id', v_resident.linked_person_id,
        'old_status_id', v_resident.status_id,
        'new_status_id', p_status_id,
        'old_status_label', v_old_status.hebrew_label,
        'new_status_label', v_new_status.hebrew_label,
        'old_status_key', v_old_status.status_key,
        'new_status_key', v_new_status.status_key
      )
    );
  end if;

  if v_non_status_changed then
    v_details_description := case
      when v_old_is_placeholder and v_new_is_real_name then v_old_name || ' → ' || v_new_name
      else 'עודכנו פרטי הדייר ' || v_new_name
    end;

    if p_age is not null and v_resident.age is distinct from p_age then
      v_details_description := v_details_description || ' (גיל ' || p_age || ')';
    end if;

    perform public.create_event_log(
      v_resident.incident_id,
      'unit_resident_updated',
      'עדכון פרטי דייר',
      v_details_description,
      'operational',
      'normal',
      now(),
      v_site_id,
      v_floor_id,
      v_unit_id,
      v_resident.linked_person_id,
      null,
      'ui',
      'RCC',
      jsonb_build_object(
        'resident_id', v_resident.id,
        'unit_number', v_unit_number,
        'previous_first_name', v_resident.first_name,
        'previous_last_name', v_resident.last_name,
        'new_first_name', p_first_name,
        'new_last_name', p_last_name
      )
    );
  end if;
end;
$$;

create or replace function public.link_operational_number_to_resident(
  p_resident_id uuid,
  p_operational_number integer,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_person_id uuid;
  v_person_status_id uuid;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_resident_name text;
begin
  if p_operational_number is null or p_operational_number <= 0 then
    raise exception 'Operational number must be positive';
  end if;

  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  if not v_resident.is_active then
    raise exception 'Inactive residents cannot be linked to operational persons';
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'link_operational_number_to_resident');

  v_site_id := v_resident.site_id;
  v_floor_id := null;
  v_unit_id := v_resident.unit_id;
  v_resident_name := coalesce(
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
    'דייר ללא שם'
  );

  if v_resident.unit_id is not null then
    select * into v_unit
    from public.units
    where id = v_resident.unit_id;

    if not found then
      raise exception 'Resident unit % does not exist', v_resident.unit_id;
    end if;

    v_site_id := v_unit.site_id;
    v_floor_id := v_unit.floor_id;
    v_unit_id := v_unit.id;
  end if;

  select id into v_person_id
  from public.persons
  where incident_id = v_resident.incident_id
    and operational_number = p_operational_number
    and is_merged = false;

  if v_person_id is null then
    v_person_status_id := public.get_status_id('person', 'missing', v_resident.incident_id);

    if v_person_status_id is null then
      raise exception 'Default person missing status is missing';
    end if;

    perform set_config('rcc.allow_person_operational_write', 'on', true);

    insert into public.persons (
      incident_id,
      site_id,
      floor_id,
      unit_id,
      operational_number,
      first_name,
      last_name,
      age,
      phone,
      current_status_id,
      source,
      notes,
      created_by,
      updated_by
    )
    values (
      v_resident.incident_id,
      v_site_id,
      v_floor_id,
      v_unit_id,
      p_operational_number,
      null,
      null,
      null,
      null,
      v_person_status_id,
      'ui',
      p_reason,
      auth.uid(),
      auth.uid()
    )
    returning id into v_person_id;

    perform set_config('rcc.allow_person_operational_write', 'off', true);

    perform public.create_event_log(
      v_resident.incident_id,
      'operational_person_created_for_resident',
      'יצירת אדם מבצעי לדייר',
      '#' || p_operational_number || ' נוצר עבור ' || v_resident_name,
      'operational',
      'normal',
      now(),
      v_site_id,
      v_floor_id,
      v_unit_id,
      v_person_id,
      null,
      'ui',
      'RCC',
      jsonb_build_object(
        'resident_id', v_resident.id,
        'person_id', v_person_id,
        'operational_number', p_operational_number,
        'reason', p_reason
      )
    );
  end if;

  perform public.link_person_to_resident(
    v_person_id,
    v_resident.id,
    coalesce(p_reason, 'קישור מספר מבצעי לדייר')
  );

  return v_person_id;
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;
