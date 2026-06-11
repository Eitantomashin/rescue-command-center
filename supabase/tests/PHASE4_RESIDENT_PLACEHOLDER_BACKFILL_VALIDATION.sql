-- Phase 4 placeholder backfill validation.
-- Expected result: units_without_5_residents = 0.

select
  count(*)::integer as units_without_5_residents
from (
  select
    u.id,
    count(ur.id) filter (where ur.is_active = true) as active_resident_count
  from public.units u
  left join public.unit_residents ur
    on ur.unit_id = u.id
  where u.is_active = true
  group by u.id
  having count(ur.id) filter (where ur.is_active = true) < 5
) units_below_minimum;

select
  u.id as unit_id,
  u.unit_number,
  u.site_id,
  count(ur.id) filter (where ur.is_active = true) as active_resident_count,
  array_agg(ur.first_name order by ur.first_name) filter (
    where ur.is_active = true
      and ur.first_name ~ '^דייר [1-5]$'
  ) as placeholder_slots
from public.units u
left join public.unit_residents ur
  on ur.unit_id = u.id
where u.is_active = true
group by u.id, u.unit_number, u.site_id
having count(ur.id) filter (where ur.is_active = true) < 5
order by u.site_id, u.unit_number;
