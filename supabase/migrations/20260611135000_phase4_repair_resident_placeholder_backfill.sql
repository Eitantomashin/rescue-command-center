alter table public.status_types
  add column if not exists counts_as_gap_resolved boolean not null default false;

insert into public.status_types (
  incident_id,
  category,
  status_key,
  name,
  hebrew_label,
  color,
  is_open,
  is_dashboard_counted,
  is_default,
  counts_as_gap_resolved,
  sort_order
)
values (
  null,
  'resident',
  'missing',
  'Missing',
  'נעדר',
  'blue',
  true,
  true,
  true,
  false,
  40
)
on conflict do nothing;

update public.status_types
set
  hebrew_label = 'נעדר',
  color = 'blue',
  is_active = true,
  counts_as_gap_resolved = false
where category = 'resident'
  and status_key = 'missing';

update public.unit_residents ur
set site_id = u.site_id
from public.units u
where ur.unit_id = u.id
  and ur.site_id is null;

with active_unit_counts as (
  select
    u.id as unit_id,
    u.incident_id,
    u.site_id,
    count(ur.id) filter (where ur.is_active = true)::integer as active_resident_count
  from public.units u
  left join public.unit_residents ur
    on ur.unit_id = u.id
  where u.is_active = true
  group by u.id, u.incident_id, u.site_id
),
unit_deficits as (
  select *
  from active_unit_counts
  where active_resident_count < 5
),
missing_placeholder_slots as (
  select
    ud.unit_id,
    ud.incident_id,
    ud.site_id,
    ud.active_resident_count,
    gs.slot_number,
    row_number() over (
      partition by ud.unit_id
      order by gs.slot_number
    ) as missing_slot_order
  from unit_deficits ud
  cross join lateral generate_series(1, 5) as gs(slot_number)
  where not exists (
    select 1
    from public.unit_residents existing_resident
    where existing_resident.unit_id = ud.unit_id
      and existing_resident.is_active = true
      and btrim(coalesce(existing_resident.first_name, '')) = 'דייר ' || gs.slot_number
  )
),
repair_rows as (
  select
    mps.unit_id,
    mps.incident_id,
    mps.site_id,
    mps.slot_number,
    status_lookup.id as missing_status_id
  from missing_placeholder_slots mps
  join lateral (
    select st.id
    from public.status_types st
    where st.category = 'resident'
      and st.status_key = 'missing'
      and st.is_active = true
      and (st.incident_id = mps.incident_id or st.incident_id is null)
    order by st.incident_id is null
    limit 1
  ) status_lookup on true
  where mps.missing_slot_order <= (5 - mps.active_resident_count)
)
insert into public.unit_residents (
  incident_id,
  site_id,
  unit_id,
  first_name,
  status_id,
  notes
)
select
  rr.incident_id,
  rr.site_id,
  rr.unit_id,
  'דייר ' || rr.slot_number,
  rr.missing_status_id,
  'placeholder'
from repair_rows rr
where not exists (
  select 1
  from public.unit_residents existing_resident
  where existing_resident.unit_id = rr.unit_id
    and existing_resident.is_active = true
    and btrim(coalesce(existing_resident.first_name, '')) = 'דייר ' || rr.slot_number
);

do $$
declare
  v_units_without_5_residents integer;
begin
  select count(*)::integer
  into v_units_without_5_residents
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

  if v_units_without_5_residents > 0 then
    raise exception 'Resident placeholder repair failed: % active units still have fewer than 5 active residents',
      v_units_without_5_residents;
  end if;
end $$;
