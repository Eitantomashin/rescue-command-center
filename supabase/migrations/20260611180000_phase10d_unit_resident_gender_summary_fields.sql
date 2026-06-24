-- Adds resident gender and keeps resident detail updates behind the approved
-- update_unit_resident RPC/EventLog path.

alter table public.unit_residents
  add column if not exists gender text not null default 'unknown'
  check (gender in ('male', 'female', 'unknown'));

-- If a legacy resident row has a full name in first_name and no last_name,
-- split the first token into first_name and keep the rest as last_name.
update public.unit_residents
set
  first_name = split_part(btrim(first_name), ' ', 1),
  last_name = nullif(btrim(substr(btrim(first_name), length(split_part(btrim(first_name), ' ', 1)) + 2)), ''),
  updated_at = now()
where last_name is null
  and nullif(btrim(first_name), '') is not null
  and btrim(first_name) like '% %'
  and btrim(first_name) !~ U&'^\05D3\05D9\05D9\05E8[[:space:]]+[0-9]+$'
  and btrim(first_name) !~ U&'^\05D0\05D6\05D5\05E8[[:space:]]+\05DB\05DC\05DC\05D9[[:space:]]+[0-9]+$';

drop function if exists public.update_unit_resident(uuid, text, text, integer, text, uuid, text);

create or replace function public.update_unit_resident(
  p_resident_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
  p_status_id uuid default null,
  p_notes text default null,
  p_gender text default 'unknown'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_floor_number integer;
  v_unit_label text;
  v_context text;
  v_old_name text;
  v_new_first_name text;
  v_new_last_name text;
  v_new_phone text;
  v_new_notes text;
  v_new_gender text;
  v_new_name text;
  v_old_is_placeholder boolean;
  v_new_is_real_name boolean;
  v_non_status_changed boolean;
  v_details_description text;
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

  v_new_gender := coalesce(nullif(btrim(p_gender), ''), 'unknown');
  if v_new_gender not in ('male', 'female', 'unknown') then
    raise exception 'Resident gender is not valid';
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'update_unit_resident');

  v_site_id := v_resident.site_id;
  v_floor_id := null;
  v_unit_id := v_resident.unit_id;
  v_floor_number := null;
  v_unit_label := U&'\05D0\05D6\05D5\05E8 \05DB\05DC\05DC\05D9';
  v_context := U&'\05D0\05D6\05D5\05E8 \05DB\05DC\05DC\05D9: ';

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

    v_unit_label := case
      when coalesce(v_unit.zone_type, 'apartment') = 'apartment' then U&'\05D3\05D9\05E8\05D4 ' || v_unit.unit_number
      when v_unit.zone_name is not null then v_unit.zone_name || ' ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      else U&'\05D9\05D7\05D9\05D3\05D4 ' || v_unit.unit_number
    end;

    v_context := case
      when v_floor_number is null then v_unit_label || ': '
      else U&'\05E7\05D5\05DE\05D4 ' || v_floor_number || ', ' || v_unit_label || ': '
    end;
  end if;

  v_new_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_new_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  v_new_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_new_notes := nullif(btrim(coalesce(p_notes, '')), '');

  v_old_name := coalesce(
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
    U&'\05D3\05D9\05D9\05E8 \05DC\05DC\05D0 \05E9\05DD'
  );
  v_new_name := coalesce(
    nullif(btrim(concat_ws(' ', v_new_first_name, v_new_last_name)), ''),
    v_old_name
  );
  v_old_is_placeholder :=
    coalesce(v_resident.notes, '') = 'placeholder'
    or coalesce(v_resident.first_name, '') ~ U&'^\05D3\05D9\05D9\05E8( [0-9]+)?$'
    or nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), '') ~ U&'^\05D3\05D9\05D9\05E8 [0-9]+$';
  v_new_is_real_name := not (
    v_new_name ~ U&'^\05D3\05D9\05D9\05E8( [0-9]+)?$'
    or v_new_name = U&'\05D3\05D9\05D9\05E8 \05DC\05DC\05D0 \05E9\05DD'
  );

  v_non_status_changed :=
    v_resident.first_name is distinct from v_new_first_name
    or v_resident.last_name is distinct from v_new_last_name
    or v_resident.age is distinct from p_age
    or v_resident.phone is distinct from v_new_phone
    or v_resident.notes is distinct from v_new_notes
    or coalesce(v_resident.gender, 'unknown') is distinct from v_new_gender;

  update public.unit_residents
  set
    first_name = v_new_first_name,
    last_name = v_new_last_name,
    gender = v_new_gender,
    age = p_age,
    phone = v_new_phone,
    status_id = v_resident.status_id,
    notes = v_new_notes,
    updated_by = public.current_actor_id(),
    updated_at = now()
  where id = v_resident.id;

  if v_non_status_changed then
    v_details_description := v_context || case
      when v_old_is_placeholder and v_new_is_real_name then v_old_name || ' -> ' || v_new_name
      else U&'\05E2\05D5\05D3\05DB\05E0\05D5 \05E4\05E8\05D8\05D9 \05D4\05D3\05D9\05D9\05E8 ' || v_new_name
    end;

    if p_age is distinct from v_resident.age and p_age is not null then
      v_details_description := v_details_description || U&' (\05D2\05D9\05DC ' || p_age || ')';
    end if;

    perform public.create_event_log(
      v_resident.incident_id,
      'unit_resident_updated',
      U&'\05E2\05D3\05DB\05D5\05DF \05E4\05E8\05D8\05D9 \05D3\05D9\05D9\05E8',
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
      null,
      jsonb_build_object(
        'resident_id', v_resident.id,
        'linked_person_id', v_resident.linked_person_id,
        'site_id', v_site_id,
        'floor_id', v_floor_id,
        'floor_number', v_floor_number,
        'unit_id', v_unit_id,
        'unit_number', case when v_unit_id is null then null else v_unit.unit_number end,
        'zone_type', case when v_unit_id is null then null else v_unit.zone_type end,
        'zone_name', case when v_unit_id is null then null else v_unit.zone_name end,
        'zone_sequence', case when v_unit_id is null then null else v_unit.zone_sequence end,
        'old_first_name', v_resident.first_name,
        'old_last_name', v_resident.last_name,
        'new_first_name', v_new_first_name,
        'new_last_name', v_new_last_name,
        'old_gender', coalesce(v_resident.gender, 'unknown'),
        'new_gender', v_new_gender,
        'old_age', v_resident.age,
        'new_age', p_age,
        'old_phone', v_resident.phone,
        'new_phone', v_new_phone,
        'old_notes', v_resident.notes,
        'new_notes', v_new_notes,
        'status_preserved', true,
        'preserved_status_id', v_resident.status_id
      )
    );
  end if;
