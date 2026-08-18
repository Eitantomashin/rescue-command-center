-- Phase 3 corrective migration:
-- Prevent assigning the same person to more than one non-terminal vehicle roster.
-- Non-terminal allocation statuses are draft, ready and en_route.

create or replace function public.validate_incident_roster_ready(
  p_incident_id uuid,
  p_roster_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_missing text[] := array[]::text[];
  v_conflict record;
begin
  perform public.assert_edit_personnel(p_incident_id);

  select * into v_roster
  from public.incident_vehicle_rosters
  where id = p_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Roster not found';
  end if;

  if nullif(btrim(coalesce(v_roster.vehicle_license_plate, '')), '') is null
    or v_roster.normalized_license_plate is null
  then
    v_missing := array_append(v_missing, 'vehicle_license_plate');
  end if;

  if nullif(btrim(coalesce(v_roster.vehicle_description, '')), '') is null then
    v_missing := array_append(v_missing, 'vehicle_description');
  end if;

  if nullif(btrim(coalesce(v_roster.origin_text, '')), '') is null then
    v_missing := array_append(v_missing, 'origin');
  end if;

  if nullif(btrim(coalesce(v_roster.destination_text, '')), '') is null then
    v_missing := array_append(v_missing, 'destination');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
  ) then
    v_missing := array_append(v_missing, 'participants');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
      and p.is_driver
  ) then
    v_missing := array_append(v_missing, 'driver');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
      and p.is_movement_commander
  ) then
    v_missing := array_append(v_missing, 'movement_commander');
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('valid', false, 'code', 'missing_required_fields', 'missing', to_jsonb(v_missing));
  end if;

  select r.id, public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number
  into v_conflict
  from public.incident_vehicle_rosters r
  where r.incident_id = p_incident_id
    and r.id <> p_roster_id
    and r.status in ('ready', 'en_route')
    and r.normalized_license_plate = v_roster.normalized_license_plate
  limit 1;

  if found then
    return jsonb_build_object(
      'valid', false,
      'code', 'vehicle_conflict',
      'conflict_type', 'vehicle',
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'vehicle_license_plate', v_roster.vehicle_license_plate
    );
  end if;

  select r.id,
         public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
         r.status,
         p.display_name_snapshot as person_name,
         p.participant_key
  into v_conflict
  from public.incident_roster_participants p
  join public.incident_roster_participants current_p
    on current_p.roster_id = p_roster_id
   and current_p.participant_key = p.participant_key
  join public.incident_vehicle_rosters r
    on r.id = p.roster_id
  where r.incident_id = p_incident_id
    and r.id <> p_roster_id
    and r.status in ('draft', 'ready', 'en_route')
  limit 1;

  if found then
    return jsonb_build_object(
      'valid', false,
      'code', 'person_already_allocated',
      'conflict_type', 'person',
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'conflicting_roster_status', v_conflict.status,
      'person_name', v_conflict.person_name,
      'participant_key', v_conflict.participant_key
    );
  end if;

  return jsonb_build_object('valid', true);
end;
$$;

