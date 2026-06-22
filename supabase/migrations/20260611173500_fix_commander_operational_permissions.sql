-- Commander operational permission fix.
-- Commanders may operate on every active, non-archived incident under the
-- Phase 9G access policy. Editors still require an editable membership.

create or replace function public.can_manage_sites(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
      and public.current_user_role() in ('admin', 'commander')
  )
$$;

create or replace function public.can_edit_operational_data(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
      and (
        public.current_user_role() in ('admin', 'commander')
        or (
          public.current_user_role() = 'editor'
          and exists (
            select 1
            from public.incident_memberships im
            where im.incident_id = i.id
              and im.user_id = public.current_actor_id()
              and im.role in ('incident_commander', 'command_post_operator')
          )
        )
      )
  )
$$;

create or replace function public.can_write_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_operational_data(p_incident_id)
    and exists (
      select 1
      from public.incidents i
      where i.id = p_incident_id
        and i.is_closed = false
        and i.archived_at is null
    )
$$;

create or replace function public.can_edit_personnel(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_operational_data(p_incident_id)
$$;

create or replace function public.assert_edit_operational_data(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_edit_operational_data(p_incident_id) then
    raise exception 'Operational edit permission is required';
  end if;
end;
$$;

-- Older operational RPCs still call this helper directly.
create or replace function public.assert_incident_editor(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_edit_operational_data(p_incident_id);
end;
$$;

create or replace function public.assert_incident_writable(
  p_incident_id uuid,
  p_action text default null,
  p_is_authorized_correction boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_closed boolean;
  v_archived_at timestamptz;
  v_action text := coalesce(p_action, 'unknown');
begin
  select is_closed, archived_at
  into v_is_closed, v_archived_at
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  if not public.can_view_incident(p_incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  if v_archived_at is not null then
    raise exception 'Archived incidents are read-only';
  end if;

  if v_is_closed
    and public.current_user_role() <> 'admin'
    and not (p_is_authorized_correction and public.can_correct_closed_incident(p_incident_id))
  then
    raise exception 'Incident is closed and read-only for action %', v_action;
  end if;

  if v_action in ('close_incident', 'update_incident') then
    perform public.assert_manage_incidents();
  elsif v_action in (
    'create_site_with_structure',
    'create_site_from_wizard',
    'set_floor_unit_count',
    'renumber_site_units_continuous',
    'repair_site_wizard_unit_numbering',
    'update_site_grid_image',
    'update_site'
  ) then
    perform public.assert_manage_sites(p_incident_id);
  elsif v_action in ('set_event_personnel_status') then
    perform public.assert_edit_personnel(p_incident_id);
  else
    perform public.assert_edit_operational_data(p_incident_id);
  end if;
end;
$$;

-- A commander may update an active incident, but cannot archive it through a
-- direct table update because both policy checks require archived_at to stay null.
drop policy if exists incidents_commander_update on public.incidents;
create policy incidents_commander_update
  on public.incidents for update
  using (
    archived_at is null
    and (
      public.current_user_role() = 'admin'
      or (public.current_user_role() = 'commander' and is_closed = false)
    )
  )
  with check (
    archived_at is null
    and (
      public.current_user_role() = 'admin'
      or (public.current_user_role() = 'commander' and is_closed = false)
    )
  );

grant execute on function public.can_manage_sites(uuid) to authenticated;
grant execute on function public.can_edit_operational_data(uuid) to authenticated;
grant execute on function public.can_write_incident(uuid) to authenticated;
grant execute on function public.can_edit_personnel(uuid) to authenticated;
grant execute on function public.assert_edit_operational_data(uuid) to authenticated;
grant execute on function public.assert_incident_editor(uuid) to authenticated;
grant execute on function public.assert_incident_writable(uuid, text, boolean) to authenticated;
