-- Phase 5B resident name sync validation.
--
-- Expected result:
-- mismatched_synced_resident_names = 0
--
-- This query checks active linked residents whose linked operational person has
-- a known name and whose resident row still looks like a placeholder after
-- linking. It also catches the observed swapped/partial bug shape where
-- resident.first_name = person.last_name and resident.last_name = 'דייר N'.

with linked as (
  select
    ur.id as resident_id,
    ur.first_name as resident_first_name,
    ur.last_name as resident_last_name,
    p.id as person_id,
    p.operational_number,
    p.first_name as person_first_name,
    p.last_name as person_last_name,
    nullif(btrim(concat_ws(' ', ur.first_name, ur.last_name)), '') as resident_display_name,
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as person_display_name
  from public.unit_residents ur
  join public.persons p on p.id = ur.linked_person_id
  where ur.is_active = true
    and p.is_merged = false
    and nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') is not null
)
select
  count(*)::integer as mismatched_synced_resident_names
from linked
where resident_display_name ~ '^דייר[[:space:]]+[0-9]+$'
   or (
     resident_first_name = person_last_name
     and resident_last_name ~ '^דייר[[:space:]]+[0-9]+$'
   );

select
  ur.id as resident_id,
  ur.first_name as resident_first_name,
  ur.last_name as resident_last_name,
  p.operational_number,
  p.first_name as person_first_name,
  p.last_name as person_last_name
from public.unit_residents ur
join public.persons p on p.id = ur.linked_person_id
where ur.is_active = true
  and p.is_merged = false
  and nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') is not null
  and (
    nullif(btrim(concat_ws(' ', ur.first_name, ur.last_name)), '') ~ '^דייר[[:space:]]+[0-9]+$'
    or (
      ur.first_name = p.last_name
      and ur.last_name ~ '^דייר[[:space:]]+[0-9]+$'
    )
  )
order by p.operational_number;

-- Expected result:
-- linked_to_person_counts_as_gap_resolved = false
-- Linking alone must not mark a resident as handled/resolved.
select
  coalesce(bool_or(counts_as_gap_resolved), false) as linked_to_person_counts_as_gap_resolved
from public.status_types
where category = 'resident'
  and status_key = 'linked_to_person';
