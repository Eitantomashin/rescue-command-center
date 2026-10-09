-- Stage 10.1B.1: integrity and authorization foundation for dynamic ad-hoc teams.
-- Existing memberships remain historical rows; operational transfers are introduced later.

begin;

alter table public.incident_ad_hoc_team_members
  add column if not exists operational_role text not null default 'member';

alter table public.incident_ad_hoc_team_members
  drop constraint if exists incident_ad_hoc_team_members_operational_role_check;

alter table public.incident_ad_hoc_team_members
  add constraint incident_ad_hoc_team_members_operational_role_check
  check (operational_role in ('member', 'commander', 'deputy'));

-- The existing primary key on manual personnel is not sufficient for a composite
-- foreign key that verifies the incident on a manual-member relationship.
alter table public.incident_manual_personnel
  add constraint incident_manual_personnel_id_incident_key unique (id, incident_id);

alter table public.incident_ad_hoc_team_members
  add constraint incident_ad_hoc_members_team_incident_fkey
  foreign key (ad_hoc_team_id, incident_id)
  references public.incident_ad_hoc_teams(id, incident_id)
  on delete cascade;

alter table public.incident_ad_hoc_team_members
  add constraint incident_ad_hoc_members_manual_incident_fkey
  foreign key (manual_personnel_id, incident_id)
  references public.incident_manual_personnel(id, incident_id)
  on delete cascade;

-- A person may have one current operational ad-hoc assignment per incident.
-- Historical memberships remain available because inactive rows are excluded.
create unique index incident_ad_hoc_members_unit_incident_active_uniq
  on public.incident_ad_hoc_team_members (incident_id, unit_personnel_id)
  where is_active and unit_personnel_id is not null;

create unique index incident_ad_hoc_members_manual_incident_active_uniq
  on public.incident_ad_hoc_team_members (incident_id, manual_personnel_id)
  where is_active and manual_personnel_id is not null;

-- Leadership is a role of an active membership, not a free-text identity.
-- commander_name remains untouched for backward compatibility.
create unique index incident_ad_hoc_members_active_commander_uniq
  on public.incident_ad_hoc_team_members (ad_hoc_team_id)
  where is_active and operational_role = 'commander';

create unique index incident_ad_hoc_members_active_deputy_uniq
  on public.incident_ad_hoc_team_members (ad_hoc_team_id)
  where is_active and operational_role = 'deputy';