create or replace function public.add_incident_roster_participant(
  p_incident_id uuid,
  p_roster_id uuid,
  p_source_type text,
  p_unit_personnel_id uuid default null,
  p_manual_personnel_id uuid default null,
  p_external_person_id uuid default null,
  p_is_driver boolean default false,
  p_is_movement_commander boolean default false,
  p_is_passenger boolean default true,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_key text;
  v_name text;
  v_phone text;
  v_id uuid;
  v_conflict record;
begin
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));
  v_roster := public.assert_incident_roster_mutable(p_incident_id, p_roster_id, false);

  if not (coalesce(p_is_driver, false) or coalesce(p_is_movement_commander, false) or coalesce(p_is_passenger, false)) then
    raise exception 'At least one roster role is required';
  end if;

  if p_source_type = 'unit_personnel' then
    select first_name || ' ' || last_name, mobile_phone into v_name, v_phone
    from public.unit_personnel
    where id = p_unit_personnel_id
      and is_active;
  elsif p_source_type = 'manual_personnel' then
    select first_name || ' ' || last_name, mobile_phone into v_name, v_phone
    from public.incident_manual_personnel
    where id = p_manual_personnel_id
      and incident_id = p_incident_id
      and is_active;
  elsif p_source_type = 'external_person' then
    select full_name, mobile_phone into v_name, v_phone
    from public.incident_roster_external_people
    where id = p_external_person_id
      and incident_id = p_incident_id
      and is_active;
  else
    raise exception 'Invalid participant source type';
  end if;

  if v_name is null then
    raise exception 'Participant source was not found or does not belong to this incident';
  end if;

  v_key := public.incident_roster_participant_key(p_source_type, p_unit_personnel_id, p_manual_personnel_id, p_external_person_id);

  select r.id,
         public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
         r.status
  into v_conflict
  from public.incident_roster_participants p
  join public.incident_vehicle_rosters r on r.id = p.roster_id
  where r.incident_id = p_incident_id
    and r.id <> p_roster_id
    and r.status in ('draft', 'ready', 'en_route')
    and p.participant_key = v_key
  limit 1;

  if found then
    return jsonb_build_object(
      'success', false,
      'code', 'person_already_allocated',
      'conflict_type', 'person',
      'person_name', v_name,
      'participant_key', v_key,
      'source_type', p_source_type,
      'source_id', coalesce(p_unit_personnel_id, p_manual_personnel_id, p_external_person_id),
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'conflicting_roster_status', v_conflict.status
    );
  end if;

  insert into public.incident_roster_participants (
    incident_id,
    roster_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    added_by,
    updated_by
  )
  values (
    p_incident_id,
    p_roster_id,
    p_source_type,
    p_unit_personnel_id,
    p_manual_personnel_id,
    p_external_person_id,
    v_key,
    v_name,
    public.normalize_incident_mobile_phone(v_phone),
    coalesce(p_is_driver, false),
    coalesce(p_is_movement_commander, false),
    coalesce(p_is_passenger, true),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  on conflict (roster_id, participant_key)
  do update set
    is_driver = incident_roster_participants.is_driver or excluded.is_driver,
    is_movement_commander = incident_roster_participants.is_movement_commander or excluded.is_movement_commander,
    is_passenger = incident_roster_participants.is_passenger or excluded.is_passenger,
    notes = coalesce(excluded.notes, incident_roster_participants.notes),
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into v_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    p_roster_id,
    'incident_roster_participant_added',
    'משתתף נוסף לשבצ"ק',
    v_name || ' נוסף לשבצ"ק ' || public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index) || '.',
    'normal',
    jsonb_build_object('participant_id', v_id, 'participant_key', v_key, 'display_number', public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index))
  );

  return jsonb_build_object('success', true, 'participant_id', v_id);
end;
$$;

