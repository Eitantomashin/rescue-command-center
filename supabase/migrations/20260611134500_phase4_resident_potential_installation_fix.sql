alter table public.status_types
  add column if not exists counts_as_gap_resolved boolean not null default false;

insert into public.status_types (
  incident_id,
  category,
  status_key,
  name,
  hebrew_label,
  color,
  is_open,
  is_dashboard_counted,
  is_default,
  counts_as_gap_resolved,
  sort_order
)
values
  (null, 'resident', 'missing', 'Missing', 'נעדר', 'blue', true, true, true, false, 40),
  (null, 'resident', 'unknown', 'Unknown', 'לא ידוע', 'blue', true, true, true, false, 35),
  (null, 'resident', 'general', 'General', 'כללי', 'gray', true, true, true, false, 36),
  (null, 'resident', 'in_progress', 'In Progress', 'בטיפול', 'orange', true, true, true, false, 50),
  (null, 'resident', 'trapped_located_not_yet_rescued', 'Trapped Located Not Yet Rescued', 'לכודים שאותרו וטרם חולצו', 'green', true, true, true, true, 55),
  (null, 'resident', 'rescued', 'Rescued', 'חולץ', 'green', false, true, true, true, 60),
  (null, 'resident', 'evacuated_to_napal', 'Evacuated To Napal', 'פצועים שפונו לנאפל', 'green', false, true, true, true, 61),
  (null, 'resident', 'evacuated_from_site', 'Evacuated From Site', 'פצועים שפונו מהאתר', 'green', false, true, true, true, 62),
  (null, 'resident', 'deceased_evacuated', 'Deceased Evacuated', 'הרוגים שפונו', 'green', false, true, true, true, 63),
  (null, 'resident', 'evacuated', 'Evacuated', 'פונה', 'green', false, true, true, true, 70),
  (null, 'resident', 'located_outside_site', 'Located Outside Site', 'אזרחים שאותרו לא באתר', 'green', false, true, true, true, 80),
  (null, 'resident', 'resolved', 'Resolved', 'טופל', 'green', false, true, true, true, 90),
  (null, 'person', 'missing', 'Missing', 'נעדר', 'blue', true, true, true, false, 10),
  (null, 'person', 'unknown', 'Unknown', 'לא ידוע', 'blue', true, true, true, false, 5),
  (null, 'person', 'general', 'General', 'כללי', 'gray', true, true, true, false, 6),
  (null, 'person', 'in_progress', 'In Progress', 'בטיפול', 'orange', true, true, true, false, 15),
  (null, 'person', 'evacuated_to_napal', 'Evacuated To Napal', 'פצועים שפונו לנאפל', 'yellow', false, true, true, true, 31),
  (null, 'person', 'evacuated_from_site', 'Evacuated From Site', 'פצועים שפונו מהאתר', 'green', false, true, true, true, 41),
  (null, 'person', 'deceased_evacuated', 'Deceased Evacuated', 'הרוגים שפונו', 'black', false, true, true, true, 51),
  (null, 'person', 'rescued', 'Rescued', 'חולץ', 'green', false, true, true, true, 70),
  (null, 'person', 'evacuated', 'Evacuated', 'פונה', 'green', false, true, true, true, 80),
  (null, 'person', 'resolved', 'Resolved', 'טופל', 'green', false, true, true, true, 90)
on conflict do nothing;

update public.status_types
set
  counts_as_gap_resolved = status_key in (
    'located_outside_site',
    'evacuated_to_napal',
    'evacuated_from_site',
    'deceased_evacuated',
    'trapped_located_not_yet_rescued',
    'rescued',
    'evacuated',
    'resolved',
    'injured_evacuated_to_ccp',
    'injured_evacuated_from_site',
    'fatality_evacuated'
  ),
  hebrew_label = case status_key
    when 'missing' then 'נעדר'
    when 'unknown' then 'לא ידוע'
    when 'general' then 'כללי'
    when 'in_progress' then 'בטיפול'
    when 'located_outside_site' then 'אזרחים שאותרו לא באתר'
    when 'evacuated_to_napal' then 'פצועים שפונו לנאפל'
    when 'evacuated_from_site' then 'פצועים שפונו מהאתר'
    when 'deceased_evacuated' then 'הרוגים שפונו'
    when 'trapped_located_not_yet_rescued' then 'לכודים שאותרו וטרם חולצו'
    when 'rescued' then 'חולץ'
    when 'evacuated' then 'פונה'
    when 'resolved' then 'טופל'
    else hebrew_label
  end,
  color = case
    when status_key in ('missing', 'unknown') then 'blue'
    when status_key = 'in_progress' then 'orange'
    when status_key = 'general' then 'gray'
    when status_key in ('located_outside_site', 'evacuated_from_site', 'deceased_evacuated', 'trapped_located_not_yet_rescued', 'rescued', 'evacuated', 'resolved') then 'green'
    else color
  end
where category in ('resident', 'person');

update public.unit_residents ur
set site_id = u.site_id
from public.units u
where ur.unit_id = u.id
  and ur.site_id is null;

