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
  v_status public.status_types%rowtype;
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

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  if not found then
    raise exception 'Resident unit % does not exist', v_resident.unit_id;
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'update_unit_resident');

  if p_status_id is not null then
    select * into v_status
    from public.status_types
    where id = p_status_id
      and category = 'resident'
      and is_active = true
      and (incident_id = v_resident.incident_id or incident_id is null);

    if not found then
      raise exception 'Resident status % is not valid for this incident', p_status_id;
    end if;
  end if;

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

  perform public.create_event_log(
    v_resident.incident_id,
    'unit_resident_updated',
    'Unit Resident Updated',
    p_notes,
    'operational',
    'normal',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    v_resident.linked_person_id,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'resident_id', v_resident.id,
      'unit_number', v_unit.unit_number,
      'previous_first_name', v_resident.first_name,
      'previous_last_name', v_resident.last_name,
      'new_first_name', p_first_name,
      'new_last_name', p_last_name,
      'new_resident_status_key', v_status.status_key,
      'new_resident_status_label', v_status.hebrew_label
    )
  );
end;
$$;

comment on function public.update_unit_resident(uuid, text, text, integer, text, uuid, text)
  is 'Updates a registered UnitResident through an approved write path and writes an EventLog record.';
