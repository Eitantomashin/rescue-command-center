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
  v_description text;
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

  v_old_name := coalesce(
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
    v_resident.first_name,
    'דייר ללא שם'
  );

  v_new_name := coalesce(
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), ''),
    nullif(btrim(coalesce(p_first_name, '')), ''),
    v_old_name
  );

  if v_status_changed then
    v_description := case
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
      v_description,
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
    perform public.create_event_log(
      v_resident.incident_id,
      'unit_resident_updated',
      'עדכון פרטי דייר',
      p_notes,
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

create or replace function public.update_person_status(
  p_person_id uuid,
  p_new_status_id uuid,
  p_reported_at timestamptz default now(),
  p_source_type text default null,
  p_source_name text default null,
  p_team_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
  v_linked_resident public.unit_residents%rowtype;
  v_resident_name text;
  v_person_name text;
  v_description text;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'update_person_status');

  if v_person.is_merged then
    raise exception 'Merged persons cannot receive operational status changes';
  end if;

  select * into v_previous_status
  from public.status_types
  where id = v_person.current_status_id;

  select * into v_new_status
  from public.status_types
  where id = p_new_status_id
    and category = 'person'
    and is_active = true
    and (incident_id = v_person.incident_id or incident_id is null);

  if not found then
    raise exception 'New status % is not valid for this person incident', p_new_status_id;
  end if;

  select * into v_linked_resident
  from public.unit_residents
  where linked_person_id = v_person.id
    and incident_id = v_person.incident_id
    and is_active = true
  order by updated_at desc
  limit 1;

  v_resident_name := nullif(
    btrim(concat_ws(' ', v_linked_resident.first_name, v_linked_resident.last_name)),
    ''
  );

  v_person_name := coalesce(
    v_resident_name,
    nullif(btrim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''),
    'שם לא ידוע'
  );

  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    team_id,
    notes,
    created_by
  )
  values (
    p_person_id,
    v_person.incident_id,
    v_person.current_status_id,
    p_new_status_id,
    coalesce(p_reported_at, now()),
    p_source_type,
    p_source_name,
    p_team_id,
    p_notes,
    auth.uid()
  );

  update public.persons
  set
    current_status_id = p_new_status_id,
    updated_by = auth.uid()
  where id = p_person_id;

  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_description :=
    '#' || v_person.operational_number || ' - ' || v_person_name || ': '
    || coalesce(v_previous_status.hebrew_label, 'ללא סטטוס')
    || ' → '
    || coalesce(v_new_status.hebrew_label, 'ללא סטטוס');

  perform public.create_event_log(
    v_person.incident_id,
    'person_status_changed',
    'שינוי סטטוס אדם מבצעי',
    v_description,
    'status_change',
    'normal',
    coalesce(p_reported_at, now()),
    coalesce(v_person.site_id, v_linked_resident.site_id),
    v_person.floor_id,
    coalesce(v_person.unit_id, v_linked_resident.unit_id),
    v_person.id,
    p_team_id,
    coalesce(p_source_type, 'ui'),
    coalesce(p_source_name, 'RCC'),
    jsonb_build_object(
      'person_id', v_person.id,
      'linked_resident_id', v_linked_resident.id,
      'old_status_id', v_person.current_status_id,
      'new_status_id', p_new_status_id,
      'old_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label,
      'old_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key
    )
  );
exception
  when others then
    perform set_config('rcc.allow_status_history_insert', 'off', true);
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;
