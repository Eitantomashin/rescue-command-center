-- Phase 6A QA: make apartment numbering visibly and operationally independent
-- from parking, storage, commercial, and other non-apartment zones.
--
-- The current create_site_from_wizard function already uses a dedicated
-- apartment counter. This migration strengthens the safe repair function for
-- existing test sites and documents the numbering rule in function comments.

create or replace function public.repair_site_wizard_unit_numbering(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_floor record;
  v_unit record;
  v_apartment_number integer := 0;
  v_zone_sequence integer;
  v_zone_type text;
  v_unit_number text;
begin
  select * into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site % does not exist', p_site_id;
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'repair_site_wizard_unit_numbering');
  perform set_config('rcc.allow_structure_write', 'on', true);

  -- Temporarily move every unit_number away from user-visible numbering to
  -- avoid floor-level unique conflicts while repairing in place.
  update public.units
  set
    unit_number = 'repair-' || id::text,
    updated_by = public.current_actor_id()
  where site_id = p_site_id;

  for v_floor in
    select id, floor_number
    from public.floors
    where site_id = p_site_id
    order by floor_number asc
  loop
    for v_unit in
      select *
      from public.units
      where floor_id = v_floor.id
      order by
        case when coalesce(zone_type, 'apartment') = 'apartment' then 0 else 1 end,
        created_at asc,
        id asc
    loop
      v_zone_type := coalesce(v_unit.zone_type, 'apartment');

      if v_zone_type = 'apartment' then
        -- Apartment numbers are a dedicated sequence across apartment units
        -- only. Parking/storage/store units never increment this counter.
        v_apartment_number := v_apartment_number + 1;
        v_zone_sequence := v_apartment_number;
        v_unit_number := v_apartment_number::text;

        update public.units
        set
          unit_number = v_unit_number,
          zone_type = 'apartment',
          zone_name = null,
          zone_sequence = v_zone_sequence,
          family_name = null,
          updated_by = public.current_actor_id()
        where id = v_unit.id;
      else
        select count(*)::integer + 1
        into v_zone_sequence
        from public.units
        where floor_id = v_floor.id
          and zone_type = v_zone_type
          and unit_number not like 'repair-%';

        update public.units
        set
          unit_number = v_zone_type || '-' || v_zone_sequence,
          zone_sequence = v_zone_sequence,
          updated_by = public.current_actor_id()
        where id = v_unit.id;
      end if;
    end loop;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_unit_numbering_repaired',
    'תיקון מספור יחידות באתר',
    'עודכן מספור דירות ואזורים באתר ' || v_site.site_number || ': דירות נספרות בנפרד מאזורים לא דירתיים',
    'correction',
    'normal',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'system',
    null,
    jsonb_build_object(
      'site_id', p_site_id,
      'numbering_model', 'phase6a_apartments_independent_from_non_apartment_zones'
    )
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

comment on function public.create_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb)
  is 'Creates a complete operational site from the Phase 6A wizard. Apartment numbering uses a dedicated sequence that starts at 1 on the first apartment level and is never affected by non-apartment zones.';

comment on function public.repair_site_wizard_unit_numbering(uuid)
  is 'Safely repairs Phase 6A wizard unit numbering for an existing site. Apartment numbering is independent from parking, storage, commercial, and other non-apartment zones.';

-- Validation after repairing a test site:
-- select f.floor_number, u.zone_type, u.unit_number, u.zone_sequence
-- from public.units u
-- join public.floors f on f.id = u.floor_id
-- where u.site_id = '<site_id>'::uuid
-- order by f.floor_number, coalesce(u.zone_type, 'apartment'), u.zone_sequence;
