-- Improve future EventLog entries for empty placeholder resident deletion.
-- Existing event_logs remain immutable and unchanged.

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
  is 'Deletes an empty placeholder resident and appends a Hebrew EventLog with floor/unit context. Existing EventLogs are not modified.';
