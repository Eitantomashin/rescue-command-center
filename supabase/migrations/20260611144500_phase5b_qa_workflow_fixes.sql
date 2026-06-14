-- Phase 5B QA workflow fixes.
--
-- Forward-only changes:
-- 1. Operational report source_name remains null when reporter name is empty.
-- 2. Operational number creation no longer defaults reporter name to RCC.
-- 3. Team 9 can be merged into a rescue-team operational number without deleting either record.
-- 4. Dashboard active rescue-team counters are derived from active non-merged operational numbers,
--    excluding Team 9 from rescue-team counters while keeping Team 9 in gap calculations.

create or replace function public.create_operational_report(
  p_person_id uuid,
  p_status_id uuid,
  p_information_source_type text,
  p_information_source_name text default null,
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default 'לא ידוע',
  p_notes text default null,
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
  v_report_id uuid;
  v_reported_at timestamptz;
  v_source_type text;
  v_source_name text;
  v_source_phone text;
  v_grid_cell text;
  v_confidence_level text;
  v_notes text;
  v_person_name text;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Operational person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'create_operational_report');

  if v_person.is_merged then
    raise exception 'Merged operational numbers cannot receive new reports';
  end if;

  if v_person.site_id is null then
    raise exception 'Operational person % must be assigned to a site before reports can be created', p_person_id;
  end if;

  select * into v_previous_status
  from public.status_types
  where id = v_person.current_status_id;

  select * into v_new_status
  from public.status_types
  where id = p_status_id
    and category = 'person'
    and is_active = true
    and (incident_id = v_person.incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', p_status_id;
  end if;

  v_source_type := nullif(btrim(coalesce(p_information_source_type, '')), '');
  if v_source_type is null then
    raise exception 'Information source type is required';
  end if;

  if v_source_type not in (
    'חפ"ק',
    'אוכלוסיה',
    'משטרה',
    'מד"א',
    'כב"ה',
    'פיקוד העורף',
    'עירייה',
    'מחלצים',
    'אחר'
  ) then
    raise exception 'Information source type % is not valid', v_source_type;
  end if;

  v_confidence_level := coalesce(nullif(btrim(coalesce(p_confidence_level, '')), ''), 'לא ידוע');
  if v_confidence_level not in ('מאומת', 'גבוהה', 'בינונית', 'נמוכה', 'לא ידוע') then
    raise exception 'Confidence level % is not valid', v_confidence_level;
  end if;

  v_source_name := nullif(btrim(coalesce(p_information_source_name, '')), '');
  v_source_phone := nullif(btrim(coalesce(p_source_phone, '')), '');
  v_grid_cell := nullif(btrim(coalesce(p_grid_cell, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  v_reported_at := coalesce(p_reported_at, now());

  perform set_config('rcc.allow_operational_report_insert', 'on', true);
  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.operational_reports (
    incident_id,
    site_id,
    person_id,
    status_id,
    information_source_type,
    information_source_name,
    source_phone,
    grid_cell,
    confidence_level,
    notes,
    reported_at,
    created_by
  )
  values (
    v_person.incident_id,
    v_person.site_id,
    v_person.id,
    p_status_id,
    v_source_type,
    v_source_name,
    v_source_phone,
    v_grid_cell,
    v_confidence_level,
    v_notes,
    v_reported_at,
    public.current_actor_id()
  )
  returning id into v_report_id;

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    team_id,
    notes,
    created_by
  )
  values (
    v_person.id,
    v_person.incident_id,
    v_person.current_status_id,
    p_status_id,
    v_reported_at,
    v_source_type,
    v_source_name,
    null,
    v_notes,
    public.current_actor_id()
  );

  update public.persons
  set
    current_status_id = p_status_id,
    source = v_source_type,
    notes = coalesce(v_notes, notes),
    updated_by = public.current_actor_id()
  where id = v_person.id;

  perform set_config('rcc.allow_operational_report_insert', 'off', true);
  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_person_name := coalesce(
    nullif(btrim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''),
    'שם לא ידוע'
  );

  perform public.create_event_log(
    v_person.incident_id,
    'operational_report_created',
    'דיווח מבצעי חדש',
    '#' || v_person.operational_number || ' - ' || v_person_name || ': '
      || coalesce(v_previous_status.hebrew_label, 'ללא סטטוס')
      || ' → '
      || v_new_status.hebrew_label,
    'operational',
    'normal',
    v_reported_at,
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    null,
    v_source_type,
    v_source_name,
    jsonb_build_object(
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'report_id', v_report_id,
      'status_id', p_status_id,
      'information_source_type', v_source_type,
      'source_name', v_source_name,
      'source_phone', v_source_phone,
      'grid_cell', v_grid_cell,
      'confidence_level', v_confidence_level,
      'notes', v_notes,
      'old_status_id', v_person.current_status_id,
      'new_status_id', p_status_id,
      'old_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label,
      'old_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key
    )
  );

  return v_report_id;
exception
  when others then
    perform set_config('rcc.allow_operational_report_insert', 'off', true);
    perform set_config('rcc.allow_status_history_insert', 'off', true);
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

create or replace function public.create_operational_number(
  p_incident_id uuid,
  p_site_id uuid,
  p_team_number integer,
  p_operational_number integer,
  p_status_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_notes text default null,
  p_information_source_type text default 'חפ"ק',
  p_information_source_name text default null,
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default 'לא ידוע',
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents%rowtype;
  v_site public.sites%rowtype;
  v_status public.status_types%rowtype;
  v_status_id uuid;
  v_person_id uuid;
  v_report_id uuid;
  v_source_type text;
  v_source_name text;
  v_source_phone text;
  v_grid_cell text;
  v_confidence_level text;
  v_notes text;
  v_person_name text;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  if p_site_id is null then
    raise exception 'Site is required';
  end if;

  perform public.validate_operational_number_for_team(p_team_number, p_operational_number);

  select * into v_incident
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  perform public.assert_incident_writable(p_incident_id, 'create_operational_number');

  select * into v_site
  from public.sites
  where id = p_site_id
    and incident_id = p_incident_id;

  if not found then
    raise exception 'Site % does not belong to incident %', p_site_id, p_incident_id;
  end if;

  if exists (
    select 1
    from public.persons p
    where p.incident_id = p_incident_id
      and p.operational_number = p_operational_number
  ) then
    raise exception 'Operational number % already exists for this incident', p_operational_number;
  end if;

  v_status_id := coalesce(p_status_id, public.get_status_id('person', 'missing', p_incident_id));

  if v_status_id is null then
    raise exception 'Default person missing status is missing';
  end if;

  select * into v_status
  from public.status_types
  where id = v_status_id
    and category = 'person'
    and is_active = true
    and (incident_id = p_incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', v_status_id;
  end if;

  v_source_type := coalesce(nullif(btrim(coalesce(p_information_source_type, '')), ''), 'חפ"ק');
  v_source_name := nullif(btrim(coalesce(p_information_source_name, '')), '');
  v_source_phone := nullif(btrim(coalesce(p_source_phone, '')), '');
  v_grid_cell := nullif(btrim(coalesce(p_grid_cell, '')), '');
  v_confidence_level := coalesce(nullif(btrim(coalesce(p_confidence_level, '')), ''), 'לא ידוע');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.persons (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    operational_number,
    first_name,
    last_name,
    current_status_id,
    source,
    notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    p_site_id,
    null,
    null,
    p_operational_number,
    nullif(btrim(coalesce(p_first_name, '')), ''),
    nullif(btrim(coalesce(p_last_name, '')), ''),
    v_status.id,
    v_source_type,
    v_notes,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_person_id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_report_id := public.create_operational_report(
    v_person_id,
    v_status.id,
    v_source_type,
    v_source_name,
    v_source_phone,
    v_grid_cell,
    v_confidence_level,
    v_notes,
    p_reported_at
  );

  v_person_name := coalesce(
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), ''),
    'שם לא ידוע'
  );

  perform public.create_event_log(
    p_incident_id,
    'operational_number_created',
    'יצירת מספר מבצעי',
    '#' || p_operational_number || ' נוצר עבור ' || v_person_name,
    'operational',
    'normal',
    coalesce(p_reported_at, now()),
    p_site_id,
    null,
    null,
    v_person_id,
    null,
    v_source_type,
    v_source_name,
    jsonb_build_object(
      'person_id', v_person_id,
      'operational_number', p_operational_number,
      'report_id', v_report_id,
      'status_id', v_status.id,
      'information_source_type', v_source_type,
      'source_name', v_source_name,
      'source_phone', v_source_phone,
      'grid_cell', v_grid_cell,
      'confidence_level', v_confidence_level,
      'notes', v_notes,
      'team_number', p_team_number,
      'sequence_number', public.operational_number_sequence(p_operational_number),
      'status_key', v_status.status_key,
      'status_label', v_status.hebrew_label,
      'site_id', p_site_id
    )
  );

  return v_person_id;
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

create or replace function public.merge_operational_numbers(
  p_incident_id uuid,
  p_primary_operational_number integer,
  p_merged_operational_number integer,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first public.persons%rowtype;
  v_second public.persons%rowtype;
  v_primary public.persons%rowtype;
  v_merged public.persons%rowtype;
  v_duplicate_status_id uuid;
  v_merge_id uuid;
  v_reason text;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  if p_primary_operational_number = p_merged_operational_number then
    raise exception 'Cannot merge an operational number into itself';
  end if;

  select * into v_first
  from public.persons
  where incident_id = p_incident_id
    and operational_number = p_primary_operational_number
  for update;

  if not found then
    raise exception 'Operational number % does not exist', p_primary_operational_number;
  end if;

  select * into v_second
  from public.persons
  where incident_id = p_incident_id
    and operational_number = p_merged_operational_number
  for update;

  if not found then
    raise exception 'Operational number % does not exist', p_merged_operational_number;
  end if;

  if v_first.is_merged or v_second.is_merged then
    raise exception 'Cannot merge numbers that are already marked as merged';
  end if;

  if public.operational_number_team_number(v_first.operational_number) = 9
    and public.operational_number_team_number(v_second.operational_number) <> 9
  then
    v_primary := v_second;
    v_merged := v_first;
  elsif public.operational_number_team_number(v_second.operational_number) = 9
    and public.operational_number_team_number(v_first.operational_number) <> 9
  then
    v_primary := v_first;
    v_merged := v_second;
  else
    raise exception 'Merge must connect one Team 9 number with one rescue-team number';
  end if;

  if not public.can_command_incident(v_primary.incident_id) then
    raise exception 'User is not allowed to merge operational numbers for this incident';
  end if;

  perform public.assert_incident_writable(v_primary.incident_id, 'merge_operational_numbers');

  v_duplicate_status_id := public.get_status_id('person', 'duplicate_cancelled', v_primary.incident_id);

  if v_duplicate_status_id is null then
    raise exception 'Duplicate/cancelled status is missing';
  end if;

  v_reason := coalesce(
    nullif(btrim(p_reason), ''),
    '#' || v_merged.operational_number || ' אוחד עם #' || v_primary.operational_number
  );

  perform set_config('rcc.allow_person_merge_insert', 'on', true);
  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.person_merges (
    incident_id,
    primary_person_id,
    merged_person_id,
    primary_operational_number,
    merged_operational_number,
    reason,
    merged_by
  )
  values (
    v_primary.incident_id,
    v_primary.id,
    v_merged.id,
    v_primary.operational_number,
    v_merged.operational_number,
    v_reason,
    public.current_actor_id()
  )
  returning id into v_merge_id;

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    notes,
    created_by
  )
  values (
    v_merged.id,
    v_merged.incident_id,
    v_merged.current_status_id,
    v_duplicate_status_id,
    now(),
    'system',
    null,
    v_reason,
    public.current_actor_id()
  );

  update public.persons
  set
    is_merged = true,
    merged_into_person_id = v_primary.id,
    current_status_id = v_duplicate_status_id,
    updated_by = public.current_actor_id()
  where id = v_merged.id;

  perform set_config('rcc.allow_person_merge_insert', 'off', true);
  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_primary.incident_id,
    'operational_numbers_merged',
    'איחוד מספרים מבצעיים',
    '#' || v_merged.operational_number || ' אוחד עם #' || v_primary.operational_number,
    'merge',
    'important',
    now(),
    coalesce(v_primary.site_id, v_merged.site_id),
    coalesce(v_primary.floor_id, v_merged.floor_id),
    coalesce(v_primary.unit_id, v_merged.unit_id),
    v_primary.id,
    null,
    'system',
    null,
    jsonb_build_object(
      'merge_id', v_merge_id,
      'primary_person_id', v_primary.id,
      'merged_person_id', v_merged.id,
      'primary_operational_number', v_primary.operational_number,
      'merged_operational_number', v_merged.operational_number,
      'primary_team_number', public.operational_number_team_number(v_primary.operational_number),
      'merged_team_number', public.operational_number_team_number(v_merged.operational_number),
      'merged_previous_status_id', v_merged.current_status_id,
      'merged_new_status_id', v_duplicate_status_id,
      'reason', v_reason
    )
  );

  return v_primary.id;
exception
  when others then
    perform set_config('rcc.allow_person_merge_insert', 'off', true);
    perform set_config('rcc.allow_status_history_insert', 'off', true);
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

create or replace view public.operational_numbers_dashboard
with (security_invoker = true) as
with linked_residents as (
  select distinct on (ur.linked_person_id)
    ur.linked_person_id as person_id,
    ur.id as resident_id,
    ur.first_name as resident_first_name,
    ur.last_name as resident_last_name,
    ur.unit_id as resident_unit_id
  from public.unit_residents ur
  where ur.linked_person_id is not null
    and ur.is_active = true
  order by ur.linked_person_id, ur.updated_at desc, ur.created_at desc
),
latest_reports as (
  select distinct on (opr.person_id)
    opr.*
  from public.operational_reports opr
  order by opr.person_id, opr.reported_at desc, opr.created_at desc
),
merged_numbers as (
  select
    pm.primary_person_id as person_id,
    array_agg(pm.merged_operational_number order by pm.merged_operational_number) as merged_operational_numbers
  from public.person_merges pm
  group by pm.primary_person_id
)
select
  p.incident_id,
  p.site_id,
  p.id as person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  p.first_name,
  p.last_name,
  p.current_status_id,
  current_status.status_key as current_status_key,
  current_status.hebrew_label as current_status_label,
  current_status.counts_as_gap_resolved,
  p.unit_id,
  u.unit_number,
  f.floor_number,
  lr.resident_id,
  lr.resident_first_name,
  lr.resident_last_name,
  latest.id as latest_report_id,
  latest.status_id as latest_report_status_id,
  latest_status.status_key as latest_report_status_key,
  latest_status.hebrew_label as latest_report_status_label,
  latest.information_source_type as latest_source_type,
  latest.information_source_name as latest_source_name,
  latest.source_phone as latest_source_phone,
  latest.grid_cell as latest_grid_cell,
  latest.confidence_level as latest_confidence_level,
  latest.notes as latest_notes,
  latest.reported_at as latest_reported_at,
  latest.created_at as latest_report_created_at,
  p.is_merged,
  p.merged_into_person_id,
  public.operational_status_dashboard_group(current_status.status_key) as dashboard_status_group,
  public.operational_status_dashboard_label(current_status.status_key) as dashboard_status_label,
  public.operational_status_card_color(current_status.status_key) as dashboard_card_color,
  coalesce(mn.merged_operational_numbers, array[]::integer[]) as merged_operational_numbers
from public.persons p
join public.status_types current_status on current_status.id = p.current_status_id
left join latest_reports latest on latest.person_id = p.id
left join public.status_types latest_status on latest_status.id = latest.status_id
left join linked_residents lr on lr.person_id = p.id
left join merged_numbers mn on mn.person_id = p.id
left join public.units u on u.id = coalesce(p.unit_id, lr.resident_unit_id)
left join public.floors f on f.id = u.floor_id;

create or replace view public.incident_dashboard_summary
with (security_invoker = true) as
with resolved as (
  select
    p.incident_id,
    count(*)::integer as resolved_persons
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  where p.is_merged = false
    and st.is_dashboard_counted = true
    and st.is_open = false
    and st.status_key <> 'duplicate_cancelled'
  group by p.incident_id
),
resident_potential as (
  select
    ur.incident_id,
    count(*) filter (where ur.is_active = true)::integer as updated_potential
  from public.unit_residents ur
  group by ur.incident_id
),
operational_numbers as (
  select
    p.incident_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (
      where public.operational_number_team_number(p.operational_number) <> 9
    )::integer as active_rescue_teams_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer
      as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer
      as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer
      as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer
      as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer
      as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer
      as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer
      as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id
    from public.unit_residents ur
    where ur.linked_person_id = p.id
      and ur.is_active = true
    limit 1
  ) linked_resident on true
  where p.is_merged = false
    and st.status_key <> 'duplicate_cancelled'
  group by p.incident_id
),
teams as (
  select
    t.incident_id,
    count(*)::integer as total_teams,
    count(*) filter (
      where st.status_key = 'available'
    )::integer as available_teams
  from public.teams t
  left join public.status_types st on st.id = t.status_id
  where t.is_active = true
  group by t.incident_id
),
assignments as (
  select
    incident_id,
    count(*) filter (where assignment_status = 'active')::integer as active_assignments
  from public.team_site_assignments
  group by incident_id
)
select
  i.id as incident_id,
  i.name,
  i.city,
  i.address,
  i.opened_at,
  i.ended_at,
  i.is_closed,
  i.status_id,
  incident_status.status_key as incident_status_key,
  incident_status.hebrew_label as incident_status_label,
  count(distinct s.id)::integer as total_sites,
  coalesce(sum(s.initial_potential), 0)::integer as total_initial_potential,
  coalesce(rp.updated_potential, 0)::integer as total_updated_potential,
  coalesce(r.resolved_persons, 0)::integer as resolved_persons,
  greatest(
    coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0),
    0
  )::integer as operational_gap,
  coalesce(t.total_teams, 0)::integer as total_teams,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_teams,
  coalesce(t.available_teams, 0)::integer as available_teams,
  coalesce(a.active_assignments, 0)::integer as active_team_site_assignments,
  coalesce(sum(s.initial_potential), 0)::integer as initial_potential,
  coalesce(rp.updated_potential, 0)::integer as updated_potential,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_rescue_teams_count
from public.incidents i
join public.status_types incident_status on incident_status.id = i.status_id
left join public.sites s on s.incident_id = i.id and s.is_active = true
left join resolved r on r.incident_id = i.id
left join resident_potential rp on rp.incident_id = i.id
left join operational_numbers onm on onm.incident_id = i.id
left join teams t on t.incident_id = i.id
left join assignments a on a.incident_id = i.id
group by
  i.id,
  incident_status.status_key,
  incident_status.hebrew_label,
  rp.updated_potential,
  r.resolved_persons,
  onm.active_operational_numbers_count,
  onm.unassigned_operational_numbers_count,
  onm.active_rescue_teams_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count,
  t.total_teams,
  t.available_teams,
  a.active_assignments;

create or replace view public.site_dashboard_summary
with (security_invoker = true) as
with resident_potential as (
  select
    ur.site_id,
    count(*) filter (where ur.is_active = true)::integer as updated_potential
  from public.unit_residents ur
  group by ur.site_id
),
operational_numbers as (
  select
    p.site_id,
    count(*)::integer as active_operational_numbers_count,
    count(*) filter (where linked_resident.id is null)::integer as unassigned_operational_numbers_count,
    count(distinct public.operational_number_team_number(p.operational_number)) filter (
      where public.operational_number_team_number(p.operational_number) <> 9
    )::integer as active_rescue_teams_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'missing_unknown')::integer
      as operational_numbers_missing_unknown_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'trapped_located_not_yet_rescued')::integer
      as operational_numbers_trapped_located_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'rescued')::integer
      as operational_numbers_rescued_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'evacuated')::integer
      as operational_numbers_evacuated_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'located_outside_site')::integer
      as operational_numbers_located_outside_site_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'deceased')::integer
      as operational_numbers_deceased_count,
    count(*) filter (where public.operational_status_dashboard_group(st.status_key) = 'other')::integer
      as operational_numbers_other_count
  from public.persons p
  join public.status_types st on st.id = p.current_status_id
  left join lateral (
    select ur.id
    from public.unit_residents ur
    where ur.linked_person_id = p.id
      and ur.is_active = true
    limit 1
  ) linked_resident on true
  where p.is_merged = false
    and p.site_id is not null
    and st.status_key <> 'duplicate_cancelled'
  group by p.site_id
)
select
  s.incident_id,
  s.id as site_id,
  s.site_number,
  s.name,
  s.city,
  s.street,
  s.house_number,
  s.status_id,
  site_status.status_key as site_status_key,
  site_status.hebrew_label as site_status_label,
  s.initial_potential,
  coalesce(rp.updated_potential, 0)::integer as updated_potential,
  count(distinct u.id) filter (where u.is_active = true)::integer as total_active_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = true)::integer as fully_cleared_units,
  count(distinct u.id) filter (where u.is_active = true and u.is_fully_cleared = false)::integer as open_units,
  coalesce(onm.active_operational_numbers_count, 0)::integer as total_persons,
  count(distinct p.id) filter (where p.is_merged = false and person_status.is_open = true)::integer as open_persons,
  count(distinct p.id) filter (
    where p.is_merged = false
      and person_status.is_dashboard_counted = true
      and person_status.is_open = false
      and person_status.status_key <> 'duplicate_cancelled'
  )::integer as resolved_persons,
  greatest(
    coalesce(rp.updated_potential, 0) - coalesce(onm.active_operational_numbers_count, 0),
    0
  )::integer as operational_gap,
  coalesce(onm.active_operational_numbers_count, 0)::integer as gap_resolved_count,
  coalesce(onm.active_operational_numbers_count, 0)::integer as active_operational_numbers_count,
  coalesce(onm.unassigned_operational_numbers_count, 0)::integer as unassigned_operational_numbers_count,
  coalesce(onm.operational_numbers_missing_unknown_count, 0)::integer as operational_numbers_missing_unknown_count,
  coalesce(onm.operational_numbers_trapped_located_count, 0)::integer as operational_numbers_trapped_located_count,
  coalesce(onm.operational_numbers_rescued_count, 0)::integer as operational_numbers_rescued_count,
  coalesce(onm.operational_numbers_evacuated_count, 0)::integer as operational_numbers_evacuated_count,
  coalesce(onm.operational_numbers_located_outside_site_count, 0)::integer as operational_numbers_located_outside_site_count,
  coalesce(onm.operational_numbers_deceased_count, 0)::integer as operational_numbers_deceased_count,
  coalesce(onm.operational_numbers_other_count, 0)::integer as operational_numbers_other_count,
  coalesce(onm.active_rescue_teams_count, 0)::integer as active_rescue_teams_count
from public.sites s
join public.status_types site_status on site_status.id = s.status_id
left join resident_potential rp on rp.site_id = s.id
left join operational_numbers onm on onm.site_id = s.id
left join public.units u on u.site_id = s.id
left join public.persons p on p.site_id = s.id
left join public.status_types person_status on person_status.id = p.current_status_id
where s.is_active = true
group by
  s.incident_id,
  s.id,
  site_status.status_key,
  site_status.hebrew_label,
  rp.updated_potential,
  onm.active_operational_numbers_count,
  onm.unassigned_operational_numbers_count,
  onm.active_rescue_teams_count,
  onm.operational_numbers_missing_unknown_count,
  onm.operational_numbers_trapped_located_count,
  onm.operational_numbers_rescued_count,
  onm.operational_numbers_evacuated_count,
  onm.operational_numbers_located_outside_site_count,
  onm.operational_numbers_deceased_count,
  onm.operational_numbers_other_count;

comment on function public.merge_operational_numbers(uuid, integer, integer, text)
  is 'Merges one Team 9 population/intelligence operational number into one rescue-team operational number, preserving both records and appending an immutable EventLog.';
