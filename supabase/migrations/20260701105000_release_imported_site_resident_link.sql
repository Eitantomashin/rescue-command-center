-- Release imported municipal resident links without deleting resident card data.

create or replace function public.release_imported_site_resident_link(
  p_imported_resident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imported public.imported_site_residents%rowtype;
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_floor_number integer;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_role text := public.current_user_role();
  v_name text;
  v_resident_found boolean := false;
begin
  select *
  into v_imported
  from public.imported_site_residents
  where id = p_imported_resident_id
  for update;

  if not found or not v_imported.is_active then
    raise exception 'Imported resident was not found';
  end if;

  if v_imported.linked_resident_id is null then
    raise exception 'Imported resident is not linked';
  end if;

  if coalesce(v_role, '') not in ('admin', 'commander', 'system_administrator', 'incident_commander') then
    raise exception 'Only administrator or commander may release imported resident links';
  end if;

  perform public.assert_edit_operational_data(v_imported.incident_id);

  select *
  into v_resident
  from public.unit_residents
  where id = v_imported.linked_resident_id;

  v_resident_found := found;

  if v_resident_found and v_resident.unit_id is not null then
    select * into v_unit from public.units where id = v_resident.unit_id;
    select floor_number into v_floor_number from public.floors where id = v_unit.floor_id;
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  v_name := coalesce(
    nullif(btrim(concat_ws(' ', v_imported.first_name, v_imported.last_name)), ''),
    'דייר ללא שם'
  );

  update public.imported_site_residents
  set linked_resident_id = null,
      linked_unit_id = null,
      linked_at = null,
      linked_by = null
  where id = v_imported.id;

  perform public.create_event_log(
    v_imported.incident_id,
    'imported_resident_link_released',
    '🔓 שיוך דייר שוחרר',
    'השיוך של הדייר ' || v_name || ' ל' ||
      case
        when not v_resident_found or v_resident.unit_id is null then 'אזור כללי'
        when v_floor_number is null then 'יחידה ' || coalesce(v_unit.unit_number, '')
        else 'דירה ' || coalesce(v_unit.unit_number, '') || ' קומה ' || v_floor_number
      end || ' שוחרר על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'operational',
    'important',
    now(),
    v_imported.site_id,
    case when not v_resident_found or v_resident.unit_id is null then null else v_unit.floor_id end,
    v_resident.unit_id,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'imported_resident_id', v_imported.id,
      'resident_id', case when v_resident_found then v_resident.id else null end,
      'unit_id', case when v_resident_found then v_resident.unit_id else null end
    )
  );
end;
$$;

grant execute on function public.release_imported_site_resident_link(uuid) to authenticated;