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
  v_person_id uuid;
begin
  if p_unit_id is null then
    raise exception 'Unit is required';
  end if;

  if p_status_id is null then
    raise exception 'Person status is required';
  end if;

  if p_operational_number is null then
    raise exception 'Operational number is required';
  end if;

  if p_operational_number <= 0 then
    raise exception 'Operational number must be positive';
  end if;

  if p_age is not null and p_age < 0 then
    raise exception 'Person age cannot be negative';
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
    and is_active = true
    and (incident_id = v_unit.incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', p_status_id;
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
    p_operational_number,
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
      'operational_number', p_operational_number,
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
  is 'Creates an operational Person card with required operational number and status only; names are optional. Writes an EventLog record.';
