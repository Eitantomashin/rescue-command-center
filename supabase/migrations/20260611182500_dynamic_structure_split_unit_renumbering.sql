-- Split-aware building-wide apartment renumbering.
-- Unit labels are parsed as base apartment number + optional suffix.
-- Examples: 2, 2א׳, 2ב׳. Shifting base 2 forward keeps suffixes: 3א׳, 3ב׳.

create or replace function public.dynamic_structure_apartment_base(p_unit_number text)
returns integer
language sql
immutable
as $$
  select nullif(substring(coalesce(p_unit_number, '') from '^[0-9]+'), '')::integer
$$;

create or replace function public.dynamic_structure_apartment_suffix(p_unit_number text)
returns text
language sql
immutable
as $$
  select nullif(substring(coalesce(p_unit_number, '') from '^[0-9]+(.*)$'), '')
$$;

create or replace function public.dynamic_structure_suffix_rank(p_suffix text)
returns integer
language sql
immutable
as $$
  select coalesce(
    array_position(
      array[
        U&'\05D0\05F3',
        U&'\05D1\05F3',
        U&'\05D2\05F3',
        U&'\05D3\05F3',
        U&'\05D4\05F3',
        U&'\05D5\05F3',
        U&'\05D6\05F3',
        U&'\05D7\05F3',
        U&'\05D8\05F3',
        U&'\05D9\05F3'
      ],
      p_suffix
    ),
    case when p_suffix is null then 0 else 1000 end
  )
$$;

create or replace function public.dynamic_structure_suffix_by_rank(p_rank integer)
returns text
language sql
immutable
as $$
  select coalesce((array[
    U&'\05D0\05F3',
    U&'\05D1\05F3',
    U&'\05D2\05F3',
    U&'\05D3\05F3',
    U&'\05D4\05F3',
    U&'\05D5\05F3',
    U&'\05D6\05F3',
    U&'\05D7\05F3',
    U&'\05D8\05F3',
    U&'\05D9\05F3'
  ])[greatest(1, p_rank)], '-' || greatest(1, p_rank)::text)
$$;

