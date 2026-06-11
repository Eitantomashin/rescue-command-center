create or replace function public.link_person_to_resident(
  p_person_id uuid,
  p_resident_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_resident_status_id uuid;
  v_resident_name text;
  v_previous_person_id uuid;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person % does not exist', p_person_id;
  end if;

  if v_person.is_merged then
    raise exception 'Merged persons cannot be linked to residents';
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

  if v_resident.incident_id <> v_person.incident_id then
    raise exception 'Resident and person must belong to the same incident';
  end if;

  if exists (
    select 1
    from public.unit_residents ur
    where ur.incident_id = v_person.incident_id
      and ur.linked_person_id = v_person.id
      and ur.id <> v_resident.id
      and ur.is_active = true
  ) then
    raise exception 'Operational person is already linked to another resident';
  end if;

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  if not found then
    raise exception 'Resident unit % does not exist', v_resident.unit_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'link_person_to_resident');

  v_previous_person_id := v_resident.linked_person_id;
  v_resident_status_id := public.get_status_id('resident', 'linked_to_person', v_person.incident_id);
  v_resident_name := nullif(
    btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)),
    ''
  );

  update public.unit_residents
  set
    linked_person_id = v_person.id,
    status_id = coalesce(v_resident_status_id, status_id),
    updated_by = auth.uid()
  where id = v_resident.id;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set
    site_id = v_unit.site_id,
    floor_id = v_unit.floor_id,
    unit_id = v_unit.id,
    updated_by = auth.uid()
  where id = v_person.id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_person.incident_id,
    'person_linked_to_resident',
    'קישור אדם לדייר',
    '#' || v_person.operational_number || ' קושר ל' || coalesce(v_resident_name, 'דייר ללא שם'),
    'operational',
    'normal',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    v_person.id,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'person_id', v_person.id,
      'resident_id', v_resident.id,
      'previous_person_id', v_previous_person_id,
      'operational_number', v_person.operational_number,
      'resident_name', v_resident_name,
      'unit_number', v_unit.unit_number,
      'reason', p_reason
    )
  );
end;
$$;

comment on function public.link_person_to_resident(uuid, uuid, text)
  is 'Links or relinks an existing operational Person to an existing UnitResident, assigns the Person to the resident unit, and writes a new immutable EventLog row.';