create or replace function public.clone_incident_vehicle_roster_for_return(
  p_incident_id uuid,
  p_source_roster_id uuid,
  p_planned_departure_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.incident_vehicle_rosters%rowtype;
  v_root_id uuid;
  v_suffix integer;
  v_clone_id uuid;
  v_display text;
  v_conflict record;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select * into v_source
  from public.incident_vehicle_rosters
  where id = p_source_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Source roster not found';
  end if;

  if v_source.status <> 'arrived' then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_arrived');
  end if;

  select r.id,
         public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
         r.status,
         p.display_name_snapshot as person_name,
         p.participant_key
  into v_conflict
  from public.incident_roster_participants source_p
  join public.incident_roster_participants p
    on p.participant_key = source_p.participant_key
   and p.incident_id = p_incident_id
  join public.incident_vehicle_rosters r
    on r.id = p.roster_id
   and r.incident_id = p_incident_id
  where source_p.roster_id = p_source_roster_id
    and r.id <> p_source_roster_id
    and r.status in ('draft', 'ready', 'en_route')
  limit 1;

  if found then
    return jsonb_build_object(
      'success', false,
      'code', 'person_already_allocated',
      'conflict_type', 'person',
      'person_name', v_conflict.person_name,
      'participant_key', v_conflict.participant_key,
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'conflicting_roster_status', v_conflict.status
    );
  end if;

  v_root_id := coalesce(v_source.root_roster_id, v_source.id);

  select coalesce(max(clone_suffix_index), 0) + 1 into v_suffix
  from public.incident_vehicle_rosters
  where incident_id = p_incident_id
    and (id = v_root_id or root_roster_id = v_root_id);

  insert into public.incident_vehicle_rosters (
    incident_id, main_sequence, clone_suffix_index, root_roster_id, source_roster_id,
    status, movement_type, origin_text, destination_text, origin_site_id, destination_site_id,
    planned_departure_at, vehicle_license_plate, normalized_license_plate, vehicle_description,
    vehicle_type, vehicle_notes, operational_notes, created_by, updated_by
  )
  values (
    p_incident_id, v_source.main_sequence, v_suffix, v_root_id, p_source_roster_id,
    'draft', 'return_to_unit', v_source.destination_text, v_source.origin_text, v_source.destination_site_id, v_source.origin_site_id,
    p_planned_departure_at, v_source.vehicle_license_plate, v_source.normalized_license_plate, v_source.vehicle_description,
    v_source.vehicle_type, v_source.vehicle_notes, null, public.current_actor_id(), public.current_actor_id()
  )
  returning id into v_clone_id;

  insert into public.incident_roster_participants (
    incident_id, roster_id, source_type, unit_personnel_id, manual_personnel_id, external_person_id,
    participant_key, display_name_snapshot, normalized_mobile_phone, is_driver, is_movement_commander,
    is_passenger, notes, added_by, updated_by
  )
  select
    incident_id, v_clone_id, source_type, unit_personnel_id, manual_personnel_id, external_person_id,
    participant_key, display_name_snapshot, normalized_mobile_phone, is_driver, is_movement_commander,
    is_passenger, notes, public.current_actor_id(), public.current_actor_id()
  from public.incident_roster_participants
  where roster_id = p_source_roster_id;

  v_display := public.incident_roster_display_number(v_source.main_sequence, v_suffix);

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_clone_id,
    'incident_vehicle_roster_return_cloned',
    'שבצ"ק חזור נוצר',
    'נוצר שבצ"ק חזור ' || v_display || ' על בסיס ' || public.incident_roster_display_number(v_source.main_sequence, v_source.clone_suffix_index) || '.',
    'important',
    jsonb_build_object('display_number', v_display, 'source_roster_id', p_source_roster_id, 'root_roster_id', v_root_id)
  );

  return jsonb_build_object('success', true, 'roster_id', v_clone_id, 'display_number', v_display);
end;
$$;

