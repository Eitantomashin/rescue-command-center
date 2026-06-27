-- Search Site Phase 5B: approved service functions for Search Site unit results.
-- No UI changes. Writes append EventLogs only through public.create_event_log(...).

create or replace function public.search_unit_event_text(p_status text)
returns table(log_type text, title text, description text, importance text)
language sql
stable
set search_path = public
as $$
  select
    case
      when p_status = 'no_answer' then 'search_unit_no_answer'
      when p_status = 'casualties' then 'search_unit_casualties_found'
      when p_status = 'completed' then 'search_unit_completed'
      else 'search_unit_apartment_searched'
    end,
    case
      when p_status = 'no_answer' then '׳׳™׳ ׳׳¢׳ ׳” ׳‘׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳”'
      when p_status = 'casualties' then '׳ ׳׳¦׳׳• ׳ ׳₪׳’׳¢׳™׳ ׳‘׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳”'
      when p_status = 'completed' then '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳”׳•׳©׳׳׳”'
      else '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳ ׳‘׳“׳§׳”'
    end,
    case
      when p_status = 'no_answer' then '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳¡׳•׳׳ ׳” ׳׳׳ ׳׳¢׳ ׳”'
      when p_status = 'casualties' then '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳¡׳•׳׳ ׳” ׳¢׳ ׳ ׳₪׳’׳¢׳™׳'
      when p_status = 'completed' then '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳¡׳•׳׳ ׳” ׳›׳”׳•׳©׳׳׳”'
      else '׳¢׳•׳“׳›׳ ׳• ׳₪׳¨׳˜׳™ ׳¡׳¨׳™׳§׳” ׳׳“׳™׳¨׳”'
    end,
    case
      when p_status = 'casualties' then 'important'
      else 'normal'
    end;
$$;

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
  p_notes text default null
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
    coalesce(p_casualty_psych, false),
    coalesce(p_casualty_body, false),
    coalesce(p_medical_evacuation, false),
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
    '׳׳¢׳¨׳›׳×',
    null,
    jsonb_build_object(
      'search_unit_id', v_id,
      'site_id', v_site.id,
      'unit_id', v_unit.id,
      'old_search_status', v_previous.search_status,
      'new_search_status', v_status,
      'family_name', nullif(btrim(coalesce(p_family_name, '')), ''),
      'occupants_count', p_occupants_count,
      'casualty_psych', coalesce(p_casualty_psych, false),
      'casualty_body', coalesce(p_casualty_body, false),
      'medical_evacuation', coalesce(p_medical_evacuation, false)
    )
  );

  return v_id;
end;
$$;

create or replace function public.complete_search_unit(
  p_site_id uuid,
  p_unit_id uuid
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
  v_previous public.site_search_units%rowtype;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Search Site not found';
  end if;

  if v_site.site_type <> 'search_site' then
    raise exception 'Search unit results can only be completed for Search Sites';
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'complete_search_unit');

  select * into v_unit from public.units where id = p_unit_id;
  if not found then
    raise exception 'Unit not found';
  end if;

  if v_unit.site_id <> p_site_id or v_unit.incident_id <> v_site.incident_id then
    raise exception 'Unit must belong to the selected Search Site';
  end if;

  select * into v_previous
  from public.site_search_units
  where site_id = p_site_id and unit_id = p_unit_id;

  insert into public.site_search_units (
    incident_id,
    site_id,
    unit_id,
    search_status,
    searched_by,
    searched_at,
    completed_at
  )
  values (
    v_site.incident_id,
    p_site_id,
    p_unit_id,
    'completed',
    public.current_actor_id(),
    now(),
    now()
  )
  on conflict (site_id, unit_id) do update
  set
    search_status = 'completed',
    searched_by = public.current_actor_id(),
    searched_at = now(),
    completed_at = now()
  returning id into v_id;

  perform public.create_event_log(
    v_site.incident_id,
    'search_unit_completed',
    '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳”׳•׳©׳׳׳”',
    '׳“׳™׳¨׳× ׳¡׳¨׳™׳§׳” ׳¡׳•׳׳ ׳” ׳›׳”׳•׳©׳׳׳”',
    'operational',
    'normal',
    now(),
    v_site.id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    '׳׳¢׳¨׳›׳×',
    null,
    jsonb_build_object(
      'search_unit_id', v_id,
      'site_id', v_site.id,
      'unit_id', v_unit.id,
      'old_search_status', v_previous.search_status,
      'new_search_status', 'completed'
    )
  );

  return v_id;
end;
$$;

create or replace function public.get_search_site_summary(p_site_id uuid)
returns table(
  total_units integer,
  not_visited integer,
  no_answer integer,
  casualties integer,
  completed integer
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
  select
    count(u.id)::integer as total_units,
    count(u.id) filter (where coalesce(ssu.search_status, 'not_visited') = 'not_visited')::integer as not_visited,
    count(u.id) filter (where ssu.search_status = 'no_answer')::integer as no_answer,
    count(u.id) filter (where ssu.search_status = 'casualties')::integer as casualties,
    count(u.id) filter (where ssu.search_status = 'completed')::integer as completed
  from public.units u
  left join public.site_search_units ssu
    on ssu.site_id = u.site_id
   and ssu.unit_id = u.id
  where u.site_id = p_site_id
    and u.incident_id = v_site.incident_id
    and u.is_active = true;
end;
$$;

grant execute on function public.create_or_update_search_unit(uuid, uuid, text, integer, text, text, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.complete_search_unit(uuid, uuid) to authenticated;
grant execute on function public.get_search_site_summary(uuid) to authenticated;