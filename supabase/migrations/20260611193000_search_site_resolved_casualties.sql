-- Search Site resolved casualties.
-- Keeps casualty findings as historical data while allowing the current unit status to become completed/cleared.

alter table public.site_search_units
  add column if not exists casualties_resolved boolean not null default false,
  add column if not exists casualties_resolved_at timestamptz;

update public.site_search_units
set casualties_resolved = true,
    casualties_resolved_at = coalesce(casualties_resolved_at, completed_at, searched_at, updated_at, now())
where search_status = 'completed'
  and (
    coalesce(anxiety_casualties_count, 0) > 0
    or coalesce(physical_casualties_count, 0) > 0
    or coalesce(medical_evacuation, false) = true
  )
  and casualties_resolved = false;

drop function if exists public.create_or_update_search_unit(uuid, uuid, text, integer, text, text, boolean, boolean, boolean, text, integer, integer, boolean, text);

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
  v_has_casualty_finding boolean;
  v_resolved boolean;
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

  select * into v_previous
  from public.site_search_units
  where site_id = p_site_id and unit_id = p_unit_id;

  v_has_casualty_finding :=
    v_anxiety_count > 0
    or v_physical_count > 0
    or coalesce(p_casualty_psych, false)
    or coalesce(p_casualty_body, false)
    or coalesce(p_medical_evacuation, false);

  if v_has_casualty_finding and v_status <> 'completed' then
    v_status := 'casualties';
  end if;

  v_resolved := v_status = 'completed' and v_has_casualty_finding;

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
    casualties_resolved,
    casualties_resolved_at,
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
    v_resolved,
    case when v_resolved then now() else null end,
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
    casualties_resolved = excluded.casualties_resolved,
    casualties_resolved_at = case
      when excluded.casualties_resolved then coalesce(public.site_search_units.casualties_resolved_at, now())
      else null
    end,
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
      'casualties_resolved', v_resolved,
      'has_apartment_damage', coalesce(p_has_apartment_damage, false),
      'apartment_damage_notes', nullif(btrim(coalesce(p_apartment_damage_notes, '')), '')
    )
  );

  if v_resolved and coalesce(v_previous.casualties_resolved, false) = false then
    perform public.create_event_log(
      v_site.incident_id,
      'search_unit_casualties_resolved',
      U&'\05D8\05D9\05E4\05D5\05DC \05D1\05E0\05E4\05D2\05E2\05D9\05DD \05D4\05D5\05E9\05DC\05DD',
      U&'\05D3\05D9\05E8\05D4 \05E9\05D3\05D5\05D5\05D7\05D5 \05D1\05D4 \05E0\05E4\05D2\05E2\05D9\05DD \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D5\05E9\05DC\05DE\05D4',
      'operational',
      'important',
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
        'anxiety_casualties_count', v_anxiety_count,
        'physical_casualties_count', v_physical_count,
        'medical_evacuation', coalesce(p_medical_evacuation, false)
      )
    );
  end if;

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
  v_has_casualty_finding boolean;
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

  v_has_casualty_finding :=
    coalesce(v_previous.anxiety_casualties_count, 0) > 0
    or coalesce(v_previous.physical_casualties_count, 0) > 0
    or coalesce(v_previous.casualty_psych, false)
    or coalesce(v_previous.casualty_body, false)
    or coalesce(v_previous.medical_evacuation, false);

  insert into public.site_search_units (
    incident_id,
    site_id,
    unit_id,
    search_status,
    casualties_resolved,
    casualties_resolved_at,
    searched_by,
    searched_at,
    completed_at
  )
  values (
    v_site.incident_id,
    p_site_id,
    p_unit_id,
    'completed',
    false,
    null,
    public.current_actor_id(),
    now(),
    now()
  )
  on conflict (site_id, unit_id) do update
  set
    search_status = 'completed',
    casualties_resolved = v_has_casualty_finding,
    casualties_resolved_at = case
      when v_has_casualty_finding then coalesce(public.site_search_units.casualties_resolved_at, now())
      else null
    end,
    searched_by = public.current_actor_id(),
    searched_at = now(),
    completed_at = now()
  returning id into v_id;

  perform public.create_event_log(
    v_site.incident_id,
    'search_unit_completed',
    U&'\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4 \05D4\05D5\05E9\05DC\05DE\05D4',
    U&'\05D4\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D5\05E9\05DC\05DE\05D4',
    'operational',
    'normal',
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
      'new_search_status', 'completed',
      'casualties_resolved', v_has_casualty_finding
    )
  );

  if v_has_casualty_finding and coalesce(v_previous.casualties_resolved, false) = false then
    perform public.create_event_log(
      v_site.incident_id,
      'search_unit_casualties_resolved',
      U&'\05D8\05D9\05E4\05D5\05DC \05D1\05E0\05E4\05D2\05E2\05D9\05DD \05D4\05D5\05E9\05DC\05DD',
      U&'\05D3\05D9\05E8\05D4 \05E9\05D3\05D5\05D5\05D7\05D5 \05D1\05D4 \05E0\05E4\05D2\05E2\05D9\05DD \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D5\05E9\05DC\05DE\05D4',
      'operational',
      'important',
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
        'anxiety_casualties_count', coalesce(v_previous.anxiety_casualties_count, 0),
        'physical_casualties_count', coalesce(v_previous.physical_casualties_count, 0),
        'medical_evacuation', coalesce(v_previous.medical_evacuation, false)
      )
    );
  end if;

  return v_id;
