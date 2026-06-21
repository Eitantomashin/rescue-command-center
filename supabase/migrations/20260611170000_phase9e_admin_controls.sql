-- Phase 9E: admin controls for incident archive/restore.
-- No hard delete. No EventLog writes.

alter table public.incidents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

create or replace function public.archive_incident(
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
begin
  perform public.assert_admin();

  select id, name, archived_at
  into v_incident
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident does not exist';
  end if;

  if v_incident.archived_at is not null then
    return;
  end if;

  if coalesce(p_confirmation_name, '') <> v_incident.name then
    raise exception 'Incident name confirmation does not match';
  end if;

  update public.incidents
  set archived_at = now(),
      archived_by = public.current_actor_id(),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_incident_id;
end;
$$;

create or replace function public.restore_incident_from_archive(
  p_incident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();

  update public.incidents
  set archived_at = null,
      archived_by = null,
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_incident_id;

  if not found then
    raise exception 'Incident does not exist';
  end if;
end;
$$;
