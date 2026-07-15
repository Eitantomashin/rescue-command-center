-- Align controlled incident purge flag with active diagnostic requirements.
-- Operational reports remain immutable except during admin-controlled incident purge.

create or replace function public.prevent_operational_reports_update_or_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
    and coalesce(current_setting('rcc.allow_incident_purge_operational_reports', true), '') = 'true'
  then
    return old;
  end if;

  raise exception 'Records in % are immutable', tg_table_name;
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

  perform set_config('rcc.allow_incident_purge_operational_reports', 'true', true);
  delete from public.operational_reports where incident_id = p_incident_id;
  perform set_config('rcc.allow_incident_purge_operational_reports', 'false', true);

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

revoke all on function public.prevent_operational_reports_update_or_delete() from public, anon;
revoke all on function public.permanently_delete_archived_incident(uuid, text) from public, anon;
grant execute on function public.permanently_delete_archived_incident(uuid, text) to authenticated;
