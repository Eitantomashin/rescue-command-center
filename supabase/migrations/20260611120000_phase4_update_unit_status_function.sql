create or replace function public.update_unit_status(
  p_unit_id uuid,
  p_new_status_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
begin
  select * into v_unit
  from public.units
  where id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'update_unit_status');

  if not v_unit.is_active then
    raise exception 'Inactive units cannot receive operational status changes';
  end if;

  select * into v_previous_status
  from public.status_types
  where id = v_unit.status_id;

  select * into v_new_status
  from public.status_types
  where id = p_new_status_id
    and category = 'unit'
    and (incident_id = v_unit.incident_id or incident_id is null);

  if not found then
    raise exception 'New status % is not valid for this unit incident', p_new_status_id;
  end if;

  if v_new_status.status_key = 'fully_cleared' then
    raise exception 'Use set_unit_clearance to mark a unit as fully cleared';
  end if;

  perform set_config('rcc.allow_unit_operational_write', 'on', true);

  update public.units
  set
    status_id = p_new_status_id,
    updated_by = auth.uid()
  where id = p_unit_id;

  perform set_config('rcc.allow_unit_operational_write', 'off', true);

  perform public.create_event_log(
    v_unit.incident_id,
    'unit_status_changed',
    'Unit Status Changed',
    p_notes,
    'status_change',
    'normal',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'unit_number', v_unit.unit_number,
      'previous_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key,
      'previous_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label
    )
  );
end;
$$;

comment on function public.update_unit_status(uuid, uuid, text)
  is 'Changes a Unit operational status through the approved write path and creates an EventLog record.';

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
      and (incident_id = v_unit.incident_id or incident_id is null);

    if not found then
      raise exception 'Resident status % is not valid for this incident', p_status_id;
    end if;
  end if;

  insert into public.unit_residents (
    incident_id,
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

comment on function public.create_unit_resident(uuid, text, text, integer, text, uuid, text)
  is 'Creates a unit resident and an EventLog record in the same database operation.';

create or replace function public.create_operational_person(
  p_unit_id uuid,
  p_status_id uuid,
  p_operational_number integer default null,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
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
  v_operational_number integer := p_operational_number;
  v_person_id uuid;
begin
  if p_age is not null and p_age < 0 then
    raise exception 'Person age cannot be negative';
  end if;

  if v_operational_number is not null and v_operational_number <= 0 then
    raise exception 'Operational number must be positive';
  end if;

  select * into v_unit
  from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'create_operational_person');

  if not v_unit.is_active then
    raise exception 'Cannot add operational persons to inactive units';
  end if;

  select * into v_status
  from public.status_types
  where id = p_status_id
    and category = 'person'
    and (incident_id = v_unit.incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', p_status_id;
  end if;

  if v_operational_number is null then
    v_operational_number := public.next_operational_number(v_unit.incident_id);
  end if;

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
    v_unit.incident_id,
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    v_operational_number,
    nullif(btrim(coalesce(p_first_name, '')), ''),
    nullif(btrim(coalesce(p_last_name, '')), ''),
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    p_status_id,
    'ui',
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_person_id;

  perform public.create_event_log(
    v_unit.incident_id,
    'person_created',
    'Operational Person Created',
    p_notes,
    'operational',
    'normal',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    v_person_id,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'operational_number', v_operational_number,
      'unit_number', v_unit.unit_number,
      'first_name', p_first_name,
      'last_name', p_last_name,
      'person_status_key', v_status.status_key,
      'person_status_label', v_status.hebrew_label
    )
  );

  return v_person_id;
end;
$$;

comment on function public.create_operational_person(uuid, uuid, integer, text, text, integer, text, text)
  is 'Creates an operational Person card and an EventLog record in the same database operation.';
