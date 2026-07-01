-- Controlled cancellation of operational numbers.
-- Soft-cancel only: existing reports, event logs, and history remain intact.

alter table public.persons
  add column if not exists is_cancelled boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text;

create index if not exists persons_active_operational_numbers_idx
  on public.persons (incident_id, site_id, operational_number)
  where is_cancelled = false;

create or replace function public.cancel_operational_number(
  p_person_id uuid,
  p_reason text,
  p_reason_other text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_reason text;
  v_cancelled_status_id uuid;
begin
  select *
  into v_person
  from public.persons
  where id = p_person_id;

  if not found then
    raise exception 'Operational number was not found';
  end if;

  perform public.assert_edit_operational_data(v_person.incident_id);

  if v_person.is_cancelled then
    raise exception 'Operational number is already cancelled';
  end if;

  if v_person.is_merged then
    raise exception 'Merged secondary operational numbers are already inactive';
  end if;

  v_reason := case nullif(btrim(coalesce(p_reason, '')), '')
    when 'created_by_mistake' then 'נוצר בטעות'
    when 'duplicate' then 'כפילות'
    when 'opened_by_mistake' then 'נפתח בטעות'
    when 'other' then nullif(btrim(coalesce(p_reason_other, '')), '')
    else nullif(btrim(coalesce(p_reason, '')), '')
  end;

  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  select id
  into v_cancelled_status_id
  from public.status_types
  where category = 'person'
    and status_key = 'duplicate_cancelled'
    and is_active = true
    and (incident_id is null or incident_id = v_person.incident_id)
  order by incident_id desc nulls last
  limit 1;

  if v_cancelled_status_id is null then
    raise exception 'Duplicate/cancelled status is missing';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set is_cancelled = true,
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancellation_reason = v_reason,
      current_status_id = v_cancelled_status_id,
      updated_by = v_actor_id
  where id = v_person.id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_person.incident_id,
    'operational_number_cancelled',
    '🗑️ מספר מבצעי בוטל',
    'המספר המבצעי ' || v_person.operational_number || ' בוטל על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '. סיבה: ' || v_reason || '.',
    'operational',
    'high',
    now(),
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'cancellation_reason', v_reason,
      'cancelled_at', now()
    )
  );
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.cancel_operational_number(uuid, text, text) to authenticated;

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
    array_agg(pm.merged_operational_number order by pm.merged_operational_number) as merged_operational_numbers,
    array_agg(pm.merged_person_id order by pm.merged_operational_number) as merged_person_ids,
    max(pm.merged_at) as latest_merge_at,
    (array_agg(pm.reason order by pm.merged_at desc))[1] as latest_merge_reason
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
  primary_person.operational_number as merged_into_operational_number,
  coalesce(mn.merged_person_ids, array[]::uuid[]) as merged_person_ids,
  mn.latest_merge_at,
  mn.latest_merge_reason
from public.persons p
join public.status_types current_status on current_status.id = p.current_status_id
left join public.persons primary_person on primary_person.id = p.merged_into_person_id
left join public.status_types primary_status on primary_status.id = primary_person.current_status_id
left join latest_reports latest on latest.person_id = p.id
left join public.status_types latest_status on latest_status.id = latest.status_id
left join linked_residents lr on lr.person_id = p.id
left join merged_numbers mn on mn.person_id = p.id
left join public.units u on u.id = coalesce(p.unit_id, lr.resident_unit_id)
left join public.floors f on f.id = u.floor_id
where p.is_cancelled = false;