end;
$$;

comment on function public.update_unit_resident(uuid, text, text, integer, text, uuid, text, text)
  is 'Updates resident identity/details including gender with inline event context. Resident status_id is preserved; operational status changes happen through operational reports.';

grant execute on function public.update_unit_resident(uuid, text, text, integer, text, uuid, text, text) to authenticated;


-- Keep placeholder deletion strict after adding gender.
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
  v_floor public.floors%rowtype;
  v_status_key text;
  v_site_id uuid;
  v_unit_label text;
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
    raise exception 'Only unit placeholder residents can be deleted';
  end if;

  if v_resident.first_name !~ '^דייר [0-9]+$'
    or v_resident.last_name is not null
    or v_resident.age is not null
    or coalesce(v_resident.gender, 'unknown') <> 'unknown'
    or nullif(btrim(coalesce(v_resident.phone, '')), '') is not null
    or nullif(btrim(coalesce(v_resident.notes, '')), '') is distinct from 'placeholder'
    or coalesce(v_status_key, 'missing') <> 'missing'
  then
    raise exception 'Only empty missing placeholder residents can be deleted';
  end if;

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  if not found then
    raise exception 'Unit % does not exist', v_resident.unit_id;
  end if;

  select * into v_floor
  from public.floors
  where id = v_unit.floor_id;

  if not found then
    raise exception 'Floor % does not exist', v_unit.floor_id;
  end if;

  v_site_id := coalesce(v_resident.site_id, v_unit.site_id);

  v_unit_label :=
    case
      when coalesce(v_unit.zone_type, 'apartment') = 'apartment'
        then 'דירה ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'parking_area'
        then 'חניה ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'store'
        then 'חנות ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'warehouse'
        then 'מחסן ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'office'
        then 'משרד ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'shelter'
        then 'מקלט ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'lobby'
        then 'לובי ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'machine_room'
        then 'חדר מכונות ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      when v_unit.zone_type = 'commercial_area'
        then 'שטח מסחרי ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
      else coalesce(v_unit.zone_name, 'אזור') || ' ' || coalesce(v_unit.zone_sequence::text, v_unit.unit_number)
    end;

  perform set_config('rcc.allow_placeholder_resident_delete_id', v_resident.id::text, true);

  delete from public.unit_residents
  where id = v_resident.id;

  perform set_config('rcc.allow_placeholder_resident_delete_id', '', true);

  perform public.create_event_log(
    v_resident.incident_id,
    'placeholder_resident_deleted',
    'מחיקת דייר ריק',
    'קומה ' || v_floor.floor_number || ', ' || v_unit_label || ': נמחק דייר ריק',
    'operational',
    'normal',
    now(),
    v_site_id,
    v_floor.id,
    v_unit.id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object(
      'resident_id', v_resident.id,
      'site_id', v_site_id,
      'floor_id', v_floor.id,
      'floor_number', v_floor.floor_number,
      'unit_id', v_unit.id,
      'unit_number', v_unit.unit_number,
      'zone_type', v_unit.zone_type,
      'zone_name', v_unit.zone_name,
      'zone_sequence', v_unit.zone_sequence,
      'unit_label', v_unit_label
    )
  );
exception
  when others then
    perform set_config('rcc.allow_placeholder_resident_delete_id', '', true);
    raise;
end;
$$;


comment on function public.delete_empty_placeholder_resident(uuid)
  is 'Deletes an empty placeholder resident only when no real details, including gender, were entered.';
