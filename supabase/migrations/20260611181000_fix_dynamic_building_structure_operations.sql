-- Fix dynamic building structure operations.
-- Keeps unit protection triggers in place and performs all structural writes
-- through approved security-definer RPCs using rcc.allow_structure_write.

create or replace function public.dynamic_structure_create_placeholders(
  p_unit_id uuid,
  p_count integer,
  p_start_index integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_status_id uuid;
  v_index integer;
begin
  if p_count is null or p_count <= 0 then
    return;
  end if;

  select * into v_unit
  from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  v_status_id := public.get_status_id('resident', 'missing', v_unit.incident_id);
  if v_status_id is null then
    raise exception 'Default resident missing status is missing';
  end if;

  for v_index in p_start_index..(p_start_index + p_count - 1) loop
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
      U&'\05D3\05D9\05D9\05E8 ' || v_index,
      null,
      null,
      null,
      v_status_id,
      'placeholder',
      public.current_actor_id(),
      public.current_actor_id()
    );
  end loop;
end;
$$;

create or replace function public.dynamic_structure_release_inactive_floor_numbers(p_floor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.units
  set previous_unit_label = coalesce(previous_unit_label, unit_number),
      unit_number = 'inactive-' || id::text,
      updated_by = public.current_actor_id(),
      updated_at = now()
  where floor_id = p_floor_id
    and is_active = false
    and coalesce(zone_type, 'apartment') = 'apartment'
    and unit_number ~ '^[0-9]+';

  perform set_config('rcc.allow_structure_write', 'off', true);
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.renumber_floor_apartments_from(
  p_floor_id uuid,
  p_start_number integer,
  p_new_start_number integer default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_new_number integer;
  v_old_label text;
  v_new_label text;
begin
  perform public.dynamic_structure_release_inactive_floor_numbers(p_floor_id);
  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.units
  set unit_number = 'renumber-' || id::text
  where floor_id = p_floor_id
    and is_active = true
    and coalesce(zone_type, 'apartment') = 'apartment'
    and unit_number ~ '^[0-9]+$'
    and unit_number::integer >= p_start_number;

  v_new_number := coalesce(p_new_start_number, p_start_number);

  for v_unit in
    select *
    from public.units
    where floor_id = p_floor_id
      and is_active = true
      and coalesce(zone_type, 'apartment') = 'apartment'
      and unit_number like 'renumber-%'
    order by zone_sequence nulls last, created_at, id
  loop
    v_old_label := U&'\05D3\05D9\05E8\05D4 ' || coalesce(v_unit.previous_unit_label, v_unit.zone_sequence::text, regexp_replace(v_unit.unit_number, '^renumber-', ''));
    v_new_label := U&'\05D3\05D9\05E8\05D4 ' || v_new_number;

    update public.units
    set previous_unit_label = coalesce(previous_unit_label, coalesce(zone_sequence::text, regexp_replace(unit_number, '^renumber-', ''))),
        unit_number = v_new_number::text,
        zone_sequence = v_new_number,
        structure_change_type = 'apartment_renumbered',
        structure_changed_at = now(),
        structure_changed_by = public.current_actor_id(),
        structure_change_reason = p_reason,
        updated_by = public.current_actor_id(),
        updated_at = now()
    where id = v_unit.id
    returning * into v_unit;

    perform public.dynamic_structure_record_history(
      v_unit,
      'apartment_renumbered',
      v_old_label,
      v_new_label,
      p_reason,
      jsonb_build_object('old_label', v_old_label, 'new_label', v_new_label)
    );

    perform public.create_event_log(
      v_unit.incident_id,
      'apartment_renumbered',
      U&'\05E1\05D9\05DE\05D5\05DF \05DE\05D7\05D3\05E9 \05E9\05DC \05D3\05D9\05E8\05D4',
      v_new_label || U&' \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D9\05EA\05D4 ' || v_old_label,
      'operational',
      'normal',
      now(),
      v_unit.site_id,
      v_unit.floor_id,
      v_unit.id,
      null,
      null,
      'ui',
      null,
      jsonb_build_object('unit_id', v_unit.id, 'previous_label', v_old_label, 'current_label', v_new_label)
    );

    v_new_number := v_new_number + 1;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.add_apartment_to_floor(
  p_floor_id uuid,
  p_position integer default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor public.floors%rowtype;
  v_site public.sites%rowtype;
  v_position integer;
  v_new_unit public.units%rowtype;
begin
  select * into v_floor from public.floors where id = p_floor_id;
  if not found then
    raise exception 'Floor does not exist';
  end if;

  select * into v_site from public.sites where id = v_floor.site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_edit_operational_data(v_floor.incident_id);

  if v_site.lifecycle_status = 'closed' or exists (
    select 1 from public.incidents i
    where i.id = v_floor.incident_id
      and (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  ) then
    raise exception 'Cannot change structure for a closed or archived incident/site';
  end if;

  perform public.dynamic_structure_release_inactive_floor_numbers(p_floor_id);

  if p_position is null then
    select coalesce(max((substring(unit_number from '^[0-9]+'))::integer), 0) + 1 into v_position
    from public.units
    where floor_id = p_floor_id
      and is_active = true
      and coalesce(zone_type, 'apartment') = 'apartment'
      and unit_number ~ '^[0-9]+';
  else
    v_position := greatest(1, p_position);
    perform public.renumber_floor_apartments_from(p_floor_id, v_position, v_position + 1, p_reason);
  end if;

  perform set_config('rcc.allow_structure_write', 'on', true);

  insert into public.units (
    incident_id,
    site_id,
    floor_id,
    unit_number,
    known_people_count,
    is_active,
    zone_type,
    zone_name,
    zone_sequence,
    expected_occupants,
    structure_change_type,
    structure_changed_at,
    structure_changed_by,
    structure_change_reason,
    created_by,
    updated_by
  )
  values (
    v_floor.incident_id,
    v_floor.site_id,
    v_floor.id,
    v_position::text,
    5,
    true,
    'apartment',
    U&'\05D3\05D9\05E8\05D4',
    v_position,
    5,
    'apartment_added',
    now(),
    public.current_actor_id(),
    p_reason,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning * into v_new_unit;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.dynamic_structure_create_placeholders(v_new_unit.id, 5, 1);

  perform public.dynamic_structure_record_history(
    v_new_unit,
    'apartment_added',
    null,
    public.dynamic_structure_unit_label(v_new_unit),
    p_reason,
    jsonb_build_object('floor_id', p_floor_id, 'position', v_position, 'default_potential', 5)
  );

  perform public.create_event_log(
    v_new_unit.incident_id,
    'apartment_added',
    U&'\05D4\05D5\05E1\05E4\05EA \05D3\05D9\05E8\05D4',
    U&'\05E0\05D5\05E1\05E4\05D4 \05D3\05D9\05E8\05D4 ' || v_new_unit.unit_number || U&' \05D1\05E7\05D5\05DE\05D4 ' || v_floor.floor_number,
    'operational',
    'important',
    now(),
    v_new_unit.site_id,
    v_new_unit.floor_id,
    v_new_unit.id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object('unit_id', v_new_unit.id, 'floor_number', v_floor.floor_number, 'current_label', v_new_unit.unit_number)
  );

  return v_new_unit.id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.split_apartment_unit(
  p_unit_id uuid,
  p_suffixes text[] default array[U&'\05D0\05F3', U&'\05D1\05F3'],
  p_reason text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_site public.sites%rowtype;
  v_suffix text;
  v_suffixes text[];
  v_base_label text;
  v_new_number text;
  v_created_ids uuid[] := array[]::uuid[];
  v_first boolean := true;
  v_new_unit public.units%rowtype;
  v_keep_count integer;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if not found then
    raise exception 'Unit does not exist';
  end if;

  select * into v_site from public.sites where id = v_unit.site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_edit_operational_data(v_unit.incident_id);

  if coalesce(v_unit.zone_type, 'apartment') <> 'apartment' then
    raise exception 'Only apartments can be split';
  end if;

  if v_site.lifecycle_status = 'closed' or exists (
    select 1 from public.incidents i
    where i.id = v_unit.incident_id
      and (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  ) then
    raise exception 'Cannot change structure for a closed or archived incident/site';
  end if;

  v_suffixes := array(
    select nullif(btrim(item), '')
    from unnest(coalesce(p_suffixes, array[]::text[])) item
    where nullif(btrim(item), '') is not null
  );

  if array_length(v_suffixes, 1) is null or array_length(v_suffixes, 1) < 2 then
    raise exception 'Split requires at least two suffixes';
  end if;

  v_base_label := v_unit.unit_number;
  perform set_config('rcc.allow_structure_write', 'on', true);

  foreach v_suffix in array v_suffixes loop
    v_new_number := v_base_label || v_suffix;

    if v_first then
      update public.units
      set previous_unit_label = coalesce(previous_unit_label, v_base_label),
          original_unit_label = coalesce(original_unit_label, v_base_label),
          unit_number = v_new_number,
          expected_occupants = 2,
          known_people_count = 2,
          structure_change_type = 'apartment_split',
          structure_changed_at = now(),
          structure_changed_by = public.current_actor_id(),
          structure_change_reason = p_reason,
          updated_by = public.current_actor_id(),
          updated_at = now()
      where id = v_unit.id
      returning * into v_new_unit;

      v_created_ids := array_append(v_created_ids, v_new_unit.id);

      select count(*) into v_keep_count
      from public.unit_residents ur
      where ur.unit_id = v_new_unit.id
        and ur.is_active = true
        and (
          ur.linked_person_id is not null
          or public.dynamic_structure_has_important_resident_data(v_new_unit.id)
        );

      if v_keep_count = 0 then
        update public.unit_residents ur
        set is_active = false,
            notes = coalesce(nullif(ur.notes, ''), 'placeholder') || '; inactive_after_split',
            updated_by = public.current_actor_id(),
            updated_at = now()
        where ur.unit_id = v_new_unit.id
          and ur.is_active = true
          and ur.id not in (
            select id
            from public.unit_residents
            where unit_id = v_new_unit.id and is_active = true
            order by created_at, id
            limit 2
          );
      end if;

      v_first := false;
    else
      insert into public.units (
        incident_id,
        site_id,
        floor_id,
        unit_number,
        previous_unit_label,
        original_unit_label,
        known_people_count,
        is_active,
        zone_type,
        zone_name,
        zone_sequence,
        expected_occupants,
        structure_change_type,
        structure_changed_at,
        structure_changed_by,
        structure_change_reason,
        created_by,
        updated_by
      )
      values (
        v_unit.incident_id,
        v_unit.site_id,
        v_unit.floor_id,
        v_new_number,
        v_base_label,
        v_base_label,
        2,
        true,
        'apartment',
        U&'\05D3\05D9\05E8\05D4',
        v_unit.zone_sequence,
        2,
        'apartment_split',
        now(),
        public.current_actor_id(),
        p_reason,
        public.current_actor_id(),
        public.current_actor_id()
      )
      returning * into v_new_unit;

      v_created_ids := array_append(v_created_ids, v_new_unit.id);
      perform public.dynamic_structure_create_placeholders(v_new_unit.id, 2, 1);
      perform set_config('rcc.allow_structure_write', 'on', true);
    end if;

    perform public.dynamic_structure_record_history(
      v_new_unit,
      'apartment_split',
      U&'\05D3\05D9\05E8\05D4 ' || v_base_label,
      public.dynamic_structure_unit_label(v_new_unit),
      p_reason,
      jsonb_build_object('original_unit_id', p_unit_id, 'base_label', v_base_label, 'suffix', v_suffix)
    );
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_unit.incident_id,
    'apartment_split',
    U&'\05E4\05D9\05E6\05D5\05DC \05D3\05D9\05E8\05D4',
    U&'\05D3\05D9\05E8\05D4 ' || v_base_label || U&' \05E4\05D5\05E6\05DC\05D4 \05DC-' || array_to_string(v_suffixes, ', '),
    'operational',
    'important',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    p_unit_id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object('original_unit_id', p_unit_id, 'base_label', v_base_label, 'suffixes', v_suffixes, 'unit_ids', v_created_ids)
  );

  return v_created_ids;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.remove_apartment_unit(
  p_unit_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_site public.sites%rowtype;
  v_floor public.floors%rowtype;
  v_old_label text;
  v_start_number integer;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if not found then
    raise exception 'Unit does not exist';
  end if;

  select * into v_site from public.sites where id = v_unit.site_id;
  select * into v_floor from public.floors where id = v_unit.floor_id;

  perform public.assert_edit_operational_data(v_unit.incident_id);

  if coalesce(v_unit.zone_type, 'apartment') <> 'apartment' then
    raise exception 'Only apartments can be removed';
  end if;

  if v_site.lifecycle_status = 'closed' or exists (
    select 1 from public.incidents i
    where i.id = v_unit.incident_id
      and (i.lifecycle_status = 'closed' or i.is_closed = true or i.archived_at is not null)
  ) then
    raise exception 'Cannot change structure for a closed or archived incident/site';
  end if;

  if exists (
    select 1
    from public.persons p
    where p.unit_id = v_unit.id
      and p.is_merged = false
  ) then
    raise exception 'Cannot remove apartment with active operational numbers';
  end if;

  if public.dynamic_structure_has_important_resident_data(v_unit.id) then
    raise exception 'Cannot remove apartment with important resident data';
  end if;

  v_old_label := public.dynamic_structure_unit_label(v_unit);
  v_start_number := case when v_unit.unit_number ~ '^[0-9]+$' then v_unit.unit_number::integer + 1 else null end;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.unit_residents
  set is_active = false,
      notes = coalesce(nullif(notes, ''), 'placeholder') || '; inactive_after_apartment_removed',
      updated_by = public.current_actor_id(),
      updated_at = now()
  where unit_id = v_unit.id
    and is_active = true;

  update public.units
  set is_active = false,
      unit_number = 'removed-' || id::text,
      inactive_reason = coalesce(nullif(p_reason, ''), U&'\05D4\05D5\05E1\05E8\05D4 \05D3\05D9\05E8\05D4 \05D1\05D6\05DE\05DF \05D0\05D9\05E8\05D5\05E2'),
      previous_unit_label = coalesce(previous_unit_label, v_unit.unit_number),
      structure_change_type = 'apartment_removed',
      structure_changed_at = now(),
      structure_changed_by = public.current_actor_id(),
      structure_change_reason = p_reason,
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = v_unit.id
  returning * into v_unit;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.dynamic_structure_record_history(
    v_unit,
    'apartment_removed',
    v_old_label,
    null,
    p_reason,
    jsonb_build_object('unit_id', v_unit.id)
  );

  perform public.create_event_log(
    v_unit.incident_id,
    'apartment_removed',
    U&'\05D4\05E1\05E8\05EA \05D3\05D9\05E8\05D4',
    v_old_label || U&' \05D4\05D5\05E1\05E8\05D4 \05DE\05E7\05D5\05DE\05D4 ' || coalesce(v_floor.floor_number::text, ''),
    'operational',
    'important',
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    'ui',
    null,
    jsonb_build_object('unit_id', v_unit.id, 'previous_label', v_old_label, 'reason', p_reason)
  );

  if v_start_number is not null then
    perform public.renumber_floor_apartments_from(v_unit.floor_id, v_start_number, v_start_number - 1, p_reason);
  end if;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.dynamic_structure_release_inactive_floor_numbers(uuid) to authenticated;
grant execute on function public.dynamic_structure_create_placeholders(uuid, integer, integer) to authenticated;
grant execute on function public.renumber_floor_apartments_from(uuid, integer, integer, text) to authenticated;
grant execute on function public.add_apartment_to_floor(uuid, integer, text) to authenticated;
grant execute on function public.split_apartment_unit(uuid, text[], text) to authenticated;
grant execute on function public.remove_apartment_unit(uuid, text) to authenticated;
