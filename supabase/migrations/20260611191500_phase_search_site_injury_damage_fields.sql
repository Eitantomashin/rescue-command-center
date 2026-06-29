-- Search Site injury counts and apartment damage fields.
-- Search Sites only. Existing rescue-site behavior is unchanged.

alter table public.site_search_units
  add column if not exists anxiety_casualties_count integer not null default 0,
  add column if not exists physical_casualties_count integer not null default 0,
  add column if not exists has_apartment_damage boolean not null default false,
  add column if not exists apartment_damage_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_search_units_anxiety_casualties_count_nonnegative'
      and conrelid = 'public.site_search_units'::regclass
  ) then
    alter table public.site_search_units
      add constraint site_search_units_anxiety_casualties_count_nonnegative
      check (anxiety_casualties_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_search_units_physical_casualties_count_nonnegative'
      and conrelid = 'public.site_search_units'::regclass
  ) then
    alter table public.site_search_units
      add constraint site_search_units_physical_casualties_count_nonnegative
      check (physical_casualties_count >= 0);
  end if;
end;
$$;

drop function if exists public.create_or_update_search_unit(uuid, uuid, text, integer, text, text, boolean, boolean, boolean, text);

create or replace function public.create_or_update_search_unit(
  p_site_id uuid,
  p_unit_id uuid,
  p_family_name text default null,
  p_occupants_count integer default null,
  p_contact_phone text default null,
  p_search_status text default 'not_visited',
  p_casualty_psych boolean default false,
  p_casualty_body boolean default false,
  p_medical_evacuation boolean default false,
  p_notes text default null,
  p_anxiety_casualties_count integer default 0,
  p_physical_casualties_count integer default 0,
  p_has_apartment_damage boolean default false,
  p_apartment_damage_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_unit public.units%rowtype;
  v_id uuid;
  v_status text := coalesce(nullif(btrim(coalesce(p_search_status, '')), ''), 'not_visited');
  v_event record;
  v_previous public.site_search_units%rowtype;
  v_anxiety_count integer := coalesce(p_anxiety_casualties_count, 0);
  v_physical_count integer := coalesce(p_physical_casualties_count, 0);
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Search Site not found';
  end if;

  if v_site.site_type <> 'search_site' then
    raise exception 'Search unit results can only be updated for Search Sites';
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'create_or_update_search_unit');

  select * into v_unit from public.units where id = p_unit_id;
  if not found then
    raise exception 'Unit not found';
  end if;

  if v_unit.site_id <> p_site_id or v_unit.incident_id <> v_site.incident_id then
    raise exception 'Unit must belong to the selected Search Site';
  end if;

  if v_status not in ('not_visited', 'no_answer', 'clear', 'casualties', 'completed') then
    raise exception 'Invalid Search Site unit status: %', v_status;
  end if;

  if p_occupants_count is not null and p_occupants_count < 0 then
    raise exception 'Occupants count cannot be negative';
  end if;

  if v_anxiety_count < 0 or v_physical_count < 0 then
    raise exception 'Casualty counts cannot be negative';
  end if;

  if v_anxiety_count > 0
    or v_physical_count > 0
    or coalesce(p_casualty_psych, false)
    or coalesce(p_casualty_body, false)
  then
    v_status := 'casualties';
  end if;

  select * into v_previous
  from public.site_search_units
  where site_id = p_site_id and unit_id = p_unit_id;

  insert into public.site_search_units (
    incident_id,
    site_id,
    unit_id,
    family_name,
    occupants_count,
    contact_phone,
    search_status,
    casualty_psych,
    casualty_body,
    medical_evacuation,
    anxiety_casualties_count,
    physical_casualties_count,
    has_apartment_damage,
    apartment_damage_notes,
    notes,
    searched_by,
    searched_at,
    completed_at
  )
  values (
    v_site.incident_id,
    p_site_id,
    p_unit_id,
    nullif(btrim(coalesce(p_family_name, '')), ''),
    p_occupants_count,
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    v_status,
    coalesce(p_casualty_psych, false) or v_anxiety_count > 0,
    coalesce(p_casualty_body, false) or v_physical_count > 0,
    coalesce(p_medical_evacuation, false),
    v_anxiety_count,
    v_physical_count,
    coalesce(p_has_apartment_damage, false),
    nullif(btrim(coalesce(p_apartment_damage_notes, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    now(),
    case when v_status = 'completed' then now() else null end
  )
  on conflict (site_id, unit_id) do update
  set
    family_name = excluded.family_name,
    occupants_count = excluded.occupants_count,
    contact_phone = excluded.contact_phone,
    search_status = excluded.search_status,
    casualty_psych = excluded.casualty_psych,
    casualty_body = excluded.casualty_body,
    medical_evacuation = excluded.medical_evacuation,
    anxiety_casualties_count = excluded.anxiety_casualties_count,
    physical_casualties_count = excluded.physical_casualties_count,
    has_apartment_damage = excluded.has_apartment_damage,
    apartment_damage_notes = excluded.apartment_damage_notes,
    notes = excluded.notes,
    searched_by = excluded.searched_by,
    searched_at = excluded.searched_at,
    completed_at = case
      when excluded.search_status = 'completed' then coalesce(public.site_search_units.completed_at, now())
      else null
    end
  returning id into v_id;

  select * into v_event from public.search_unit_event_text(v_status);

  perform public.create_event_log(
    v_site.incident_id,
    v_event.log_type,
    v_event.title,
    v_event.description,
    'operational',
    v_event.importance,
    now(),
    v_site.id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    U&'\05DE\05E2\05E8\05DB\05EA',
    null,
    jsonb_build_object(
      'search_unit_id', v_id,
      'site_id', v_site.id,
      'unit_id', v_unit.id,
      'old_search_status', v_previous.search_status,
      'new_search_status', v_status,
      'family_name', nullif(btrim(coalesce(p_family_name, '')), ''),
      'occupants_count', p_occupants_count,
      'casualty_psych', coalesce(p_casualty_psych, false) or v_anxiety_count > 0,
      'casualty_body', coalesce(p_casualty_body, false) or v_physical_count > 0,
      'medical_evacuation', coalesce(p_medical_evacuation, false),
      'anxiety_casualties_count', v_anxiety_count,
      'physical_casualties_count', v_physical_count,
      'has_apartment_damage', coalesce(p_has_apartment_damage, false),
      'apartment_damage_notes', nullif(btrim(coalesce(p_apartment_damage_notes, '')), '')
    )
  );

  return v_id;
end;
$$;

create or replace function public.get_search_site_summary(p_site_id uuid)
returns table(
  clear_count integer,
  completed_count integer,
  no_answer_count integer,
  casualties_count integer,
  not_visited_count integer,
  total_units integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Search Site not found';
  end if;

  if v_site.site_type <> 'search_site' then
    raise exception 'Search Site summary is available only for Search Sites';
  end if;

  if not public.can_view_incident(v_site.incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  return query
  with unit_statuses as (
    select
      u.id,
      case
        when coalesce(ssu.anxiety_casualties_count, 0) > 0
          or coalesce(ssu.physical_casualties_count, 0) > 0
          or coalesce(ssu.casualty_psych, false)
          or coalesce(ssu.casualty_body, false)
          or ssu.search_status = 'casualties'
          then 'casualties'
        when ssu.search_status = 'completed' then 'completed'
        when ssu.search_status = 'no_answer' then 'no_answer'
        when ssu.search_status = 'clear' then 'clear'
        else 'not_visited'
      end as effective_status
    from public.units u
    left join public.site_search_units ssu
      on ssu.site_id = u.site_id
     and ssu.unit_id = u.id
    where u.site_id = p_site_id
      and u.incident_id = v_site.incident_id
      and u.is_active = true
  )
  select
    count(id) filter (where effective_status = 'clear')::integer as clear_count,
    count(id) filter (where effective_status = 'completed')::integer as completed_count,
    count(id) filter (where effective_status = 'no_answer')::integer as no_answer_count,
    count(id) filter (where effective_status = 'casualties')::integer as casualties_count,
    count(id) filter (where effective_status = 'not_visited')::integer as not_visited_count,
    count(id)::integer as total_units
  from unit_statuses;
end;
$$;

grant execute on function public.create_or_update_search_unit(uuid, uuid, text, integer, text, text, boolean, boolean, boolean, text, integer, integer, boolean, text) to authenticated;
grant execute on function public.get_search_site_summary(uuid) to authenticated;
