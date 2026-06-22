-- Phase 10A: immutable incident situation report snapshots.

create table if not exists public.situation_reports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  report_number integer not null check (report_number > 0),
  snapshot jsonb not null,
  commander_decisions text,
  meeting_summary text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint situation_reports_incident_number_unique unique (incident_id, report_number),
  constraint situation_reports_snapshot_object check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists situation_reports_incident_created_idx
  on public.situation_reports (incident_id, report_number desc);

alter table public.situation_reports enable row level security;

drop policy if exists situation_reports_incident_select on public.situation_reports;
create policy situation_reports_incident_select
  on public.situation_reports for select
  using (public.can_view_incident(incident_id));

-- Direct writes stay closed. Creation is performed only by the approved function.
drop policy if exists situation_reports_direct_insert on public.situation_reports;
drop policy if exists situation_reports_direct_update on public.situation_reports;
drop policy if exists situation_reports_direct_delete on public.situation_reports;

create or replace function public.create_situation_report(
  p_incident_id uuid,
  p_commander_decisions text default null,
  p_meeting_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_report_id uuid;
  v_report_number integer;
  v_snapshot jsonb;
begin
  perform public.assert_incident_viewer(p_incident_id);

  v_actor_id := public.current_actor_id();
  v_actor_role := public.current_user_role();

  if v_actor_id is null or v_actor_role not in ('admin', 'commander') then
    raise exception 'Only an administrator or commander can create a situation report';
  end if;

  if not exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
  ) then
    raise exception 'Situation reports can be created only for active incidents';
  end if;

  -- Serialize numbering for this incident. A report number is never reused.
  perform pg_advisory_xact_lock(hashtextextended(p_incident_id::text, 0));

  select coalesce(max(sr.report_number), 0) + 1
  into v_report_number
  from public.situation_reports sr
  where sr.incident_id = p_incident_id;

  select jsonb_build_object(
    'schema_version', 1,
    'captured_at', now(),
    'incident', jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'incident_type', i.incident_type,
      'city', i.city,
      'address', i.address,
      'opened_at', i.opened_at,
      'is_closed', i.is_closed,
      'status_key', incident_status.status_key,
      'status_label', incident_status.hebrew_label
    ),
    'author', jsonb_build_object(
      'id', v_actor_id,
      'display_name', coalesce(nullif(btrim(p.display_name), ''), 'Unknown')
    ),
    'summary', coalesce((
      select to_jsonb(ids)
      from public.incident_dashboard_summary ids
      where ids.incident_id = p_incident_id
    ), '{}'::jsonb),
    'sites', coalesce((
      select jsonb_agg(to_jsonb(sds) order by sds.site_number)
      from public.site_dashboard_summary sds
      where sds.incident_id = p_incident_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'team_number', t.team_number,
          'name', t.name,
          'commander_name', t.commander_name,
          'personnel_count', t.personnel_count,
          'is_active', t.is_active,
          'assignments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'site_id', tsa.site_id,
              'assignment_status', tsa.assignment_status,
              'assigned_at', tsa.assigned_at
            ) order by tsa.assigned_at)
            from public.team_site_assignments tsa
            where tsa.team_id = t.id
          ), '[]'::jsonb)
        ) order by t.team_number
      )
      from public.teams t
      where t.incident_id = p_incident_id
        and t.is_active = true
    ), '[]'::jsonb),
    'operational_numbers', coalesce((
      select jsonb_agg(
        to_jsonb(ond) || jsonb_build_object(
          'site_name', coalesce(nullif(btrim(s.name), ''), concat('Site ', s.site_number))
        ) order by ond.operational_number
      )
      from public.operational_numbers_dashboard ond
      left join public.sites s on s.id = ond.site_id
      where ond.incident_id = p_incident_id
        and ond.is_merged = false
    ), '[]'::jsonb),
    'personnel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'personnel_id', eps.personnel_id,
        'first_name', up.first_name,
        'last_name', up.last_name,
        'role', up.role,
        'role_other', up.role_other,
        'department', up.department,
        'department_other', up.department_other,
        'attendance_status', eps.attendance_status,
        'updated_at', eps.updated_at
      ) order by up.last_name, up.first_name)
      from public.event_personnel_status eps
      join public.unit_personnel up on up.id = eps.personnel_id
      where eps.incident_id = p_incident_id
    ), '[]'::jsonb),
    'map_objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', smo.id,
        'site_id', smo.site_id,
        'object_type', smo.object_type,
        'name', smo.name,
        'assigned_team_number', smo.assigned_team_number,
        'operational_status', smo.operational_status
      ) order by smo.created_at)
      from public.site_map_objects smo
      where smo.incident_id = p_incident_id
        and smo.is_active = true
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.incidents i
  join public.status_types incident_status on incident_status.id = i.status_id
  join public.profiles p on p.id = v_actor_id
  where i.id = p_incident_id;

  if v_snapshot is null then
    raise exception 'Incident snapshot could not be created';
  end if;

  insert into public.situation_reports (
    incident_id,
    report_number,
    snapshot,
    commander_decisions,
    meeting_summary,
    created_by
  ) values (
    p_incident_id,
    v_report_number,
    v_snapshot,
    nullif(btrim(coalesce(p_commander_decisions, '')), ''),
    nullif(btrim(coalesce(p_meeting_summary, '')), ''),
    v_actor_id
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on table public.situation_reports is
  'Immutable command-level situation report snapshots. Historical snapshots are never recomputed.';

comment on function public.create_situation_report(uuid, text, text) is
  'Creates the next sequential situation report and captures all operational source data in one transaction.';

revoke all on function public.create_situation_report(uuid, text, text) from public, anon;
grant execute on function public.create_situation_report(uuid, text, text) to authenticated;
