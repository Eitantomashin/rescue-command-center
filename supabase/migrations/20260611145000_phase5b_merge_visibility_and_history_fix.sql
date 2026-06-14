-- Phase 5B merge visibility and history fix.
--
-- Merged operational numbers stay visible in the operational dashboard and
-- operational history. They remain excluded from active-count calculations.

drop function if exists public.merge_operational_numbers(uuid, integer, integer, text);

create or replace function public.merge_operational_numbers(
  p_incident_id uuid,
  p_source_operational_number integer,
  p_target_operational_number integer,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.persons%rowtype;
  v_target public.persons%rowtype;
  v_primary public.persons%rowtype;
  v_merged public.persons%rowtype;
  v_duplicate_status_id uuid;
  v_merge_id uuid;
  v_reason text;
  v_primary_team integer;
  v_merged_team integer;
  v_best_first_name text;
  v_best_last_name text;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  if p_source_operational_number = p_target_operational_number then
    raise exception 'Cannot merge an operational number into itself';
  end if;

  select * into v_source
  from public.persons
  where incident_id = p_incident_id
    and operational_number = p_source_operational_number
  for update;

  if not found then
    raise exception 'Operational number % does not exist', p_source_operational_number;
  end if;

  select * into v_target
  from public.persons
  where incident_id = p_incident_id
    and operational_number = p_target_operational_number
  for update;

  if not found then
    raise exception 'Operational number % does not exist', p_target_operational_number;
  end if;

  if v_source.is_merged or v_target.is_merged then
    raise exception 'Cannot merge numbers that are already marked as merged';
  end if;

  if public.operational_number_team_number(v_source.operational_number) = 9
    and public.operational_number_team_number(v_target.operational_number) <> 9
  then
    v_primary := v_target;
    v_merged := v_source;
  elsif public.operational_number_team_number(v_target.operational_number) = 9
    and public.operational_number_team_number(v_source.operational_number) <> 9
  then
    v_primary := v_source;
    v_merged := v_target;
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

  v_primary_team := public.operational_number_team_number(v_primary.operational_number);
  v_merged_team := public.operational_number_team_number(v_merged.operational_number);
  v_reason := coalesce(
    nullif(btrim(p_reason), ''),
    '#' || v_merged.operational_number || ' אוחד עם #' || v_primary.operational_number
  );

  v_best_first_name := coalesce(nullif(btrim(v_primary.first_name), ''), nullif(btrim(v_merged.first_name), ''));
  v_best_last_name := coalesce(nullif(btrim(v_primary.last_name), ''), nullif(btrim(v_merged.last_name), ''));

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
    first_name = coalesce(v_best_first_name, first_name),
    last_name = coalesce(v_best_last_name, last_name),
    updated_by = public.current_actor_id()
  where id = v_primary.id;

  update public.persons
  set
    first_name = coalesce(v_best_first_name, first_name),
    last_name = coalesce(v_best_last_name, last_name),
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
      'source_operational_number', p_source_operational_number,
      'target_operational_number', p_target_operational_number,
      'primary_operational_number', v_primary.operational_number,
      'merged_operational_number', v_merged.operational_number,
      'primary_team_number', v_primary_team,
      'merged_team_number', v_merged_team,
      'merged_previous_status_id', v_merged.current_status_id,
      'merged_new_status_id', v_duplicate_status_id,
      'best_first_name', v_best_first_name,
      'best_last_name', v_best_last_name,
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

with merge_names as (
  select
    pm.primary_person_id,
    pm.merged_person_id,
    coalesce(nullif(btrim(primary_person.first_name), ''), nullif(btrim(merged_person.first_name), '')) as best_first_name,
    coalesce(nullif(btrim(primary_person.last_name), ''), nullif(btrim(merged_person.last_name), '')) as best_last_name
  from public.person_merges pm
  join public.persons primary_person on primary_person.id = pm.primary_person_id
  join public.persons merged_person on merged_person.id = pm.merged_person_id
)
update public.persons p
set
  first_name = coalesce(nullif(btrim(p.first_name), ''), mn.best_first_name),
  last_name = coalesce(nullif(btrim(p.last_name), ''), mn.best_last_name)
from merge_names mn
where p.id in (mn.primary_person_id, mn.merged_person_id)
  and (
    (nullif(btrim(p.first_name), '') is null and mn.best_first_name is not null)
    or (nullif(btrim(p.last_name), '') is null and mn.best_last_name is not null)
  );

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
  coalesce(p.first_name, primary_person.first_name) as first_name,
  coalesce(p.last_name, primary_person.last_name) as last_name,
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
  public.operational_status_dashboard_group(coalesce(primary_status.status_key, current_status.status_key)) as dashboard_status_group,
  public.operational_status_dashboard_label(coalesce(primary_status.status_key, current_status.status_key)) as dashboard_status_label,
  public.operational_status_card_color(coalesce(primary_status.status_key, current_status.status_key)) as dashboard_card_color,
  coalesce(mn.merged_operational_numbers, array[]::integer[]) as merged_operational_numbers,
  primary_person.operational_number as merged_into_operational_number
from public.persons p
join public.status_types current_status on current_status.id = p.current_status_id
left join public.persons primary_person on primary_person.id = p.merged_into_person_id
left join public.status_types primary_status on primary_status.id = primary_person.current_status_id
left join latest_reports latest on latest.person_id = p.id
left join public.status_types latest_status on latest_status.id = latest.status_id
left join linked_residents lr on lr.person_id = p.id
left join merged_numbers mn on mn.person_id = p.id
left join public.units u on u.id = coalesce(p.unit_id, lr.resident_unit_id)
left join public.floors f on f.id = u.floor_id;

create or replace view public.operational_report_history
with (security_invoker = true) as
select
  opr.id as report_id,
  opr.incident_id,
  opr.site_id,
  opr.person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  opr.status_id,
  st.status_key,
  st.hebrew_label as status_label,
  opr.information_source_type,
  opr.information_source_name,
  opr.source_phone,
  opr.grid_cell,
  opr.confidence_level,
  opr.notes,
  opr.reported_at,
  opr.created_by,
  opr.created_at,
  'report'::text as history_kind
from public.operational_reports opr
join public.persons p on p.id = opr.person_id
join public.status_types st on st.id = opr.status_id
union all
select
  el.id as report_id,
  el.incident_id,
  el.site_id,
  history_person.person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  null::uuid as status_id,
  'operational_numbers_merged'::text as status_key,
  el.title as status_label,
  coalesce(el.source_type, 'מערכת') as information_source_type,
  el.source_name as information_source_name,
  null::text as source_phone,
  null::text as grid_cell,
  'לא ידוע'::text as confidence_level,
  el.description as notes,
  el.reported_at,
  el.created_by,
  el.created_at,
  'event_log'::text as history_kind
from public.event_logs el
cross join lateral (
  values
    ((el.metadata->>'primary_person_id')::uuid),
    ((el.metadata->>'merged_person_id')::uuid)
) as history_person(person_id)
join public.persons p on p.id = history_person.person_id
where el.log_type = 'operational_numbers_merged'
  and history_person.person_id is not null;

comment on function public.merge_operational_numbers(uuid, integer, integer, text)
  is 'Merges one Team 9 population/intelligence operational number with one rescue-team operational number, keeps both visible, syncs best known name, and appends immutable EventLog metadata for both histories.';
