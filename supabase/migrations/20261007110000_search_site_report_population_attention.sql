-- Preserve immutable Search Site report snapshots while adding resident-level operational attention detail.

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
  v_population_attention jsonb;
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

  with attention_residents as (
    select
      ur.first_name,
      ur.last_name,
      f.floor_number,
      case
        when coalesce(u.zone_type, 'apartment') = 'apartment' then U&'\05D3\05D9\05E8\05D4 ' || u.unit_number
        when u.zone_name is not null then u.zone_name || ' ' || coalesce(u.zone_sequence::text, u.unit_number)
        else u.unit_number
      end as unit_label,
      resident_status.status_key,
      resident_status.hebrew_label as status_label,
      coalesce(ssu.casualties_resolved, false) as casualties_resolved,
      coalesce(ur.requires_evacuation, false) as requires_evacuation,
      ur.evacuated_at,
      nullif(btrim(ur.notes), '') as notes,
      (
        resident_status.status_key in ('anxiety_casualty', 'physical_casualty', 'deceased')
        and coalesce(ssu.casualties_resolved, false)
        and (coalesce(ur.requires_evacuation, false) = false or ur.evacuated_at is not null)
      ) as treatment_resolved
    from public.unit_residents ur
    join public.units u
      on u.id = ur.unit_id
      and u.incident_id = ur.incident_id
      and u.site_id = ur.site_id
    join public.floors f on f.id = u.floor_id
    join public.status_types resident_status on resident_status.id = ur.status_id
    left join public.site_search_units ssu
      on ssu.incident_id = ur.incident_id
      and ssu.site_id = ur.site_id
      and ssu.unit_id = ur.unit_id
    where ur.incident_id = v_site.incident_id
      and ur.site_id = p_site_id
      and ur.is_active = true
      and u.is_active = true
      and resident_status.category = 'resident'
      and resident_status.status_key in ('not_checked', 'anxiety_casualty', 'physical_casualty', 'deceased')
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'not_checked', count(*) filter (where status_key = 'not_checked')::integer,
      'anxiety', count(*) filter (where status_key = 'anxiety_casualty')::integer,
      'physical', count(*) filter (where status_key = 'physical_casualty')::integer,
      'deceased', count(*) filter (where status_key = 'deceased')::integer,
      'waiting_evacuation', count(*) filter (where requires_evacuation and evacuated_at is null)::integer,
      'open_treatment', count(*) filter (where status_key in ('anxiety_casualty', 'physical_casualty', 'deceased') and not treatment_resolved)::integer,
      'resolved_treatment', count(*) filter (where status_key in ('anxiety_casualty', 'physical_casualty', 'deceased') and treatment_resolved)::integer
    ),
    'residents', coalesce(jsonb_agg(jsonb_build_object(
      'first_name', first_name,
      'last_name', last_name,
      'floor_number', floor_number,
      'unit_label', unit_label,
      'status_key', status_key,
      'status_label', status_label,
      'casualties_resolved', casualties_resolved,
      'requires_evacuation', requires_evacuation,
      'evacuated_at', evacuated_at,
      'notes', notes,
      'treatment_resolved', treatment_resolved
    ) order by floor_number, unit_label, last_name nulls last, first_name nulls last), '[]'::jsonb)
  )
  into v_population_attention
  from attention_residents;

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
    'population_attention', v_population_attention,
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

revoke all on function public.create_search_site_report(uuid) from public, anon;
grant execute on function public.create_search_site_report(uuid) to authenticated;
