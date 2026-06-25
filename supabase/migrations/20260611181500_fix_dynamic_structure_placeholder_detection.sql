-- Fix placeholder detection for dynamic apartment removal.
-- Empty system-created placeholder residents must not block apartment removal.

create or replace function public.dynamic_structure_has_important_resident_data(p_unit_id uuid)
returns boolean
language sql
stable
as $$
  with resident_data as (
    select
      ur.*,
      st.status_key,
      lower(
        btrim(
          concat_ws(' ', nullif(btrim(coalesce(ur.first_name, '')), ''), nullif(btrim(coalesce(ur.last_name, '')), ''))
        )
      ) as combined_name
    from public.unit_residents ur
    left join public.status_types st on st.id = ur.status_id
    where ur.unit_id = p_unit_id
      and ur.is_active = true
  )
  select exists (
    select 1
    from resident_data rd
    where rd.linked_person_id is not null
      or rd.age is not null
      or nullif(btrim(coalesce(rd.phone, '')), '') is not null
      or coalesce(rd.gender, 'unknown') <> 'unknown'
      or (
        nullif(btrim(coalesce(rd.notes, '')), '') is not null
        and btrim(coalesce(rd.notes, '')) <> 'placeholder'
        and btrim(coalesce(rd.notes, '')) not like 'placeholder;%'
      )
      or coalesce(rd.status_key, 'missing') <> 'missing'
      or (
        nullif(rd.combined_name, '') is not null
        and rd.combined_name !~ U&'^\05D3\05D9\05D9\05E8[[:space:]]*[0-9]*$'
      )
  )
$$;

grant execute on function public.dynamic_structure_has_important_resident_data(uuid) to authenticated;
