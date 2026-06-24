-- Phase 10D: incident lifecycle, closure reports, and permanent delete.

alter table public.incidents
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'paused', 'closed')),
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references public.profiles(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.profiles(id);

alter table public.sites
  add column if not exists lifecycle_status text not null default 'open'
    check (lifecycle_status in ('open', 'paused', 'closed')),
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references public.profiles(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.profiles(id);

update public.incidents
set lifecycle_status = case when is_closed then 'closed' else lifecycle_status end,
    closed_at = coalesce(closed_at, ended_at)
where is_closed = true;

create table if not exists public.closure_reports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  report_number integer not null check (report_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  command_summary text,
  lessons_learned text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz,
  constraint closure_reports_incident_number_unique unique (incident_id, report_number)
);

create index if not exists closure_reports_incident_number_idx
  on public.closure_reports (incident_id, report_number desc);

alter table public.closure_reports enable row level security;

drop policy if exists closure_reports_incident_select on public.closure_reports;
create policy closure_reports_incident_select
  on public.closure_reports for select
  using (public.can_view_incident(incident_id));

drop policy if exists closure_reports_no_direct_insert on public.closure_reports;
drop policy if exists closure_reports_no_direct_update on public.closure_reports;
drop policy if exists closure_reports_no_direct_delete on public.closure_reports;

create or replace function public.can_control_incident_lifecycle(p_incident_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'commander')
    and public.can_view_incident(p_incident_id);
$$;

create or replace function public.assert_control_incident_lifecycle(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_control_incident_lifecycle(p_incident_id) then
    raise exception 'User is not allowed to control incident lifecycle';
  end if;
end;
$$;

create or replace function public.create_closure_report_snapshot(p_incident_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_actor_id();
  v_report_id uuid;
  v_report_number integer;
  v_snapshot jsonb;
begin
  perform public.assert_control_incident_lifecycle(p_incident_id);
  perform pg_advisory_xact_lock(hashtextextended('closure:' || p_incident_id::text, 0));

  select coalesce(max(report_number), 0) + 1
  into v_report_number
  from public.closure_reports
  where incident_id = p_incident_id;

  select jsonb_build_object(
    'schema_version', 1,
    'report_type', 'closure',
    'captured_at', now(),
    'incident', jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'incident_type', i.incident_type,
      'city', i.city,
      'address', i.address,
      'opened_at', i.opened_at,
      'closed_at', coalesce(i.closed_at, i.ended_at),
      'duration_seconds', extract(epoch from (coalesce(i.closed_at, i.ended_at, now()) - i.opened_at))::integer,
      'lifecycle_status', i.lifecycle_status,
      'is_closed', i.is_closed,
      'status_label', st.hebrew_label
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
    'latest_sitrep', coalesce((
      select jsonb_build_object('id', sr.id, 'report_number', sr.report_number, 'created_at', sr.created_at)
      from public.situation_reports sr
      where sr.incident_id = p_incident_id
      order by sr.report_number desc
      limit 1
    ), '{}'::jsonb),
    'sites', coalesce((
      select jsonb_agg(to_jsonb(sds) || jsonb_build_object('lifecycle_status', s.lifecycle_status) order by sds.site_number)
      from public.site_dashboard_summary sds
      join public.sites s on s.id = sds.site_id
      where sds.incident_id = p_incident_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.team_number)
      from public.teams t
      where t.incident_id = p_incident_id and t.is_active = true
    ), '[]'::jsonb),
    'operational_numbers', coalesce((
      select jsonb_agg(to_jsonb(ond) order by ond.site_id, ond.team_number, ond.operational_number)
      from public.operational_numbers_dashboard ond
      where ond.incident_id = p_incident_id
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
      ) order by up.department, up.last_name, up.first_name)
      from public.event_personnel_status eps
      join public.unit_personnel up on up.id = eps.personnel_id
      where eps.incident_id = p_incident_id
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.incidents i
  join public.status_types st on st.id = i.status_id
  join public.profiles p on p.id = v_actor_id
  where i.id = p_incident_id;

  if v_snapshot is null then
    raise exception 'Closure report snapshot could not be created';
  end if;

  insert into public.closure_reports (incident_id, report_number, snapshot, created_by)
  values (p_incident_id, v_report_number, v_snapshot, v_actor_id)
  returning id into v_report_id;

  perform public.create_event_log(
    p_incident_id,
    'closure_report_created',
    'יצירת דוח סגירת אירוע',
    'דוח סגירת אירוע #' || v_report_number || ' נוצר',
    'administrative',
    'normal',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('closure_report_id', v_report_id, 'report_number', v_report_number)
  );

  return v_report_id;
end;
$$;

create or replace function public.close_incident_lifecycle(p_incident_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_actor_id();
  v_closed_status_id uuid;
  v_site_closed_status_id uuid;
  v_report_id uuid;
begin
  perform public.assert_control_incident_lifecycle(p_incident_id);

  v_closed_status_id := public.get_status_id('incident', 'closed', p_incident_id);
  v_site_closed_status_id := public.get_status_id('site', 'closed', p_incident_id);

  update public.incidents
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_incident_id
    and archived_at is null;

  if not found then
    raise exception 'Incident does not exist or is archived';
  end if;

  update public.sites
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_site_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where incident_id = p_incident_id
    and lifecycle_status <> 'closed';

  perform public.create_event_log(
    p_incident_id,
    'incident_closed',
    'סגירת פעילות באירוע',
    'פעילות האירוע נסגרה וכל האתרים הפעילים נסגרו',
    'administrative',
    'important',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('incident_id', p_incident_id, 'closed_by', v_actor_id)
  );

  v_report_id := public.create_closure_report_snapshot(p_incident_id);

  update public.incidents
  set is_closed = true,
      ended_at = coalesce(ended_at, closed_at, now()),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_incident_id;

  return v_report_id;
end;
$$;

create or replace function public.reopen_incident_lifecycle(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_actor_id();
  v_active_status_id uuid;
begin
  perform public.assert_control_incident_lifecycle(p_incident_id);
  v_active_status_id := public.get_status_id('incident', 'active', p_incident_id);

  update public.incidents
  set lifecycle_status = 'active',
      is_closed = false,
      ended_at = null,
      reopened_at = now(),
      reopened_by = v_actor_id,
      status_id = coalesce(v_active_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_incident_id and archived_at is null;

  if not found then
    raise exception 'Incident does not exist or is archived';
  end if;

  perform public.create_event_log(
    p_incident_id,
    'incident_reopened',
    'החזרת אירוע לפעילות',
    'האירוע הוחזר לפעילות. אתרים סגורים נשארים סגורים עד פתיחה פרטנית.',
    'administrative',
    'important',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('incident_id', p_incident_id, 'reopened_by', v_actor_id)
  );
end;
$$;

create or replace function public.pause_incident_lifecycle(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_control_incident_lifecycle(p_incident_id);

  update public.incidents
  set lifecycle_status = 'paused',
      paused_at = now(),
      paused_by = public.current_actor_id(),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_incident_id and archived_at is null and lifecycle_status <> 'closed';

  if not found then
    raise exception 'Incident cannot be paused';
  end if;

  perform public.create_event_log(
    p_incident_id, 'incident_paused', 'השהיית אירוע', 'האירוע הושהה',
    'administrative', 'normal', now(), null, null, null, null, null,
    'system', 'YANSHOF', jsonb_build_object('incident_id', p_incident_id)
  );
end;
$$;

create or replace function public.close_site_lifecycle(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_closed_status_id uuid;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_control_incident_lifecycle(v_site.incident_id);
  v_closed_status_id := public.get_status_id('site', 'closed', v_site.incident_id);

  update public.sites
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_site_id;

  perform public.create_event_log(
    v_site.incident_id, 'site_closed', 'סגירת אתר',
    coalesce(nullif(btrim(v_site.name), ''), v_site.street || ' ' || v_site.house_number) || ': האתר נסגר',
    'administrative', 'important', now(), p_site_id, null, null, null, null,
    'system', 'YANSHOF', jsonb_build_object('site_id', p_site_id)
  );
end;
$$;

create or replace function public.reopen_site_lifecycle(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_open_status_id uuid;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Site does not exist';
  end if;

  perform public.assert_control_incident_lifecycle(v_site.incident_id);
  v_open_status_id := public.get_status_id('site', 'open', v_site.incident_id);

  update public.sites
  set lifecycle_status = 'open',
      reopened_at = now(),
      reopened_by = v_actor_id,
      status_id = coalesce(v_open_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_site_id
    and exists (
      select 1 from public.incidents i
      where i.id = v_site.incident_id
        and i.lifecycle_status <> 'closed'
        and i.is_closed = false
        and i.archived_at is null
    );

  if not found then
    raise exception 'Site cannot be reopened while the incident is closed or archived';
  end if;

  perform public.create_event_log(
    v_site.incident_id, 'site_reopened', 'פתיחת אתר מחדש',
    coalesce(nullif(btrim(v_site.name), ''), v_site.street || ' ' || v_site.house_number) || ': האתר נפתח מחדש',
    'administrative', 'important', now(), p_site_id, null, null, null, null,
    'system', 'YANSHOF', jsonb_build_object('site_id', p_site_id)
  );
end;
$$;

create or replace function public.rename_incident_admin(p_incident_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text := nullif(btrim(coalesce(p_new_name, '')), '');
begin
  perform public.assert_admin();

  if v_new_name is null then
    raise exception 'Incident name is required';
  end if;

  select name into v_old_name
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident does not exist';
  end if;

  update public.incidents
  set name = v_new_name,
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_incident_id;

  perform public.create_event_log(
    p_incident_id, 'incident_renamed', 'עריכת שם אירוע',
    v_old_name || ' → ' || v_new_name,
    'administrative', 'normal', now(), null, null, null, null, null,
    'system', 'YANSHOF', jsonb_build_object('old_name', v_old_name, 'new_name', v_new_name)
  );
end;
$$;

create or replace function public.update_closure_report_text(
  p_report_id uuid,
  p_command_summary text,
  p_lessons_learned text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.closure_reports%rowtype;
begin
  select * into v_report
  from public.closure_reports
  where id = p_report_id;

  if not found then
    raise exception 'Closure report does not exist';
  end if;

  perform public.assert_control_incident_lifecycle(v_report.incident_id);

  update public.closure_reports
  set command_summary = nullif(btrim(coalesce(p_command_summary, '')), ''),
      lessons_learned = nullif(btrim(coalesce(p_lessons_learned, '')), ''),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_report_id;

  perform public.create_event_log(
    v_report.incident_id, 'closure_report_completed', 'עדכון דוח סגירת אירוע',
    'סיכום מפקד ולקחים ראשוניים עודכנו',
    'administrative', 'normal', now(), null, null, null, null, null,
    'system', 'YANSHOF', jsonb_build_object('closure_report_id', p_report_id)
  );
end;
$$;

create or replace function public.permanently_delete_archived_incident(
  p_incident_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident record;
  v_global_incident_status_id uuid;
begin
  perform public.assert_admin();

  select id, name, archived_at into v_incident
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident does not exist';
  end if;

  if v_incident.archived_at is null then
    raise exception 'Only archived incidents can be permanently deleted';
  end if;

  if coalesce(p_confirmation_name, '') <> v_incident.name then
    raise exception 'Incident name confirmation does not match';
  end if;

  v_global_incident_status_id := public.get_status_id('incident', 'active', null);
  if v_global_incident_status_id is null then
    select id into v_global_incident_status_id
    from public.status_types
    where incident_id is null and category = 'incident'
    order by sort_order nulls last, created_at
    limit 1;
  end if;

  if v_global_incident_status_id is not null then
    update public.incidents
    set status_id = v_global_incident_status_id
    where id = p_incident_id;
  end if;

  alter table public.status_types disable trigger user;
  alter table public.incidents disable trigger user;
  alter table public.sites disable trigger user;
  alter table public.floors disable trigger user;
  alter table public.units disable trigger user;
  alter table public.persons disable trigger user;
  alter table public.unit_residents disable trigger user;
  alter table public.teams disable trigger user;
  alter table public.team_site_assignments disable trigger user;
  alter table public.person_status_history disable trigger user;
  alter table public.person_merges disable trigger user;
  alter table public.event_logs disable trigger user;

  delete from public.operational_reports where incident_id = p_incident_id;
  delete from public.person_status_history where incident_id = p_incident_id;
  delete from public.person_merges where incident_id = p_incident_id;
  delete from public.event_personnel_status where incident_id = p_incident_id;
  delete from public.site_map_objects where incident_id = p_incident_id;
  delete from public.situation_reports where incident_id = p_incident_id;
  delete from public.closure_reports where incident_id = p_incident_id;
  delete from public.event_logs where incident_id = p_incident_id;
  delete from public.team_site_assignments where incident_id = p_incident_id;
  delete from public.unit_residents where incident_id = p_incident_id;
  delete from public.persons where incident_id = p_incident_id;
  delete from public.units where incident_id = p_incident_id;
  delete from public.floors where incident_id = p_incident_id;
  delete from public.sites where incident_id = p_incident_id;
  delete from public.teams where incident_id = p_incident_id;
  delete from public.incident_memberships where incident_id = p_incident_id;
  delete from public.status_types where incident_id = p_incident_id;
  delete from public.incidents where id = p_incident_id;

  alter table public.status_types enable trigger user;
  alter table public.incidents enable trigger user;
  alter table public.sites enable trigger user;
  alter table public.floors enable trigger user;
  alter table public.units enable trigger user;
  alter table public.persons enable trigger user;
  alter table public.unit_residents enable trigger user;
  alter table public.teams enable trigger user;
  alter table public.team_site_assignments enable trigger user;
  alter table public.person_status_history enable trigger user;
  alter table public.person_merges enable trigger user;
  alter table public.event_logs enable trigger user;
end;
$$;

revoke all on function public.can_control_incident_lifecycle(uuid) from public, anon;
revoke all on function public.assert_control_incident_lifecycle(uuid) from public, anon;
revoke all on function public.create_closure_report_snapshot(uuid) from public, anon;
revoke all on function public.close_incident_lifecycle(uuid) from public, anon;
revoke all on function public.reopen_incident_lifecycle(uuid) from public, anon;
revoke all on function public.pause_incident_lifecycle(uuid) from public, anon;
revoke all on function public.rename_incident_admin(uuid, text) from public, anon;
revoke all on function public.update_closure_report_text(uuid, text, text) from public, anon;
revoke all on function public.permanently_delete_archived_incident(uuid, text) from public, anon;
revoke all on function public.close_site_lifecycle(uuid) from public, anon;
revoke all on function public.reopen_site_lifecycle(uuid) from public, anon;

grant execute on function public.can_control_incident_lifecycle(uuid) to authenticated;
grant execute on function public.assert_control_incident_lifecycle(uuid) to authenticated;
grant execute on function public.create_closure_report_snapshot(uuid) to authenticated;
grant execute on function public.close_incident_lifecycle(uuid) to authenticated;
grant execute on function public.reopen_incident_lifecycle(uuid) to authenticated;
grant execute on function public.pause_incident_lifecycle(uuid) to authenticated;
grant execute on function public.rename_incident_admin(uuid, text) to authenticated;
grant execute on function public.update_closure_report_text(uuid, text, text) to authenticated;
grant execute on function public.permanently_delete_archived_incident(uuid, text) to authenticated;
grant execute on function public.close_site_lifecycle(uuid) to authenticated;
grant execute on function public.reopen_site_lifecycle(uuid) to authenticated;
