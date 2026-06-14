-- Phase 6A Site Wizard Numbering Validation
--
-- Usage:
-- 1. Replace the site id below.
-- 2. Run after creating a site from the Phase 6A wizard.
-- 3. For an existing test site created before the fix, optionally run:
--    select public.repair_site_wizard_unit_numbering('<site_id>'::uuid);

with target as (
  select '<site_id>'::uuid as site_id
),
unit_labels as (
  select
    f.floor_number,
    u.id as unit_id,
    u.zone_type,
    u.unit_number,
    u.zone_sequence,
    case
      when coalesce(u.zone_type, 'apartment') = 'apartment'
        then 'דירה ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'parking_area'
        then 'חניה ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'store'
        then 'חנות ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'warehouse'
        then 'מחסן ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'office'
        then 'משרד ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'shelter'
        then 'מקלט ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'machine_room'
        then 'חדר מכונות ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'commercial_area'
        then 'שטח מסחרי ' || coalesce(u.zone_sequence::text, u.unit_number)
      else coalesce(u.zone_name, 'אזור') || ' ' || coalesce(u.zone_sequence::text, u.unit_number)
    end as display_label
  from public.units u
  join public.floors f on f.id = u.floor_id
  join target t on t.site_id = u.site_id
)
select *
from unit_labels
order by floor_number, zone_type, zone_sequence, unit_number;

-- Apartment continuity check. Expected: apartment_number = expected_apartment_number.
with target as (
  select '<site_id>'::uuid as site_id
),
apartments as (
  select
    f.floor_number,
    coalesce(u.zone_sequence, u.unit_number::integer) as apartment_number,
    row_number() over (order by f.floor_number asc, coalesce(u.zone_sequence, u.unit_number::integer) asc) as expected_apartment_number
  from public.units u
  join public.floors f on f.id = u.floor_id
  join target t on t.site_id = u.site_id
  where coalesce(u.zone_type, 'apartment') = 'apartment'
)
select *
from apartments
where apartment_number <> expected_apartment_number;

-- Duplicate display-label check. Expected: zero rows.
with target as (
  select '<site_id>'::uuid as site_id
),
unit_labels as (
  select
    f.floor_number,
    case
      when coalesce(u.zone_type, 'apartment') = 'apartment'
        then 'דירה ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'parking_area'
        then 'חניה ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'store'
        then 'חנות ' || coalesce(u.zone_sequence::text, u.unit_number)
      when u.zone_type = 'warehouse'
        then 'מחסן ' || coalesce(u.zone_sequence::text, u.unit_number)
      else coalesce(u.zone_name, u.zone_type, 'אזור') || ' ' || coalesce(u.zone_sequence::text, u.unit_number)
    end as display_label
  from public.units u
  join public.floors f on f.id = u.floor_id
  join target t on t.site_id = u.site_id
)
select floor_number, display_label, count(*) as duplicates
from unit_labels
group by floor_number, display_label
having count(*) > 1;
