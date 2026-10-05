-- Historical normalization for units that have never had a search-card record.
-- Operational residents are the only source for the current known count here.
with unscanned_unit_counts as (
  select
    u.id as unit_id,
    count(ur.id)::integer as active_resident_count
  from public.units u
  left join public.unit_residents ur
    on ur.unit_id = u.id
   and ur.is_active = true
  where u.known_people_count is not null
    and not exists (
      select 1
      from public.site_search_units ssu
      where ssu.unit_id = u.id
    )
  group by u.id, u.known_people_count
)
update public.units u
set known_people_count = c.active_resident_count
from unscanned_unit_counts c
where u.id = c.unit_id
  and u.known_people_count <> c.active_resident_count;