create or replace function public.renumber_site_apartments_from(
  p_site_id uuid,
  p_floor_number integer,
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
  v_unit record;
  v_updated_unit public.units%rowtype;
  v_new_base integer;
  v_old_base integer;
  v_suffix text;
  v_old_number text;
  v_new_number text;
  v_old_label text;
  v_new_label text;
begin
  perform public.dynamic_structure_release_inactive_site_numbers(p_site_id);
  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.units u
  set unit_number = 'renumber-' || u.unit_number
  from public.floors f
  where u.floor_id = f.id
    and u.site_id = p_site_id
    and u.is_active = true
    and coalesce(u.zone_type, 'apartment') = 'apartment'
    and public.dynamic_structure_apartment_base(u.unit_number) is not null
    and (
      f.floor_number > p_floor_number
      or (
        f.floor_number = p_floor_number
        and public.dynamic_structure_apartment_base(u.unit_number) >= p_start_number
      )
    );

  v_new_base := coalesce(p_new_start_number, p_start_number);

  for v_unit in
    select
      u.*,
      f.floor_number,
      public.dynamic_structure_apartment_base(regexp_replace(u.unit_number, '^renumber-', '')) as old_base,
      public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', '')) as old_suffix
    from public.units u
    join public.floors f on f.id = u.floor_id
    where u.site_id = p_site_id
      and u.is_active = true
      and coalesce(u.zone_type, 'apartment') = 'apartment'
      and u.unit_number like 'renumber-%'
    order by
      f.floor_number asc,
      public.dynamic_structure_apartment_base(regexp_replace(u.unit_number, '^renumber-', '')) asc,
      public.dynamic_structure_suffix_rank(public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', ''))) asc,
      public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', '')) asc nulls first,
      u.created_at,
      u.id
  loop
    v_old_base := v_unit.old_base;
    v_suffix := v_unit.old_suffix;
    v_old_number := v_old_base::text || coalesce(v_suffix, '');
    v_new_number := v_new_base::text || coalesce(v_suffix, '');
    v_old_label := U&'\05D3\05D9\05E8\05D4 ' || v_old_number;
    v_new_label := U&'\05D3\05D9\05E8\05D4 ' || v_new_number;

    update public.units
    set previous_unit_label = v_old_number,
        unit_number = v_new_number,
        zone_sequence = v_new_base,
        structure_change_type = 'apartment_renumbered',
        structure_changed_at = now(),
        structure_changed_by = public.current_actor_id(),
        structure_change_reason = p_reason,
        updated_by = public.current_actor_id(),
        updated_at = now()
    where id = v_unit.id
    returning * into v_updated_unit;

    perform public.dynamic_structure_record_history(
      v_updated_unit,
      'apartment_renumbered',
      v_old_label,
      v_new_label,
      p_reason,
      jsonb_build_object(
        'old_label', v_old_label,
        'new_label', v_new_label,
        'floor_number', v_unit.floor_number,
        'old_base', v_old_base,
        'new_base', v_new_base,
        'suffix', v_suffix,
        'scope', 'site'
      )
    );

    perform public.create_event_log(
      v_updated_unit.incident_id,
      'apartment_renumbered',
      U&'\05E1\05D9\05DE\05D5\05DF \05DE\05D7\05D3\05E9 \05E9\05DC \05D3\05D9\05E8\05D4',
      v_new_label || U&' \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D9\05EA\05D4 ' || v_old_label,
      'operational',
      'normal',
      now(),
      v_updated_unit.site_id,
      v_updated_unit.floor_id,
      v_updated_unit.id,
      null,
      null,
      'ui',
      null,
      jsonb_build_object(
        'unit_id', v_updated_unit.id,
        'previous_label', v_old_label,
        'current_label', v_new_label,
        'floor_number', v_unit.floor_number,
        'old_base', v_old_base,
        'new_base', v_new_base,
        'suffix', v_suffix,
        'scope', 'site'
      )
    );

    if v_suffix is null then
      v_new_base := v_new_base + 1;
    elsif not exists (
      select 1
      from public.units next_u
      where next_u.site_id = p_site_id
        and next_u.is_active = true
        and coalesce(next_u.zone_type, 'apartment') = 'apartment'
        and next_u.unit_number like 'renumber-%'
        and public.dynamic_structure_apartment_base(regexp_replace(next_u.unit_number, '^renumber-', '')) = v_old_base
        and (
          public.dynamic_structure_suffix_rank(public.dynamic_structure_apartment_suffix(regexp_replace(next_u.unit_number, '^renumber-', ''))) > public.dynamic_structure_suffix_rank(v_suffix)
          or (
            public.dynamic_structure_suffix_rank(public.dynamic_structure_apartment_suffix(regexp_replace(next_u.unit_number, '^renumber-', ''))) = public.dynamic_structure_suffix_rank(v_suffix)
            and public.dynamic_structure_apartment_suffix(regexp_replace(next_u.unit_number, '^renumber-', '')) > v_suffix
          )
        )
    ) then
      v_new_base := v_new_base + 1;
    end if;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.normalize_split_suffixes_for_base(
  p_site_id uuid,
  p_base_number integer,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit record;
  v_updated_unit public.units%rowtype;
  v_rank integer := 1;
  v_old_number text;
  v_new_number text;
  v_old_label text;
  v_new_label text;
begin
  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.units u
  set unit_number = 'renumber-' || u.unit_number
  where u.site_id = p_site_id
    and u.is_active = true
    and coalesce(u.zone_type, 'apartment') = 'apartment'
    and public.dynamic_structure_apartment_base(u.unit_number) = p_base_number
    and public.dynamic_structure_apartment_suffix(u.unit_number) is not null;

  for v_unit in
    select
      u.*,
      public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', '')) as old_suffix
    from public.units u
    where u.site_id = p_site_id
      and u.is_active = true
      and coalesce(u.zone_type, 'apartment') = 'apartment'
      and u.unit_number like 'renumber-%'
      and public.dynamic_structure_apartment_base(regexp_replace(u.unit_number, '^renumber-', '')) = p_base_number
    order by
      public.dynamic_structure_suffix_rank(public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', ''))) asc,
      public.dynamic_structure_apartment_suffix(regexp_replace(u.unit_number, '^renumber-', '')) asc,
      u.created_at,
      u.id
  loop
    v_old_number := p_base_number::text || coalesce(v_unit.old_suffix, '');
    v_new_number := p_base_number::text || public.dynamic_structure_suffix_by_rank(v_rank);

    if v_old_number <> v_new_number then
      v_old_label := U&'\05D3\05D9\05E8\05D4 ' || v_old_number;
      v_new_label := U&'\05D3\05D9\05E8\05D4 ' || v_new_number;

      update public.units
      set previous_unit_label = v_old_number,
          unit_number = v_new_number,
          zone_sequence = p_base_number,
          structure_change_type = 'apartment_renumbered',
          structure_changed_at = now(),
          structure_changed_by = public.current_actor_id(),
          structure_change_reason = p_reason,
          updated_by = public.current_actor_id(),
          updated_at = now()
      where id = v_unit.id
      returning * into v_updated_unit;

      perform public.dynamic_structure_record_history(
        v_updated_unit,
        'apartment_renumbered',
        v_old_label,
        v_new_label,
        p_reason,
        jsonb_build_object('old_label', v_old_label, 'new_label', v_new_label, 'base_number', p_base_number)
      );
    else
      update public.units
      set unit_number = v_new_number,
          zone_sequence = p_base_number,
          updated_by = public.current_actor_id(),
          updated_at = now()
      where id = v_unit.id;
    end if;

    v_rank := v_rank + 1;
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

  perform public.dynamic_structure_release_inactive_site_numbers(v_floor.site_id);

  if p_position is null then
    select coalesce(max(public.dynamic_structure_apartment_base(u.unit_number)), 0) + 1 into v_position
    from public.units u
    join public.floors f on f.id = u.floor_id
    where u.site_id = v_floor.site_id
      and u.is_active = true
      and coalesce(u.zone_type, 'apartment') = 'apartment';
  else
    v_position := greatest(1, p_position);
  end if;

  perform public.renumber_site_apartments_from(
    v_floor.site_id,
    v_floor.floor_number,
    v_position,
    v_position + 1,
    p_reason
  );

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
    jsonb_build_object('floor_id', p_floor_id, 'position', v_position, 'default_potential', 5, 'scope', 'site')
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
    jsonb_build_object('unit_id', v_new_unit.id, 'floor_number', v_floor.floor_number, 'current_label', v_new_unit.unit_number, 'scope', 'site')
  );

  return v_new_unit.id;
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
  v_base_number integer;
  v_suffix text;
  v_same_base_remaining integer;
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

  v_base_number := public.dynamic_structure_apartment_base(v_unit.unit_number);
  v_suffix := public.dynamic_structure_apartment_suffix(v_unit.unit_number);
  v_old_label := public.dynamic_structure_unit_label(v_unit);

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
      previous_unit_label = coalesce(previous_unit_label, regexp_replace(v_unit.unit_number, '^renumber-', '')),
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
    jsonb_build_object('unit_id', v_unit.id, 'base_number', v_base_number, 'suffix', v_suffix, 'scope', 'site')
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
    jsonb_build_object('unit_id', v_unit.id, 'previous_label', v_old_label, 'reason', p_reason, 'base_number', v_base_number, 'suffix', v_suffix, 'scope', 'site')
  );

  if v_base_number is null then
    return;
  end if;

  if v_suffix is not null then
    select count(*) into v_same_base_remaining
    from public.units u
    where u.site_id = v_unit.site_id
      and u.is_active = true
      and coalesce(u.zone_type, 'apartment') = 'apartment'
      and public.dynamic_structure_apartment_base(u.unit_number) = v_base_number;

    if v_same_base_remaining > 0 then
      perform public.normalize_split_suffixes_for_base(v_unit.site_id, v_base_number, p_reason);
    else
      perform public.renumber_site_apartments_from(
        v_unit.site_id,
        v_floor.floor_number,
        v_base_number + 1,
        v_base_number,
        p_reason
      );
    end if;
  else
    perform public.renumber_site_apartments_from(
      v_unit.site_id,
      v_floor.floor_number,
      v_base_number + 1,
      v_base_number,
      p_reason
    );
  end if;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.dynamic_structure_apartment_base(text) to authenticated;
grant execute on function public.dynamic_structure_apartment_suffix(text) to authenticated;
grant execute on function public.dynamic_structure_suffix_rank(text) to authenticated;
grant execute on function public.dynamic_structure_suffix_by_rank(integer) to authenticated;
grant execute on function public.renumber_site_apartments_from(uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.normalize_split_suffixes_for_base(uuid, integer, text) to authenticated;
grant execute on function public.add_apartment_to_floor(uuid, integer, text) to authenticated;
grant execute on function public.remove_apartment_unit(uuid, text) to authenticated;
