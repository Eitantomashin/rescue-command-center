create or replace function public.open_resident_person_card(
  p_resident_id uuid,
  p_status_id uuid default null,
  p_operational_number integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_person_status public.status_types%rowtype;
  v_person_status_id uuid := p_status_id;
  v_resident_status_id uuid;
  v_operational_number integer := p_operational_number;
  v_person_id uuid;
begin
  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  if not v_resident.is_active then
    raise exception 'Inactive residents cannot be opened as operational person cards';
  end if;

  if v_resident.linked_person_id is not null then
    return v_resident.linked_person_id;
  end if;

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  if not found then
    raise exception 'Resident unit % does not exist', v_resident.unit_id;
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'open_resident_person_card');

  if not v_unit.is_active then
    raise exception 'Cannot open person cards from residents in inactive units';
  end if;

  if v_person_status_id is null then
    v_person_status_id := public.get_status_id('person', 'missing', v_resident.incident_id);

    if v_person_status_id is null then
      raise exception 'Default missing person status is not configured';
    end if;
  end if;

  select * into v_person_status
  from public.status_types
  where id = v_person_status_id
    and category = 'person'
    and (incident_id = v_resident.incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', v_person_status_id;
  end if;

  if v_operational_number is not null and v_operational_number <= 0 then
    raise exception 'Operational number must be positive';
  end if;

  if v_operational_number is null then
    v_operational_number := public.next_operational_number(v_resident.incident_id);
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
    v_resident.incident_id,
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    v_operational_number,
    v_resident.first_name,
    v_resident.last_name,
    v_resident.age,
    v_resident.phone,
    v_person_status.id,
    'resident',
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_person_id;

  v_resident_status_id := public.get_status_id('resident', 'linked_to_person', v_resident.incident_id);

  update public.unit_residents
  set
    linked_person_id = v_person_id,
    status_id = coalesce(v_resident_status_id, status_id),
    updated_by = auth.uid()
  where id = v_resident.id;

  perform public.create_event_log(
    v_resident.incident_id,
    'person_linked_to_resident',
    'קישור אדם לדייר',
    '#' || v_operational_number || ' קושר ל' || coalesce(
      nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
      'דייר ללא שם'
    ),
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
      'resident_id', v_resident.id,
      'operational_number', v_operational_number,
      'unit_number', v_unit.unit_number,
      'first_name', v_resident.first_name,
      'last_name', v_resident.last_name,
      'person_status_key', v_person_status.status_key,
      'person_status_label', v_person_status.hebrew_label
    )
  );

  return v_person_id;
end;
$$;

comment on function public.open_resident_person_card(uuid, uuid, integer, text)
  is 'Creates and links an operational Person card from a UnitResident when one does not already exist, and writes an EventLog record.';
