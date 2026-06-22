-- Phase 10B: EventLog audit extensions and incident timeline foundation.

alter table public.event_logs
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists before_state jsonb,
  add column if not exists after_state jsonb;

create index if not exists event_logs_incident_entity_idx
  on public.event_logs (incident_id, entity_type, entity_id, reported_at desc);

create or replace function public.populate_event_log_audit_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.entity_type := coalesce(
    new.entity_type,
    nullif(new.metadata->>'entity_type', ''),
    case
      when new.person_id is not null then 'operational_person'
      when new.unit_id is not null then 'unit'
      when new.team_id is not null then 'team'
      when new.site_id is not null then 'site'
      else 'incident'
    end
  );
  new.entity_id := coalesce(
    new.entity_id,
    nullif(new.metadata->>'entity_id', '')::uuid,
    new.person_id,
    new.unit_id,
    new.team_id,
    new.site_id,
    new.incident_id
  );
  new.before_state := coalesce(new.before_state, new.metadata->'before', new.metadata->'old_values');
  new.after_state := coalesce(new.after_state, new.metadata->'after', new.metadata->'new_values');
  return new;
exception
  when invalid_text_representation then
    new.entity_id := coalesce(new.entity_id, new.person_id, new.unit_id, new.team_id, new.site_id, new.incident_id);
    return new;
end;
$$;

drop trigger if exists event_logs_populate_audit_fields on public.event_logs;
create trigger event_logs_populate_audit_fields
  before insert on public.event_logs
  for each row execute function public.populate_event_log_audit_fields();

create or replace function public.prevent_event_log_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'EventLog audit records are immutable';
end;
$$;

drop trigger if exists event_logs_immutable_update_delete on public.event_logs;
create trigger event_logs_immutable_update_delete
  before update or delete on public.event_logs
  for each row execute function public.prevent_event_log_mutation();

