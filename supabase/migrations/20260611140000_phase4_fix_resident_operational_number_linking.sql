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
      '#' || p_operational_number || ' נוצר עבור דייר',
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

comment on function public.link_operational_number_to_resident(uuid, integer, text)
  is 'Finds or creates an operational Person by incident operational number, links it to an active UnitResident, and writes immutable EventLog rows through database functions.';