-- This helper intentionally differs from can_edit_personnel(): editor access
-- remains available for unrelated personnel workflows, but cannot manage ad-hoc teams.
create or replace function public.assert_manage_incident_ad_hoc_teams(p_incident_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and coalesce(p.is_active, true)
      and p.deleted_at is null
  ) then
    raise exception 'Active account is required' using errcode = '42501';
  end if;

  select public.current_user_role() into v_role;
  if v_role not in ('admin', 'commander') then
    raise exception 'Ad-hoc team management permission is required' using errcode = '42501';
  end if;

  if public.can_view_incident(p_incident_id) is not true then
    raise exception 'User is not allowed to access this incident' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
  ) then
    raise exception 'Archived incidents are read-only' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create or replace function public.create_incident_ad_hoc_team(
  p_incident_id uuid,
  p_name text,
  p_purpose text default null,
  p_related_site_id uuid default null,
  p_commander_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if v_name is null then
    raise exception 'Team name is required';
  end if;

  if p_related_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_related_site_id and s.incident_id = p_incident_id
  ) then
    raise exception 'Related site does not belong to this incident';
  end if;

  insert into public.incident_ad_hoc_teams (
    incident_id, name, purpose, related_site_id, commander_name, notes, created_by, updated_by
  )
  values (
    p_incident_id,
    v_name,
    nullif(btrim(coalesce(p_purpose, '')), ''),
    p_related_site_id,
    nullif(btrim(coalesce(p_commander_name, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_actor,
    v_actor
  )
  returning id into v_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_ad_hoc_team_created',
    'צוות אד־הוק נוצר',
    'צוות אד־הוק "' || v_name || '" נוצר באירוע.',
    'important',
    null,
    jsonb_build_object('ad_hoc_team_id', v_id)
  );

  return v_id;
end;
$$;

create or replace function public.update_incident_ad_hoc_team(
  p_incident_id uuid,
  p_ad_hoc_team_id uuid,
  p_name text,
  p_purpose text default null,
  p_related_site_id uuid default null,
  p_commander_name text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_old public.incident_ad_hoc_teams%rowtype;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if v_name is null then
    raise exception 'Team name is required';
  end if;

  select * into v_old
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id
    and incident_id = p_incident_id
    and status = 'active';

  if not found then
    raise exception 'Active ad-hoc team not found';
  end if;

  if p_related_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_related_site_id and s.incident_id = p_incident_id
  ) then
    raise exception 'Related site does not belong to this incident';
  end if;

  update public.incident_ad_hoc_teams
  set name = v_name,
      purpose = nullif(btrim(coalesce(p_purpose, '')), ''),
      related_site_id = p_related_site_id,
      commander_name = nullif(btrim(coalesce(p_commander_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by = v_actor
  where id = p_ad_hoc_team_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_ad_hoc_team_edited',
    'צוות אד־הוק עודכן',
    'צוות אד־הוק "' || v_old.name || '" עודכן.',
    'normal',
    null,
    jsonb_build_object('ad_hoc_team_id', p_ad_hoc_team_id)
  );
end;
$$;

create or replace function public.add_incident_ad_hoc_team_member(
  p_incident_id uuid,
  p_ad_hoc_team_id uuid,
  p_unit_personnel_id uuid default null,
  p_manual_personnel_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_team public.incident_ad_hoc_teams%rowtype;
  v_name text;
  v_id uuid;
  v_inserted boolean := false;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if (p_unit_personnel_id is null and p_manual_personnel_id is null)
    or (p_unit_personnel_id is not null and p_manual_personnel_id is not null)
  then
    raise exception 'Exactly one member source is required';
  end if;

  select * into v_team
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id
    and incident_id = p_incident_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Active ad-hoc team not found';
  end if;

  if p_unit_personnel_id is not null then
    select first_name || ' ' || last_name into v_name
    from public.unit_personnel
    where id = p_unit_personnel_id
      and is_active;

    if v_name is null then
      raise exception 'Roster personnel record not found';
    end if;

    if not exists (
      select 1
      from public.event_personnel_status eps
      where eps.incident_id = p_incident_id
        and eps.personnel_id = p_unit_personnel_id
        and eps.attendance_status = 'present'
    ) then
      raise exception 'Personnel must be present to join an ad-hoc team' using errcode = '55000';
    end if;
  else
    select first_name || ' ' || last_name into v_name
    from public.incident_manual_personnel
    where id = p_manual_personnel_id
      and incident_id = p_incident_id
      and is_active;

    if v_name is null then
      raise exception 'Manual personnel record not found';
    end if;

    if not exists (
      select 1
      from public.incident_manual_personnel imp
      where imp.id = p_manual_personnel_id
        and imp.incident_id = p_incident_id
        and imp.is_active
        and imp.attendance_status = 'present'
    ) then
      raise exception 'Personnel must be present to join an ad-hoc team' using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
    from public.incident_ad_hoc_team_members m
    where m.incident_id = p_incident_id
      and m.is_active
      and m.ad_hoc_team_id <> p_ad_hoc_team_id
      and (
        (p_unit_personnel_id is not null and m.unit_personnel_id = p_unit_personnel_id)
        or (p_manual_personnel_id is not null and m.manual_personnel_id = p_manual_personnel_id)
      )
  ) then
    raise exception 'Personnel is already assigned to another active ad-hoc team' using errcode = '23505';
  end if;

  insert into public.incident_ad_hoc_team_members (
    incident_id, ad_hoc_team_id, unit_personnel_id, manual_personnel_id, notes, added_by
  )
  values (
    p_incident_id,
    p_ad_hoc_team_id,
    p_unit_personnel_id,
    p_manual_personnel_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_actor
  )
  on conflict do nothing
  returning id into v_id;

  v_inserted := found;

  if v_id is null then
    select id into v_id
    from public.incident_ad_hoc_team_members
    where ad_hoc_team_id = p_ad_hoc_team_id
      and is_active
      and (
        (p_unit_personnel_id is not null and unit_personnel_id = p_unit_personnel_id)
        or (p_manual_personnel_id is not null and manual_personnel_id = p_manual_personnel_id)
      )
    limit 1;

    -- A concurrent assignment to another team can win after the pre-check.
    -- Do not turn that conflict into a successful log entry with a null member.
    if v_id is null then
      raise exception 'Personnel is already assigned to another active ad-hoc team'
        using errcode = '23505';
    end if;
  end if;

  if v_inserted then
    perform public.log_incident_personnel_event_internal(
      p_incident_id,
      'incident_ad_hoc_team_member_added',
      'איש צוות נוסף לצוות אד־הוק',
      v_name || ' נוסף לצוות אד־הוק "' || v_team.name || '".',
      'normal',
      null,
      jsonb_build_object(
        'ad_hoc_team_id', p_ad_hoc_team_id,
        'member_id', v_id,
        'unit_personnel_id', p_unit_personnel_id,
        'manual_personnel_id', p_manual_personnel_id
      )
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.remove_incident_ad_hoc_team_member(
  p_incident_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member public.incident_ad_hoc_team_members%rowtype;
  v_team_name text;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  select * into v_member
  from public.incident_ad_hoc_team_members
  where id = p_member_id
    and incident_id = p_incident_id
    and is_active;

  if not found then
    raise exception 'Ad-hoc team member not found';
  end if;

  select name into v_team_name from public.incident_ad_hoc_teams where id = v_member.ad_hoc_team_id;

  update public.incident_ad_hoc_team_members
  set is_active = false,
      removed_by = v_actor,
      removed_at = now()
  where id = p_member_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_ad_hoc_team_member_removed',
    'איש צוות הוסר מצוות אד־הוק',
    'שיוך איש צוות הוסר מצוות אד־הוק "' || coalesce(v_team_name, '') || '".',
    'important',
    null,
    jsonb_build_object('member_id', p_member_id, 'ad_hoc_team_id', v_member.ad_hoc_team_id)
  );
end;
$$;

-- Preserve the signature used by the existing UI and equipment module while
-- narrowing management authorization. The equipment archive trigger remains in force.
create or replace function public.archive_incident_ad_hoc_team(
  p_incident_id uuid,
  p_ad_hoc_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_team public.incident_ad_hoc_teams%rowtype;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);

  select * into v_team
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Ad-hoc team not found';
  end if;

  -- Membership additions lock the same team row. Once this check succeeds,
  -- no new active member can be inserted before the archive update commits.
  if exists (
    select 1
    from public.incident_ad_hoc_team_members m
    where m.ad_hoc_team_id = p_ad_hoc_team_id
      and m.incident_id = p_incident_id
      and m.is_active
  ) then
    raise exception 'Cannot archive an ad-hoc team with active members. Remove all active members first'
      using errcode = '55000';
  end if;

  update public.incident_ad_hoc_teams
  set status = 'archived',
      archived_at = clock_timestamp(),
      archived_by = v_actor,
      updated_by = v_actor
  where id = p_ad_hoc_team_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_ad_hoc_team_archived',
    'צוות אד־הוק הועבר לארכיון',
    'צוות אד־הוק "' || v_team.name || '" הועבר לארכיון.',
    'important',
    null,
    jsonb_build_object('ad_hoc_team_id', p_ad_hoc_team_id)
  );
end;
$$;

-- Direct DML is not a supported management path. Existing RPC signatures are
-- retained and enforce the dedicated authorization helper above.
drop policy if exists incident_ad_hoc_teams_operator_mutate on public.incident_ad_hoc_teams;
drop policy if exists incident_ad_hoc_team_members_operator_mutate on public.incident_ad_hoc_team_members;

revoke all on public.incident_ad_hoc_teams, public.incident_ad_hoc_team_members
  from public, anon, authenticated;
grant select on public.incident_ad_hoc_teams, public.incident_ad_hoc_team_members to authenticated;

revoke all on function public.assert_manage_incident_ad_hoc_teams(uuid)
  from public, anon, authenticated;
revoke all on function public.create_incident_ad_hoc_team(uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.update_incident_ad_hoc_team(uuid, uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.add_incident_ad_hoc_team_member(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.remove_incident_ad_hoc_team_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.archive_incident_ad_hoc_team(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_incident_ad_hoc_team(uuid, text, text, uuid, text, text) to authenticated;
grant execute on function public.update_incident_ad_hoc_team(uuid, uuid, text, text, uuid, text, text) to authenticated;
grant execute on function public.add_incident_ad_hoc_team_member(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.remove_incident_ad_hoc_team_member(uuid, uuid) to authenticated;
grant execute on function public.archive_incident_ad_hoc_team(uuid, uuid) to authenticated;

commit;
