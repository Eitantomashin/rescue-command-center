-- Allow structure removal by unit id for any active unit type, not only apartments.
-- Existing safety checks remain in place: no active operational numbers, no important resident data,
-- no closed/archived incident or site, and all writes still use the approved structure-write path.

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
  v_is_apartment boolean;
begin
  select * into v_unit from public.units where id = p_unit_id for update;
  if not found then
    raise exception 'Unit does not exist';
  end if;

  select * into v_site from public.sites where id = v_unit.site_id;
  select * into v_floor from public.floors where id = v_unit.floor_id;

  perform public.assert_edit_operational_data(v_unit.incident_id);

  v_is_apartment := coalesce(v_unit.zone_type, 'apartment') = 'apartment';

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

  if v_is_apartment then
    v_base_number := public.dynamic_structure_apartment_base(v_unit.unit_number);
    v_suffix := public.dynamic_structure_apartment_suffix(v_unit.unit_number);
  else
    v_base_number := null;
    v_suffix := null;
  end if;

  v_old_label := public.dynamic_structure_unit_label(v_unit);

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.unit_residents
  set is_active = false,
      notes = coalesce(nullif(notes, ''), 'placeholder') || '; inactive_after_unit_removed',
      updated_by = public.current_actor_id(),
      updated_at = now()
  where unit_id = v_unit.id
    and is_active = true;

  update public.units
  set is_active = false,
      unit_number = 'removed-' || id::text,
      inactive_reason = coalesce(nullif(p_reason, ''), U&'\05D4\05D5\05E1\05E8\05D4 \05D9\05D7\05D9\05D3\05D4 \05D1\05D6\05DE\05DF \05D0\05D9\05E8\05D5\05E2'),
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
    jsonb_build_object('unit_id', v_unit.id, 'base_number', v_base_number, 'suffix', v_suffix, 'scope', 'site', 'zone_type', v_unit.zone_type)
  );

  perform public.create_event_log(
    v_unit.incident_id,
    'apartment_removed',
    U&'\05D4\05E1\05E8\05EA \05D9\05D7\05D9\05D3\05D4',
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
    jsonb_build_object('unit_id', v_unit.id, 'previous_label', v_old_label, 'reason', p_reason, 'base_number', v_base_number, 'suffix', v_suffix, 'scope', 'site', 'zone_type', v_unit.zone_type)
  );

  if not v_is_apartment or v_base_number is null then
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

grant execute on function public.remove_apartment_unit(uuid, text) to authenticated;
