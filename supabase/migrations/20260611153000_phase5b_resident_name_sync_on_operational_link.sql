-- Phase 5B resident name sync when linking to an existing operational number.
--
-- If the operational person has a known name and the resident row is empty or
-- still a placeholder, copy the operational person's name to the resident and
-- append an immutable EventLog entry.

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
  v_floor_number integer;
  v_resident_status_id uuid;
  v_resident_name text;
  v_previous_person_id uuid;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_context text;
  v_old_resident_first_name text;
  v_old_resident_last_name text;
  v_old_resident_name text;
  v_new_resident_first_name text;
  v_new_resident_last_name text;
  v_new_resident_name text;
  v_person_has_name boolean;
  v_resident_has_real_name boolean;
  v_should_sync_name boolean;
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

  v_site_id := v_resident.site_id;
  v_floor_id := null;
  v_unit_id := v_resident.unit_id;
  v_floor_number := null;

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

    select floor_number into v_floor_number
    from public.floors
    where id = v_unit.floor_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'link_person_to_resident');

  v_previous_person_id := v_resident.linked_person_id;
  v_resident_status_id := public.get_status_id('resident', 'linked_to_person', v_person.incident_id);
  v_old_resident_first_name := v_resident.first_name;
  v_old_resident_last_name := v_resident.last_name;
  v_old_resident_name := coalesce(
    nullif(btrim(concat_ws(' ', v_old_resident_first_name, v_old_resident_last_name)), ''),
    'דייר ללא שם'
  );
  v_resident_name := v_old_resident_name;
  v_context := public.resident_event_context(v_site_id, v_floor_id, v_unit_id);

  v_person_has_name :=
    nullif(btrim(concat_ws(' ', v_person.first_name, v_person.last_name)), '') is not null;

  v_resident_has_real_name :=
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), '') is not null
    and not (
      coalesce(v_resident.first_name, '') ~ '^דייר [0-9]+$'
      and nullif(btrim(coalesce(v_resident.last_name, '')), '') is null
    );

  v_should_sync_name := v_person_has_name and not v_resident_has_real_name;
  v_new_resident_first_name := case when v_should_sync_name then v_person.first_name else v_resident.first_name end;
  v_new_resident_last_name := case when v_should_sync_name then v_person.last_name else v_resident.last_name end;
  v_new_resident_name := coalesce(
    nullif(btrim(concat_ws(' ', v_new_resident_first_name, v_new_resident_last_name)), ''),
    v_old_resident_name
  );

  update public.unit_residents
  set
    linked_person_id = v_person.id,
    first_name = v_new_resident_first_name,
    last_name = v_new_resident_last_name,
    status_id = coalesce(v_resident_status_id, status_id),
    updated_by = public.current_actor_id()
  where id = v_resident.id;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set
    site_id = v_site_id,
    floor_id = v_floor_id,
    unit_id = v_unit_id,
    updated_by = public.current_actor_id()
  where id = v_person.id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  if v_should_sync_name then
    perform public.create_event_log(
      v_person.incident_id,
      'resident_name_synced_from_operational_person',
      'עדכון שם דייר מקישור מבצעי',
      v_context || v_old_resident_name || ' עודכן ל' || v_new_resident_name || ' בעקבות קישור ל־#' || v_person.operational_number,
      'operational',
      'normal',
      now(),
      v_site_id,
      v_floor_id,
      v_unit_id,
      v_person.id,
      null,
      'ui',
      null,
      jsonb_build_object(
        'resident_id', v_resident.id,
        'person_id', v_person.id,
        'operational_number', v_person.operational_number,
        'old_resident_first_name', v_old_resident_first_name,
        'old_resident_last_name', v_old_resident_last_name,
        'new_first_name', v_new_resident_first_name,
        'new_last_name', v_new_resident_last_name,
        'site_id', v_site_id,
        'floor_id', v_floor_id,
        'floor_number', v_floor_number,
        'unit_id', v_unit_id,
        'unit_number', v_unit.unit_number
      )
    );
  end if;

  perform public.create_event_log(
    v_person.incident_id,
    'person_linked_to_resident',
    'קישור מספר מבצעי לדייר',
    v_context || '#' || v_person.operational_number || ' קושר ל' || v_new_resident_name,
    'operational',
    'normal',
    now(),
    v_site_id,
    v_floor_id,
    v_unit_id,
    v_person.id,
    null,
    'ui',
    null,
    jsonb_build_object(
      'person_id', v_person.id,
      'resident_id', v_resident.id,
      'previous_person_id', v_previous_person_id,
      'operational_number', v_person.operational_number,
      'resident_name', v_new_resident_name,
      'reason', p_reason
    )
  );
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

comment on function public.link_person_to_resident(uuid, uuid, text)
  is 'Links an operational person to a resident, syncing the person name to empty/placeholder resident rows and appending immutable EventLog entries.';