create or replace function public.append_audit_event(
  p_incident_id uuid,
  p_log_type text,
  p_title text,
  p_description text default null,
  p_site_id uuid default null,
  p_person_id uuid default null,
  p_team_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_id uuid default null,
  p_importance text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_actor uuid := coalesce(p_actor_id, public.current_actor_id());
begin
  if not public.can_view_incident(p_incident_id) then
    raise exception 'User is not allowed to append audit entries for this incident';
  end if;

  perform set_config('rcc.allow_event_log_insert', 'on', true);
  insert into public.event_logs (
    incident_id, site_id, person_id, team_id, log_type, category,
    reported_at, title, description, importance, metadata, created_by,
    entity_type, entity_id, before_state, after_state
  ) values (
    p_incident_id, p_site_id, p_person_id, p_team_id, p_log_type, 'administrative',
    now(), p_title, p_description, coalesce(p_importance, 'normal'), coalesce(p_metadata, '{}'::jsonb), v_actor,
    p_entity_type, p_entity_id, p_before_state, p_after_state
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_system_audit_event(
  p_log_type text,
  p_title text,
  p_description text default null,
  p_entity_type text default 'user',
  p_entity_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_incident_id uuid;
begin
  perform public.assert_admin();
  -- Attach system administration entries to every active incident so each
  -- incident reconstruction includes the administration context at that time.
  for v_incident_id in
    select i.id from public.incidents i where i.archived_at is null
  loop
    v_id := public.append_audit_event(
      v_incident_id, p_log_type, p_title, p_description, null, null, null,
      p_entity_type, p_entity_id, p_before_state, p_after_state, p_metadata,
      public.current_actor_id(), 'normal'
    );
  end loop;
  return v_id;
end;
$$;

create or replace function public.audit_situation_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.append_audit_event(
      new.incident_id, 'situation_report_created', 'יצירת חיתוך מצב',
      'נוצר חיתוך מצב #' || new.report_number,
      null, null, null, 'situation_report', new.id, null,
      jsonb_build_object('report_number', new.report_number),
      jsonb_build_object('report_id', new.id, 'report_number', new.report_number),
      new.created_by, 'important'
    );
  elsif new.commander_decisions is distinct from old.commander_decisions
     or new.meeting_summary is distinct from old.meeting_summary then
    perform public.append_audit_event(
      new.incident_id, 'situation_report_meeting_completed', 'השלמת ישיבת חיתוך מצב',
      'נשמרו סיכום והחלטות לחיתוך מצב #' || new.report_number,
      null, null, null, 'situation_report', new.id,
      jsonb_build_object('commander_decisions', old.commander_decisions, 'meeting_summary', old.meeting_summary),
      jsonb_build_object('commander_decisions', new.commander_decisions, 'meeting_summary', new.meeting_summary),
      jsonb_build_object('report_id', new.id, 'report_number', new.report_number),
      new.updated_by, 'normal'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists situation_reports_audit on public.situation_reports;
create trigger situation_reports_audit
  after insert or update on public.situation_reports
  for each row execute function public.audit_situation_report_change();

create or replace function public.audit_incident_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_title text;
begin
  if new.archived_at is distinct from old.archived_at then
    v_type := case when new.archived_at is null then 'incident_restored' else 'incident_archived' end;
    v_title := case when new.archived_at is null then 'שחזור אירוע מארכיון' else 'העברת אירוע לארכיון' end;
  else
    v_type := 'incident_updated';
    v_title := 'עדכון אירוע';
  end if;
  perform public.append_audit_event(
    new.id, v_type, v_title, new.name,
    null, null, null, 'incident', new.id,
    to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at', '{}'::jsonb,
    coalesce(new.updated_by, public.current_actor_id()), 'normal'
  );
  return new;
end;
$$;

drop trigger if exists incidents_audit_update on public.incidents;
create trigger incidents_audit_update
  after update on public.incidents
  for each row
  when (old.* is distinct from new.*)
  execute function public.audit_incident_change();

create or replace function public.audit_site_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.append_audit_event(
    new.incident_id, 'site_updated', 'עדכון אתר',
    coalesce(nullif(btrim(new.name), ''), concat_ws(' ', new.street, new.house_number)),
    new.id, null, null, 'site', new.id,
    to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at',
    jsonb_build_object('site_id', new.id),
    coalesce(new.updated_by, public.current_actor_id()), 'normal'
  );
  return new;
end;
$$;

drop trigger if exists sites_audit_update on public.sites;
create trigger sites_audit_update
  after update on public.sites
  for each row
  when (old.* is distinct from new.*)
  execute function public.audit_site_change();

create or replace function public.audit_site_map_object_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.append_audit_event(
    new.incident_id,
    case when new.geometry is distinct from old.geometry then 'site_map_object_moved' else 'site_map_object_updated' end,
    case when new.geometry is distinct from old.geometry then 'הזזת אובייקט מפה' else 'עדכון אובייקט מפה' end,
    new.name, new.site_id, null, null, 'site_map_object', new.id,
    jsonb_build_object(
      'name', old.name, 'assigned_team_number', old.assigned_team_number,
      'operational_status', old.operational_status, 'notes', old.notes,
      'geometry', old.geometry, 'is_active', old.is_active
    ),
    jsonb_build_object(
      'name', new.name, 'assigned_team_number', new.assigned_team_number,
      'operational_status', new.operational_status, 'notes', new.notes,
      'geometry', new.geometry, 'is_active', new.is_active
    ),
    jsonb_build_object('map_object_id', new.id, 'object_type', new.object_type),
    public.current_actor_id(), 'normal'
  );
  return new;
end;
$$;

drop trigger if exists site_map_objects_audit_update on public.site_map_objects;
create trigger site_map_objects_audit_update
  after update on public.site_map_objects
  for each row
  when (old.* is distinct from new.*)
  execute function public.audit_site_map_object_change();

create or replace function public.audit_unit_personnel_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
  v_type text;
  v_title text;
begin
  if tg_op = 'INSERT' then
    v_type := 'personnel_added';
    v_title := 'הוספת איש כוח אדם';
  elsif old.is_active = true and new.is_active = false then
    v_type := 'personnel_removed';
    v_title := 'הוצאה מפעילות';
  elsif old.department is distinct from new.department then
    v_type := 'personnel_team_changed';
    v_title := 'שינוי שיוך כוח אדם';
  else
    v_type := 'personnel_updated';
    v_title := 'עדכון כוח אדם';
  end if;

  for v_incident_id in
    select i.id from public.incidents i where i.archived_at is null
  loop
    perform public.append_audit_event(
      v_incident_id, v_type, v_title,
      concat_ws(' ', new.first_name, new.last_name),
      null, null, null, 'unit_personnel', new.id,
      case when tg_op = 'UPDATE' then to_jsonb(old) - array['mobile_phone', 'created_at', 'updated_at'] else null end,
      to_jsonb(new) - array['mobile_phone', 'created_at', 'updated_at'],
      jsonb_build_object('personnel_id', new.id),
      coalesce(public.current_actor_id(), new.created_by), 'normal'
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists unit_personnel_audit on public.unit_personnel;
create trigger unit_personnel_audit
  after insert or update on public.unit_personnel
  for each row execute function public.audit_unit_personnel_change();

create or replace function public.audit_event_personnel_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person record;
begin
  select first_name, last_name, department into v_person
  from public.unit_personnel where id = new.personnel_id;
  perform public.append_audit_event(
    new.incident_id,
    case when tg_op = 'INSERT' then 'event_personnel_added' else 'event_personnel_updated' end,
    case when tg_op = 'INSERT' then 'הוספת כוח אדם לאירוע' else 'עדכון כוח אדם באירוע' end,
    concat_ws(' ', v_person.first_name, v_person.last_name),
    null, null, null, 'event_personnel', new.personnel_id,
    case when tg_op = 'UPDATE' then jsonb_build_object('attendance_status', old.attendance_status) else null end,
    jsonb_build_object('attendance_status', new.attendance_status, 'department', v_person.department),
    jsonb_build_object('personnel_id', new.personnel_id),
    coalesce(new.updated_by, public.current_actor_id()), 'normal'
  );
  return new;
end;
$$;

drop trigger if exists event_personnel_status_audit on public.event_personnel_status;
create trigger event_personnel_status_audit
  after insert or update on public.event_personnel_status
  for each row execute function public.audit_event_personnel_change();

create or replace function public.get_incident_timeline(
  p_incident_id uuid,
  p_limit integer default 500
)
returns table (
  id uuid, incident_id uuid, site_id uuid, person_id uuid, team_id uuid,
  log_type text, category text, reported_at timestamptz, title text, description text,
  importance text, metadata jsonb, created_by uuid, actor_display_name text,
  site_name text, operational_number integer, person_name text,
  entity_type text, entity_id uuid, before_state jsonb, after_state jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_incident_viewer(p_incident_id);
  return query
  select
    el.id, el.incident_id, el.site_id, el.person_id, el.team_id,
    el.log_type, el.category, el.reported_at, el.title, el.description,
    el.importance, el.metadata, el.created_by,
    coalesce(nullif(btrim(pr.display_name), ''), 'מערכת') as actor_display_name,
    coalesce(nullif(btrim(s.name), ''), concat_ws(' ', s.street, s.house_number)) as site_name,
    coalesce(
      p.operational_number,
      case when coalesce(el.metadata->>'operational_number', '') ~ '^\d+$'
        then (el.metadata->>'operational_number')::integer else null end
    ) as operational_number,
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name,
    el.entity_type, el.entity_id, el.before_state, el.after_state
  from public.event_logs el
  left join public.profiles pr on pr.id = el.created_by
  left join public.sites s on s.id = el.site_id
  left join public.persons p on p.id = el.person_id
  where el.incident_id = p_incident_id
  order by el.reported_at desc, el.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

revoke all on function public.append_audit_event(uuid, text, text, text, uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, uuid, text) from public, anon;
revoke all on function public.create_system_audit_event(text, text, text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.get_incident_timeline(uuid, integer) from public, anon;
grant execute on function public.get_incident_timeline(uuid, integer) to authenticated;
grant execute on function public.create_system_audit_event(text, text, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