create or replace function public.clone_incident_vehicle_roster_for_next_destination(
  p_incident_id uuid,
  p_source_roster_id uuid,
  p_planned_departure_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.incident_vehicle_rosters%rowtype;
  v_root_id uuid;
  v_suffix integer;
  v_clone_id uuid;
  v_display text;
  v_conflict record;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select * into v_source
  from public.incident_vehicle_rosters
  where id = p_source_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_found');
  end if;

  if v_source.status <> 'arrived' then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_arrived');
  end if;

  if nullif(btrim(coalesce(v_source.destination_text, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'source_roster_missing_destination');
  end if;

  select r.id,
         public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
         r.status,
         p.display_name_snapshot as person_name,
         p.participant_key
  into v_conflict
  from public.incident_roster_participants source_p
  join public.incident_roster_participants p
    on p.participant_key = source_p.participant_key
   and p.incident_id = p_incident_id
  join public.incident_vehicle_rosters r
    on r.id = p.roster_id
   and r.incident_id = p_incident_id
  where source_p.roster_id = p_source_roster_id
    and r.id <> p_source_roster_id
    and r.status in ('draft', 'ready', 'en_route')
  limit 1;

  if found then
    return jsonb_build_object(
      'success', false,
      'code', 'person_already_allocated',
      'conflict_type', 'person',
      'person_name', v_conflict.person_name,
      'participant_key', v_conflict.participant_key,
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'conflicting_roster_status', v_conflict.status
    );
  end if;

  v_root_id := coalesce(v_source.root_roster_id, v_source.id);

  select coalesce(max(clone_suffix_index), 0) + 1 into v_suffix
  from public.incident_vehicle_rosters
  where incident_id = p_incident_id
    and (id = v_root_id or root_roster_id = v_root_id);

  insert into public.incident_vehicle_rosters (
    incident_id, main_sequence, clone_suffix_index, root_roster_id, source_roster_id,
    status, movement_type, origin_text, destination_text, origin_site_id, destination_site_id,
    planned_departure_at, vehicle_license_plate, normalized_license_plate, vehicle_description,
    vehicle_type, vehicle_notes, operational_notes, created_by, updated_by
  )
  values (
    p_incident_id, v_source.main_sequence, v_suffix, v_root_id, p_source_roster_id,
    'draft', 'between_sites', v_source.destination_text, null, v_source.destination_site_id, null,
    null, v_source.vehicle_license_plate, v_source.normalized_license_plate, v_source.vehicle_description,
    v_source.vehicle_type, v_source.vehicle_notes, null, public.current_actor_id(), public.current_actor_id()
  )
  returning id into v_clone_id;

  insert into public.incident_roster_participants (
    incident_id, roster_id, source_type, unit_personnel_id, manual_personnel_id, external_person_id,
    participant_key, display_name_snapshot, normalized_mobile_phone, is_driver, is_movement_commander,
    is_passenger, notes, added_by, updated_by
  )
  select
    incident_id, v_clone_id, source_type, unit_personnel_id, manual_personnel_id, external_person_id,
    participant_key, display_name_snapshot, normalized_mobile_phone, is_driver, is_movement_commander,
    is_passenger, notes, public.current_actor_id(), public.current_actor_id()
  from public.incident_roster_participants
  where roster_id = p_source_roster_id;

  v_display := public.incident_roster_display_number(v_source.main_sequence, v_suffix);

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_clone_id,
    'incident_vehicle_roster_next_destination_cloned',
    'שבצ"ק המשך נוצר',
    'נוצר שבצ"ק המשך ' || v_display || ' על בסיס ' || public.incident_roster_display_number(v_source.main_sequence, v_source.clone_suffix_index) || '.',
    'important',
    jsonb_build_object('display_number', v_display, 'source_roster_id', p_source_roster_id, 'root_roster_id', v_root_id, 'clone_mode', 'next_destination')
  );

  return jsonb_build_object('success', true, 'roster_id', v_clone_id, 'display_number', v_display, 'source_roster_id', p_source_roster_id, 'root_roster_id', v_root_id, 'clone_mode', 'next_destination');
end;
$$;

drop function if exists public.list_incident_roster_eligible_people(uuid);

create function public.list_incident_roster_eligible_people(
  p_incident_id uuid,
  p_current_roster_id uuid default null
)
returns table (
  source_type text,
  source_id uuid,
  display_name text,
  mobile_phone text,
  normalized_mobile_phone text,
  source_label text,
  organic_team text,
  ad_hoc_teams text,
  attendance_status text,
  is_allocated boolean,
  allocated_roster_id uuid,
  allocated_roster_display_number text,
  allocated_roster_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with people as (
    select
      'unit_personnel'::text as source_type,
      up.id as source_id,
      up.first_name || ' ' || up.last_name as display_name,
      up.mobile_phone,
      public.normalize_incident_mobile_phone(up.mobile_phone) as normalized_mobile_phone,
      'צוות אורגני'::text as source_label,
      up.department as organic_team,
      coalesce(eps.attendance_status, 'unavailable') as attendance_status
    from public.unit_personnel up
    left join public.event_personnel_status eps
      on eps.personnel_id = up.id
     and eps.incident_id = p_incident_id
    where up.is_active
    union all
    select
      'manual_personnel',
      imp.id,
      imp.first_name || ' ' || imp.last_name,
      imp.mobile_phone,
      imp.normalized_mobile_phone,
      'נוסף ידנית',
      coalesce(t.name, 'צוות ' || t.team_number::text),
      imp.attendance_status
    from public.incident_manual_personnel imp
    left join public.teams t on t.id = imp.organic_team_id
    where imp.incident_id = p_incident_id
      and imp.is_active
    union all
    select
      'external_person',
      ep.id,
      ep.full_name,
      ep.mobile_phone,
      ep.normalized_mobile_phone,
      'גורם חיצוני - שבצ"ק בלבד',
      ep.external_role,
      null::text
    from public.incident_roster_external_people ep
    where ep.incident_id = p_incident_id
      and ep.is_active
  ),
  active_allocations as (
    select distinct on (p.participant_key)
      p.participant_key,
      r.id as roster_id,
      public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
      r.status
    from public.incident_roster_participants p
    join public.incident_vehicle_rosters r on r.id = p.roster_id
    where r.incident_id = p_incident_id
      and r.status in ('draft', 'ready', 'en_route')
      and (p_current_roster_id is null or r.id <> p_current_roster_id)
    order by p.participant_key, r.created_at, r.id
  ),
  ad_hoc as (
    select
      public.incident_roster_participant_key(
        case when m.unit_personnel_id is not null then 'unit_personnel' else 'manual_personnel' end,
        m.unit_personnel_id,
        m.manual_personnel_id,
        null
      ) as participant_key,
      string_agg(t.name, ', ' order by t.name) as team_names
    from public.incident_ad_hoc_team_members m
    join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
    where m.incident_id = p_incident_id
      and m.is_active
      and t.status = 'active'
    group by 1
  )
  select
    people.source_type,
    people.source_id,
    people.display_name,
    people.mobile_phone,
    people.normalized_mobile_phone,
    people.source_label,
    people.organic_team,
    ad_hoc.team_names,
    people.attendance_status,
    active_allocations.roster_id is not null as is_allocated,
    active_allocations.roster_id,
    active_allocations.display_number,
    active_allocations.status
  from people
  left join active_allocations
    on active_allocations.participant_key = public.incident_roster_participant_key(
      people.source_type,
      case when people.source_type = 'unit_personnel' then people.source_id else null end,
      case when people.source_type = 'manual_personnel' then people.source_id else null end,
      case when people.source_type = 'external_person' then people.source_id else null end
    )
  left join ad_hoc
    on ad_hoc.participant_key = public.incident_roster_participant_key(
      people.source_type,
      case when people.source_type = 'unit_personnel' then people.source_id else null end,
      case when people.source_type = 'manual_personnel' then people.source_id else null end,
      case when people.source_type = 'external_person' then people.source_id else null end
    )
  where public.can_read_incident(p_incident_id)
  order by people.display_name;
$$;

revoke all on function public.validate_incident_roster_ready(uuid, uuid) from public;
revoke all on function public.validate_incident_roster_ready(uuid, uuid) from anon;
revoke all on function public.validate_incident_roster_ready(uuid, uuid) from authenticated;
revoke all on function public.add_incident_roster_participant(uuid, uuid, text, uuid, uuid, uuid, boolean, boolean, boolean, text) from public;
revoke all on function public.clone_incident_vehicle_roster_for_return(uuid, uuid, timestamptz) from public;
revoke all on function public.clone_incident_vehicle_roster_for_next_destination(uuid, uuid, timestamptz) from public;
revoke all on function public.list_incident_roster_eligible_people(uuid, uuid) from public;

revoke all on function public.add_incident_roster_participant(uuid, uuid, text, uuid, uuid, uuid, boolean, boolean, boolean, text) from anon;
revoke all on function public.clone_incident_vehicle_roster_for_return(uuid, uuid, timestamptz) from anon;
revoke all on function public.clone_incident_vehicle_roster_for_next_destination(uuid, uuid, timestamptz) from anon;
revoke all on function public.list_incident_roster_eligible_people(uuid, uuid) from anon;

grant execute on function public.add_incident_roster_participant(uuid, uuid, text, uuid, uuid, uuid, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.clone_incident_vehicle_roster_for_return(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.clone_incident_vehicle_roster_for_next_destination(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.list_incident_roster_eligible_people(uuid, uuid) to authenticated;