end;
$$;

drop function if exists public.get_search_site_summary(uuid);

create or replace function public.get_search_site_summary(p_site_id uuid)
returns table(
  clear_count integer,
  completed_count integer,
  no_answer_count integer,
  casualties_count integer,
  not_visited_count integer,
  total_units integer,
  reported_casualties_count integer,
  open_casualties_count integer,
  resolved_casualties_count integer
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
      coalesce(ssu.anxiety_casualties_count, 0) + coalesce(ssu.physical_casualties_count, 0) as casualty_total,
      coalesce(ssu.casualties_resolved, false) as casualties_resolved,
      case
        when ssu.search_status = 'completed' then 'completed'
        when (
          coalesce(ssu.anxiety_casualties_count, 0) > 0
          or coalesce(ssu.physical_casualties_count, 0) > 0
          or coalesce(ssu.casualty_psych, false)
          or coalesce(ssu.casualty_body, false)
          or coalesce(ssu.medical_evacuation, false)
          or ssu.search_status = 'casualties'
        ) and coalesce(ssu.casualties_resolved, false) = false
          then 'casualties'
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
    count(id)::integer as total_units,
    coalesce(sum(casualty_total), 0)::integer as reported_casualties_count,
    coalesce(sum(casualty_total) filter (where casualty_total > 0 and casualties_resolved = false), 0)::integer as open_casualties_count,
    coalesce(sum(casualty_total) filter (where casualty_total > 0 and casualties_resolved = true), 0)::integer as resolved_casualties_count
  from unit_statuses;
end;
$$;

grant execute on function public.create_or_update_search_unit(uuid, uuid, text, integer, text, text, boolean, boolean, boolean, text, integer, integer, boolean, text) to authenticated;
grant execute on function public.complete_search_unit(uuid, uuid) to authenticated;
grant execute on function public.get_search_site_summary(uuid) to authenticated;

create or replace function public.can_write_search_event_log(
  p_incident_id uuid,
  p_log_type text,
  p_site_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_log_type in (
      'search_unit_apartment_searched',
      'search_unit_no_answer',
      'search_unit_casualties_found',
      'search_unit_completed',
      'search_unit_added_in_field',
      'search_unit_casualties_resolved'
    )
    and p_site_id is not null
    and public.can_edit_search_site_data(p_incident_id)
    and exists (
      select 1
      from public.sites s
      where s.id = p_site_id
        and s.incident_id = p_incident_id
        and s.site_type = 'search_site'
    )
$$;

grant execute on function public.can_write_search_event_log(uuid, text, uuid) to authenticated;


-- Keep Search Site report snapshots aware of resolved casualty findings.
create or replace function public.create_search_site_report(p_site_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_actor_id();
  v_actor_role text := public.current_user_role();
  v_site public.sites%rowtype;
  v_incident public.incidents%rowtype;
  v_report_id uuid;
  v_report_number integer;
  v_summary jsonb;
  v_apartments jsonb;
  v_damage_descriptions jsonb;
  v_snapshot jsonb;
  v_scanned integer;
  v_total integer;
  v_no_answer integer;
  v_casualties integer;
  v_completed integer;
  v_start_time timestamptz;
  v_completion_time timestamptz;
  v_site_status text;
begin
  if v_actor_id is null or coalesce(v_actor_role, '') not in ('admin', 'commander') then
    raise exception 'Only an administrator or commander can create a Search Site report';
  end if;

  select * into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Search Site not found';
  end if;

  if coalesce(v_site.site_type, 'rescue_site') <> 'search_site' then
    raise exception 'Search Site reports can only be created for Search Sites';
  end if;

  if not public.can_view_incident(v_site.incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  select * into v_incident
  from public.incidents
  where id = v_site.incident_id;

  if not found then
    raise exception 'Incident not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('search-site-report:' || p_site_id::text, 0));

  with unit_rows as (
    select
      u.id as unit_id,
      u.floor_id,
      f.floor_number,
      u.unit_number,
      u.zone_name,
      u.zone_type,
      u.zone_sequence,
      u.notes as unit_notes,
      ssu.family_name,
      ssu.occupants_count,
      ssu.contact_phone,
      ssu.search_status,
      ssu.casualty_psych,
      ssu.casualty_body,
      ssu.medical_evacuation,
      coalesce(ssu.anxiety_casualties_count, 0) as anxiety_casualties_count,
      coalesce(ssu.physical_casualties_count, 0) as physical_casualties_count,
      coalesce(ssu.has_apartment_damage, false) as has_apartment_damage,
      coalesce(ssu.casualties_resolved, false) as casualties_resolved,
      ssu.casualties_resolved_at,
      ssu.apartment_damage_notes,
      ssu.notes,
      ssu.searched_by,
      ssu.searched_at,
      ssu.completed_at
    from public.units u
    join public.floors f on f.id = u.floor_id
    left join public.site_search_units ssu
      on ssu.site_id = u.site_id
     and ssu.unit_id = u.id
    where u.site_id = p_site_id
      and u.incident_id = v_site.incident_id
      and u.is_active = true
  ),
  effective as (
    select
      *,
      case
        when search_status = 'completed' then 'completed'
        when (
          anxiety_casualties_count > 0
          or physical_casualties_count > 0
          or coalesce(casualty_psych, false)
          or coalesce(casualty_body, false)
          or coalesce(medical_evacuation, false)
          or search_status = 'casualties'
        ) and coalesce(casualties_resolved, false) = false
          then 'casualties'
        when search_status = 'no_answer' then 'no_answer'
        when search_status = 'clear' then 'clear'
        else 'not_visited'
      end as effective_status,
      case
        when coalesce(zone_type, 'apartment') = 'apartment' then U&'\05D3\05D9\05E8\05D4 ' || unit_number
        when zone_name is not null then zone_name || ' ' || coalesce(zone_sequence::text, unit_number)
        else unit_number
      end as unit_label
    from unit_rows
  )
  select
    jsonb_build_object(
      'total_apartments', count(*)::integer,
      'scanned_apartments', count(*) filter (where effective_status in ('clear', 'no_answer', 'casualties', 'completed'))::integer,
      'cleared_apartments', count(*) filter (where effective_status = 'completed')::integer,
      'clear_apartments', count(*) filter (where effective_status = 'clear')::integer,
      'no_answer_apartments', count(*) filter (where effective_status = 'no_answer')::integer,
      'casualty_apartments', count(*) filter (where effective_status = 'casualties')::integer,
      'open_findings', count(*) filter (where effective_status in ('no_answer', 'casualties'))::integer,
      'not_visited_apartments', count(*) filter (where effective_status = 'not_visited')::integer,
      'manually_added_apartments', count(*) filter (where zone_type = 'other' and zone_name = U&'\05D4\05D5\05E1\05E4\05D4 \05D9\05D3\05E0\05D9\05EA')::integer,
      'anxiety_casualties_total', coalesce(sum(anxiety_casualties_count), 0)::integer,
      'physical_casualties_total', coalesce(sum(physical_casualties_count), 0)::integer,
      'medical_evacuations', count(*) filter (where coalesce(medical_evacuation, false))::integer,
      'reported_casualties_total', coalesce(sum(anxiety_casualties_count + physical_casualties_count), 0)::integer,
      'open_casualties_total', coalesce(sum(anxiety_casualties_count + physical_casualties_count) filter (where anxiety_casualties_count + physical_casualties_count > 0 and coalesce(casualties_resolved, false) = false), 0)::integer,
      'resolved_casualties_total', coalesce(sum(anxiety_casualties_count + physical_casualties_count) filter (where anxiety_casualties_count + physical_casualties_count > 0 and coalesce(casualties_resolved, false) = true), 0)::integer,
      'open_casualty_apartments', count(*) filter (where effective_status = 'casualties')::integer,
      'resolved_casualty_apartments', count(*) filter (where coalesce(casualties_resolved, false) = true and (anxiety_casualties_count + physical_casualties_count > 0 or coalesce(medical_evacuation, false)))::integer,
      'damaged_apartments', count(*) filter (where has_apartment_damage)::integer
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'unit_id', unit_id,
      'floor_id', floor_id,
      'floor_number', floor_number,
      'unit_number', unit_number,
      'unit_label', unit_label,
      'zone_type', zone_type,
      'zone_name', zone_name,
      'zone_sequence', zone_sequence,
      'family_name', family_name,
      'occupants_count', occupants_count,
      'contact_phone', contact_phone,
      'search_status', effective_status,
      'raw_search_status', search_status,
      'casualty_psych', coalesce(casualty_psych, false),
      'casualty_body', coalesce(casualty_body, false),
      'anxiety_casualties_count', anxiety_casualties_count,
      'physical_casualties_count', physical_casualties_count,
      'medical_evacuation', coalesce(medical_evacuation, false),
      'casualties_resolved', coalesce(casualties_resolved, false),
      'casualties_resolved_at', casualties_resolved_at,
      'casualty_treatment_completed', coalesce(casualties_resolved, false),
      'has_apartment_damage', has_apartment_damage,
      'apartment_damage_notes', apartment_damage_notes,
      'notes', coalesce(notes, unit_notes),
      'searched_by', searched_by,
      'searched_at', searched_at,
      'completed_at', completed_at
    ) order by floor_number, zone_sequence nulls last, unit_number), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'floor_number', floor_number,
      'unit_label', unit_label,
      'damage_notes', apartment_damage_notes
    ) order by floor_number, unit_label) filter (where has_apartment_damage), '[]'::jsonb),
    min(searched_at) filter (where effective_status in ('clear', 'no_answer', 'casualties', 'completed')),
    max(coalesce(completed_at, searched_at)) filter (where effective_status in ('clear', 'no_answer', 'casualties', 'completed'))
  into v_summary, v_apartments, v_damage_descriptions, v_start_time, v_completion_time
  from effective;

  v_total := coalesce((v_summary->>'total_apartments')::integer, 0);
  v_scanned := coalesce((v_summary->>'scanned_apartments')::integer, 0);
  v_no_answer := coalesce((v_summary->>'no_answer_apartments')::integer, 0);
  v_casualties := coalesce((v_summary->>'casualty_apartments')::integer, 0);
  v_completed := coalesce((v_summary->>'cleared_apartments')::integer, 0);

  if v_scanned = 0 then
    raise exception 'Cannot create Search Site report before at least one apartment was scanned';
  end if;

  v_site_status := case
    when v_no_answer > 0 or v_casualties > 0 then 'has_open_items'
    when v_total > 0 and v_scanned >= v_total then 'cleared'
    when v_scanned > 0 then 'in_progress'
    else 'not_started'
  end;

  select coalesce(max(report_number), 0) + 1
  into v_report_number
  from public.search_site_reports
  where site_id = p_site_id;

  select jsonb_build_object(
    'schema_version', 1,
    'report_type', 'search_site_report',
    'captured_at', now(),
    'incident', jsonb_build_object(
      'id', v_incident.id,
      'name', v_incident.name,
      'incident_type', v_incident.incident_type,
      'city', v_incident.city,
      'address', v_incident.address,
      'opened_at', v_incident.opened_at
    ),
    'site', jsonb_build_object(
      'id', v_site.id,
      'name', v_site.name,
      'site_number', v_site.site_number,
      'city', v_site.city,
      'street', v_site.street,
      'house_number', v_site.house_number,
      'address', concat_ws(' ', nullif(v_site.street, ''), nullif(v_site.house_number, ''), nullif(v_site.city, '')),
      'site_commander', null,
      'site_type', v_site.site_type,
      'search_status', v_site_status,
      'stored_search_status', v_site.search_status,
      'search_reason', v_site.search_reason,
      'search_priority', v_site.search_priority,
      'parent_site_id', v_site.parent_site_id
    ),
    'author', jsonb_build_object(
      'id', v_actor_id,
      'display_name', coalesce(nullif(btrim(p.display_name), ''), 'Unknown')
    ),
    'timing', jsonb_build_object(
      'search_start_time', v_start_time,
      'search_completion_time', coalesce(v_site.search_completed_at, v_completion_time),
      'duration_seconds', case
        when v_start_time is not null and coalesce(v_site.search_completed_at, v_completion_time) is not null
          then extract(epoch from (coalesce(v_site.search_completed_at, v_completion_time) - v_start_time))::integer
        else null
      end
    ),
    'summary', v_summary,
    'casualties', jsonb_build_object(
      'anxiety_casualties_total', coalesce((v_summary->>'anxiety_casualties_total')::integer, 0),
      'physical_casualties_total', coalesce((v_summary->>'physical_casualties_total')::integer, 0),
      'medical_evacuations', coalesce((v_summary->>'medical_evacuations')::integer, 0),
      'reported_casualties_total', coalesce((v_summary->>'reported_casualties_total')::integer, 0),
      'open_casualties_total', coalesce((v_summary->>'open_casualties_total')::integer, 0),
      'resolved_casualties_total', coalesce((v_summary->>'resolved_casualties_total')::integer, 0),
      'open_casualty_apartments', coalesce((v_summary->>'open_casualty_apartments')::integer, 0),
      'resolved_casualty_apartments', coalesce((v_summary->>'resolved_casualty_apartments')::integer, 0)
    ),
    'damage', jsonb_build_object(
      'damaged_apartments', coalesce((v_summary->>'damaged_apartments')::integer, 0),
      'descriptions', coalesce(v_damage_descriptions, '[]'::jsonb)
    ),
    'apartments', coalesce(v_apartments, '[]'::jsonb),
    'final_summary', jsonb_build_object(
      'site_status', v_site_status,
      'site_cleared', v_site_status = 'cleared',
      'has_open_findings', v_no_answer > 0 or v_casualties > 0,
      'warnings', jsonb_build_object(
        'no_answer_apartments', v_no_answer,
        'casualty_apartments', v_casualties,
        'medical_evacuations', coalesce((v_summary->>'medical_evacuations')::integer, 0)
      )
    )
  )
  into v_snapshot
  from public.profiles p
  where p.id = v_actor_id;

  insert into public.search_site_reports (incident_id, site_id, report_number, snapshot, created_by)
  values (v_site.incident_id, p_site_id, v_report_number, v_snapshot, v_actor_id)
  returning id into v_report_id;

  perform public.create_event_log(
    v_site.incident_id,
    'search_site_report_created',
    U&'\05D9\05E6\05D9\05E8\05EA \05D3\05D5\05D7 \05D0\05EA\05E8 \05E1\05E8\05D9\05E7\05D4',
    U&'\05D3\05D5\05D7 \05E1\05E8\05D9\05E7\05D4 #' || v_report_number::text || U&' \05E0\05D5\05E6\05E8 \05E2\05D1\05D5\05E8 ' || coalesce(v_site.name, U&'\05D0\05EA\05E8 \05E1\05E8\05D9\05E7\05D4'),
    'administrative',
    case when v_no_answer > 0 or v_casualties > 0 then 'important' else 'normal' end,
    now(),
    v_site.id,
    null,
    null,
    null,
    null,
    U&'\05DE\05E2\05E8\05DB\05EA',
    null,
    jsonb_build_object(
      'search_site_report_id', v_report_id,
      'report_number', v_report_number,
      'site_id', v_site.id,
      'scanned_apartments', v_scanned,
      'open_findings', v_no_answer + v_casualties
    )
  );

  return v_report_id;
end;
$$;
