-- Phase 10D lifecycle fix.
-- Site lifecycle status changes are approved operational transitions, but the
-- sites table is protected by the structure-write guard. These functions keep
-- the guard intact and enable it only around the authorized lifecycle updates.

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

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_site_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where incident_id = p_incident_id
    and lifecycle_status <> 'closed';

  perform set_config('rcc.allow_structure_write', 'off', true);

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
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
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

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set lifecycle_status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_actor_id),
      status_id = coalesce(v_closed_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_closed',
    'סגירת אתר',
    coalesce(nullif(btrim(v_site.name), ''), v_site.street || ' ' || v_site.house_number) || ': האתר נסגר',
    'administrative',
    'important',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('site_id', p_site_id)
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
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

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set lifecycle_status = 'open',
      reopened_at = now(),
      reopened_by = v_actor_id,
      status_id = coalesce(v_open_status_id, status_id),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_site_id
    and exists (
      select 1
      from public.incidents i
      where i.id = v_site.incident_id
        and i.lifecycle_status <> 'closed'
        and i.is_closed = false
        and i.archived_at is null
    );

  perform set_config('rcc.allow_structure_write', 'off', true);

  if not found then
    raise exception 'Site cannot be reopened while the incident is closed or archived';
  end if;

  perform public.create_event_log(
    v_site.incident_id,
    'site_reopened',
    'פתיחת אתר מחדש',
    coalesce(nullif(btrim(v_site.name), ''), v_site.street || ' ' || v_site.house_number) || ': האתר נפתח מחדש',
    'administrative',
    'important',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'system',
    'YANSHOF',
    jsonb_build_object('site_id', p_site_id)
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.close_incident_lifecycle(uuid) to authenticated;
grant execute on function public.close_site_lifecycle(uuid) to authenticated;
grant execute on function public.reopen_site_lifecycle(uuid) to authenticated;
