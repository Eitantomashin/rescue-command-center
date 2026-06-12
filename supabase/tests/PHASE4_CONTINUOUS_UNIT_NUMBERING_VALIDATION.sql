-- Phase 4 continuous apartment numbering validation.
-- Expected mismatch rows: 0.

with site_floor_context as (
  select
    s.id as site_id,
    s.site_number,
    coalesce(nullif(s.default_units_per_floor, 0), floor_counts.max_units_per_floor)::integer as units_per_floor,
    min(f.floor_number) as lowest_floor_number
  from public.sites s
  join public.floors f on f.site_id = s.id
  join (
    select
      counted_floors.site_id,
      max(counted_floors.unit_count)::integer as max_units_per_floor
    from (
      select
        f2.site_id,
        f2.id as floor_id,
        count(u2.id) as unit_count
      from public.floors f2
      left join public.units u2 on u2.floor_id = f2.id
      group by f2.site_id, f2.id
    ) counted_floors
    group by counted_floors.site_id
  ) floor_counts on floor_counts.site_id = s.id
  group by s.id, s.site_number, s.default_units_per_floor, floor_counts.max_units_per_floor
),
expected_units as (
  select
    sfc.site_number,
    f.site_id,
    f.floor_number,
    u.id as unit_id,
    u.unit_number,
    (
      ((f.floor_number - sfc.lowest_floor_number) * sfc.units_per_floor)
      + row_number() over (
          partition by f.id
          order by
            case when u.unit_number ~ '^[0-9]+$' then u.unit_number::integer else null end,
            u.created_at,
            u.id
        )
    )::text as expected_unit_number
  from public.units u
  join public.floors f on f.id = u.floor_id
  join site_floor_context sfc on sfc.site_id = u.site_id
)
select
  count(*) filter (where unit_number is distinct from expected_unit_number)::integer as numbering_mismatches
from expected_units;

select
  site_number,
  floor_number,
  string_agg(unit_number, ', ' order by unit_number::integer) as unit_numbers
from expected_units
where unit_number ~ '^[0-9]+$'
group by site_number, floor_number
order by site_number, floor_number;