with unit_counts as (
  select
    u.id as unit_id,
    u.incident_id,
    u.site_id,
    count(ur.id) filter (where ur.is_active = true)::integer as active_resident_count
  from public.units u
  left join public.unit_residents ur on ur.unit_id = u.id
  group by u.id, u.incident_id, u.site_id
),
missing_statuses as (
  select
    uc.*,
    public.get_status_id('resident', 'missing', uc.incident_id) as missing_status_id
  from unit_counts uc
  where uc.active_resident_count < 5
)
insert into public.unit_residents (
  incident_id,
  site_id,
  unit_id,
  first_name,
  status_id,
  notes
)
select
  ms.incident_id,
  ms.site_id,
  ms.unit_id,
  'דייר ' || (ms.active_resident_count + gs.placeholder_index),
  ms.missing_status_id,
  'placeholder'
from missing_statuses ms
cross join lateral generate_series(1, 5 - ms.active_resident_count) as gs(placeholder_index)
where ms.missing_status_id is not null;

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
  v_notes text;
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
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if v_first_name is null and nullif(btrim(coalesce(p_last_name, '')), '') is null then
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
    nullif(btrim(coalesce(p_last_name, '')), ''),
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_status.id,
    v_notes,
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
      'first_name', v_first_name,
      'last_name', p_last_name,
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

  if v_first_name is null and nullif(btrim(coalesce(p_last_name, '')), '') is null then
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
    nullif(btrim(coalesce(p_last_name, '')), ''),
    p_age,
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_status.id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_resident_id;

  perform public.create_event_log(
    v_site.incident_id,
    'general_area_resident_created',
    'General Area Resident Created',
    p_notes,
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
      'last_name', p_last_name,
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
  v_status public.status_types%rowtype;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_unit_number text;
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
      'new_last_name', p_last_name,
      'new_resident_status_key', v_status.status_key,
      'new_resident_status_label', v_status.hebrew_label
    )
  );
end;
$$;

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
  v_resident_name text;
  v_previous_person_id uuid;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_unit_number text;
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

  perform public.assert_incident_writable(v_person.incident_id, 'link_person_to_resident');

  v_previous_person_id := v_resident.linked_person_id;
  v_resident_name := nullif(
    btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)),
    ''
  );

  update public.unit_residents
  set
    linked_person_id = v_person.id,
    updated_by = auth.uid()
  where id = v_resident.id;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set
    site_id = v_site_id,
    floor_id = v_floor_id,
    unit_id = v_unit_id,
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
    v_site_id,
    v_floor_id,
    v_unit_id,
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
      'unit_number', v_unit_number,
      'reason', p_reason
    )
  );
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

  perform public.assert_incident_writable(v_resident.incident_id, 'link_operational_number_to_resident');

  if v_resident.unit_id is not null then
    select * into v_unit
    from public.units
    where id = v_resident.unit_id;

    if not found then
      raise exception 'Resident unit % does not exist', v_resident.unit_id;
    end if;
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
      v_resident.site_id,
      v_unit.floor_id,
      v_resident.unit_id,
      p_operational_number,
      nullif(btrim(coalesce(v_resident.first_name, '')), ''),
      nullif(btrim(coalesce(v_resident.last_name, '')), ''),
      v_resident.age,
      nullif(btrim(coalesce(v_resident.phone, '')), ''),
      v_person_status_id,
      'ui',
      p_reason,
      auth.uid(),
      auth.uid()
    )
    returning id into v_person_id;

    perform public.create_event_log(
      v_resident.incident_id,
      'operational_person_created_for_resident',
      'יצירת אדם מבצעי לדייר',
      '#' || p_operational_number || ' נוצר וקושר לדייר',
      'operational',
      'normal',
      now(),
      v_resident.site_id,
      v_unit.floor_id,
      v_resident.unit_id,
      v_person_id,
      null,
      'ui',
      'RCC',
      jsonb_build_object(
        'resident_id', v_resident.id,
        'person_id', v_person_id,
        'operational_number', p_operational_number
      )
    );
  end if;

  perform public.link_person_to_resident(v_person_id, v_resident.id, p_reason);

  return v_person_id;
end;
$$;

create or replace function public.delete_empty_placeholder_resident(
  p_resident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_status_key text;
begin
  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'delete_empty_placeholder_resident');

  select status_key into v_status_key
  from public.status_types
  where id = v_resident.status_id;

  if v_resident.linked_person_id is not null then
    raise exception 'Cannot delete resident linked to an operational person';
  end if;

  if v_resident.unit_id is null then
    raise exception 'Only apartment placeholders can be deleted';
  end if;

  if v_resident.first_name !~ '^דייר [0-9]+$'
    or v_resident.last_name is not null
    or v_resident.age is not null
    or nullif(btrim(coalesce(v_resident.phone, '')), '') is not null
    or nullif(btrim(coalesce(v_resident.notes, '')), '') is distinct from 'placeholder'
    or coalesce(v_status_key, 'missing') <> 'missing'
  then
    raise exception 'Only empty missing placeholder residents can be deleted';
  end if;

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  perform set_config('rcc.allow_placeholder_resident_delete_id', v_resident.id::text, true);

  delete from public.unit_residents
  where id = v_resident.id;

  perform set_config('rcc.allow_placeholder_resident_delete_id', '', true);

  perform public.create_event_log(
    v_resident.incident_id,
    'placeholder_resident_deleted',
    'Placeholder Resident Deleted',
    'Deleted empty placeholder resident',
    'operational',
    'normal',
    now(),
    v_resident.site_id,
    v_unit.floor_id,
    v_resident.unit_id,
    null,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'resident_id', v_resident.id,
      'resident_name', v_resident.first_name,
      'unit_number', v_unit.unit_number
    )
  );
end;
$$;
