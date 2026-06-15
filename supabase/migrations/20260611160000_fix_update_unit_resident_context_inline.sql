-- Fix update_unit_resident runtime dependency on missing context helper.
--
-- Some deployed databases do not have the older context helper.
-- This forward-only replacement builds the resident location context inline and
-- continues to append EventLogs only through public.create_event_log(...).

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
    or v_resident.notes is distinct from v_new_notes;

  update public.unit_residents
  set
    first_name = v_new_first_name,
    last_name = v_new_last_name,
    age = p_age,
    phone = v_new_phone,
    status_id = v_resident.status_id,
    notes = v_new_notes,
    updated_by = public.current_actor_id()
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

comment on function public.update_unit_resident(uuid, text, text, integer, text, uuid, text)
  is 'Updates resident identity/details only with inline event context. Resident status_id is preserved; operational status changes happen through operational reports.';
