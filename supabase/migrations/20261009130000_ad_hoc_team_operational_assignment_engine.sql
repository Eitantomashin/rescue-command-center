-- Stage 10.1B.2A.1: operational ad-hoc team assignment engine.
-- Keeps organic affiliations immutable and records operational moves as membership history.

begin;

-- Direct client DML is still permitted by legacy attendance RLS policies.
-- A BEFORE UPDATE trigger runs after PostgreSQL has locked the attendance row.
-- It deliberately does not lock the incident: membership RPCs lock incident first
-- and then the same person/attendance row, so taking the incident lock here would
-- create an inverse row->incident lock order. If a membership RPC wins, this check
-- sees the committed active membership; if a direct attendance update wins, a later
-- add/transfer observes the non-present status and rejects the assignment.
create or replace function public.guard_ad_hoc_member_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.attendance_status = 'present' and new.attendance_status <> 'present' then
    if tg_table_name = 'event_personnel_status' then
      if exists (
        select 1
        from public.incident_ad_hoc_team_members m
        where m.incident_id = old.incident_id
          and m.unit_personnel_id = old.personnel_id
          and m.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה'
          using errcode = '55000';
      end if;
    elsif tg_table_name = 'incident_manual_personnel' then
      if exists (
        select 1
        from public.incident_ad_hoc_team_members m
        where m.incident_id = old.incident_id
          and m.manual_personnel_id = old.id
          and m.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה'
          using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_ad_hoc_member_attendance_change() from public, anon, authenticated;

drop trigger if exists event_personnel_status_ad_hoc_attendance_guard on public.event_personnel_status;
create trigger event_personnel_status_ad_hoc_attendance_guard
  before update of attendance_status on public.event_personnel_status
  for each row execute function public.guard_ad_hoc_member_attendance_change();

drop trigger if exists incident_manual_personnel_ad_hoc_attendance_guard on public.incident_manual_personnel;
create trigger incident_manual_personnel_ad_hoc_attendance_guard
  before update of attendance_status on public.incident_manual_personnel
  for each row execute function public.guard_ad_hoc_member_attendance_change();

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
  v_status text;
  v_id uuid;
  v_inserted boolean := false;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if (p_unit_personnel_id is null and p_manual_personnel_id is null)
    or (p_unit_personnel_id is not null and p_manual_personnel_id is not null)
  then
    raise exception 'יש לבחור איש צוות אחד בלבד' using errcode = '22023';
  end if;

  -- Every operational membership mutation serializes on its incident first.
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);

  if p_unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name) into v_name
    from public.unit_personnel
    where id = p_unit_personnel_id and is_active
    for update;

    if v_name is null then
      raise exception 'רשומת איש הצוות אינה קיימת או אינה פעילה' using errcode = 'P0002';
    end if;

    select attendance_status into v_status
    from public.event_personnel_status
    where incident_id = p_incident_id and personnel_id = p_unit_personnel_id
    for update;
  else
    select concat_ws(' ', first_name, last_name), attendance_status into v_name, v_status
    from public.incident_manual_personnel
    where id = p_manual_personnel_id and incident_id = p_incident_id and is_active
    for update;

    if v_name is null then
      raise exception 'רשומת איש הצוות הידני אינה קיימת או אינה פעילה' using errcode = 'P0002';
    end if;
  end if;

  if v_status is distinct from 'present' then
    raise exception 'ניתן לשייך לצוות אד־הוק רק איש צוות שנוכח באירוע' using errcode = '55000';
  end if;

  select * into v_team
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id and incident_id = p_incident_id and status = 'active'
  for update;

  if not found then
    raise exception 'צוות האד־הוק הפעיל לא נמצא באירוע' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.incident_ad_hoc_team_members m
    where m.incident_id = p_incident_id and m.is_active and m.ad_hoc_team_id <> p_ad_hoc_team_id
      and ((p_unit_personnel_id is not null and m.unit_personnel_id = p_unit_personnel_id)
        or (p_manual_personnel_id is not null and m.manual_personnel_id = p_manual_personnel_id))
  ) then
    raise exception 'איש הצוות כבר משויך לצוות אד־הוק פעיל אחר' using errcode = '23505';
  end if;

  insert into public.incident_ad_hoc_team_members (
    incident_id, ad_hoc_team_id, unit_personnel_id, manual_personnel_id, notes, added_by
  ) values (
    p_incident_id, p_ad_hoc_team_id, p_unit_personnel_id, p_manual_personnel_id,
    nullif(btrim(coalesce(p_notes, '')), ''), v_actor
  )
  on conflict do nothing
  returning id into v_id;

  v_inserted := found;
  if v_id is null then
    select id into v_id
    from public.incident_ad_hoc_team_members
    where ad_hoc_team_id = p_ad_hoc_team_id and incident_id = p_incident_id and is_active
      and ((p_unit_personnel_id is not null and unit_personnel_id = p_unit_personnel_id)
        or (p_manual_personnel_id is not null and manual_personnel_id = p_manual_personnel_id))
    for update;

    if v_id is null then
      raise exception 'איש הצוות כבר משויך לצוות אד־הוק פעיל אחר' using errcode = '23505';
    end if;
  end if;

  if v_inserted then
    perform public.log_incident_personnel_event_internal(
      p_incident_id, 'incident_ad_hoc_team_member_added', 'איש צוות נוסף לצוות אד־הוק',
      v_name || ' נוסף לצוות אד־הוק "' || v_team.name || '".', 'normal', null,
      jsonb_build_object('ad_hoc_team_id', p_ad_hoc_team_id, 'member_id', v_id,
        'unit_personnel_id', p_unit_personnel_id, 'manual_personnel_id', p_manual_personnel_id,
        'operational_role', 'member', 'actor_id', v_actor)
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.set_incident_ad_hoc_team_member_role(
  p_incident_id uuid,
  p_member_id uuid,
  p_operational_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member public.incident_ad_hoc_team_members%rowtype;
  v_team public.incident_ad_hoc_teams%rowtype;
  v_role text := nullif(btrim(coalesce(p_operational_role, '')), '');
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if v_role not in ('member', 'commander', 'deputy') then
    raise exception 'תפקיד מבצעי לא תקין' using errcode = '22023';
  end if;
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);

  select * into v_member from public.incident_ad_hoc_team_members
  where id = p_member_id and incident_id = p_incident_id and is_active for update;
  if not found then
    raise exception 'חברות פעילה בצוות אד־הוק לא נמצאה' using errcode = 'P0002';
  end if;

  select * into v_team from public.incident_ad_hoc_teams
  where id = v_member.ad_hoc_team_id and incident_id = p_incident_id and status = 'active' for update;
  if not found then
    raise exception 'צוות האד־הוק הפעיל לא נמצא באירוע' using errcode = 'P0002';
  end if;

  if v_member.unit_personnel_id is not null then
    perform 1 from public.unit_personnel
    where id = v_member.unit_personnel_id and is_active for update;
    if not found then raise exception 'רשומת איש הצוות אינה קיימת או אינה פעילה' using errcode = 'P0002'; end if;
    perform 1 from public.event_personnel_status
    where incident_id = p_incident_id and personnel_id = v_member.unit_personnel_id
      and attendance_status = 'present' for update;
  else
    perform 1 from public.incident_manual_personnel
    where id = v_member.manual_personnel_id and incident_id = p_incident_id
      and is_active and attendance_status = 'present' for update;
  end if;
  if not found then
    raise exception 'ניתן לשנות תפקיד מבצעי רק לאיש צוות פעיל שנוכח באירוע' using errcode = '55000';
  end if;

  if v_member.operational_role = v_role then return; end if;

  if v_role in ('commander', 'deputy') and exists (
    select 1 from public.incident_ad_hoc_team_members m
    where m.ad_hoc_team_id = v_member.ad_hoc_team_id and m.is_active
      and m.operational_role = v_role and m.id <> p_member_id
  ) then
    raise exception 'לצוות כבר מוגדר % פעיל', case when v_role = 'commander' then 'מפקד' else 'סגן מפקד' end
      using errcode = '23505';
  end if;

  update public.incident_ad_hoc_team_members set operational_role = v_role
  where id = p_member_id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_ad_hoc_member_role_changed', 'תפקיד מבצעי בצוות אד־הוק עודכן',
    'התפקיד המבצעי בצוות אד־הוק "' || v_team.name || '" עודכן.', 'normal', null,
    jsonb_build_object('member_id', p_member_id, 'ad_hoc_team_id', v_member.ad_hoc_team_id,
      'old_operational_role', v_member.operational_role, 'new_operational_role', v_role, 'actor_id', v_actor)
  );
end;
$$;

create or replace function public.transfer_incident_ad_hoc_team_member(
  p_incident_id uuid,
  p_member_id uuid,
  p_target_ad_hoc_team_id uuid,
  p_target_operational_role text default 'member',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source public.incident_ad_hoc_team_members%rowtype;
  v_target public.incident_ad_hoc_teams%rowtype;
  v_source_team public.incident_ad_hoc_teams%rowtype;
  v_target_member public.incident_ad_hoc_team_members%rowtype;
  v_name text;
  v_status text;
  v_role text := nullif(btrim(coalesce(p_target_operational_role, '')), '');
  v_new_id uuid;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if v_role not in ('member', 'commander', 'deputy') then
    raise exception 'תפקיד מבצעי לא תקין' using errcode = '22023';
  end if;
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);

  select * into v_source from public.incident_ad_hoc_team_members
  where id = p_member_id and incident_id = p_incident_id for update;
  if not found then
    raise exception 'חברות בצוות אד־הוק לא נמצאה' using errcode = 'P0002';
  end if;

  -- Lock both teams in stable UUID order to avoid transfer deadlocks.
  perform 1 from public.incident_ad_hoc_teams
  where incident_id = p_incident_id and id in (v_source.ad_hoc_team_id, p_target_ad_hoc_team_id)
  order by id for update;

  select * into v_target from public.incident_ad_hoc_teams
  where id = p_target_ad_hoc_team_id and incident_id = p_incident_id and status = 'active';
  if not found then
    raise exception 'צוות היעד הפעיל לא נמצא באירוע' using errcode = 'P0002';
  end if;
  select * into v_source_team from public.incident_ad_hoc_teams
  where id = v_source.ad_hoc_team_id and incident_id = p_incident_id;

  if not v_source.is_active then
    select * into v_target_member from public.incident_ad_hoc_team_members
    where incident_id = p_incident_id and ad_hoc_team_id = p_target_ad_hoc_team_id and is_active
      and ((v_source.unit_personnel_id is not null and unit_personnel_id = v_source.unit_personnel_id)
        or (v_source.manual_personnel_id is not null and manual_personnel_id = v_source.manual_personnel_id))
    for update;
    if found and v_target_member.operational_role = v_role then return v_target_member.id; end if;
    if found then raise exception 'איש הצוות כבר הועבר ליעד עם תפקיד מבצעי שונה' using errcode = '23505'; end if;
    raise exception 'חברות המקור אינה פעילה' using errcode = 'P0002';
  end if;

  if v_source.ad_hoc_team_id = p_target_ad_hoc_team_id then
    if v_source.operational_role = v_role then return v_source.id; end if;
    raise exception 'איש הצוות כבר משויך לצוות זה עם תפקיד מבצעי שונה' using errcode = '23505';
  end if;

  if v_source.unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name) into v_name from public.unit_personnel
    where id = v_source.unit_personnel_id and is_active for update;
    select attendance_status into v_status from public.event_personnel_status
    where incident_id = p_incident_id and personnel_id = v_source.unit_personnel_id for update;
  else
    select concat_ws(' ', first_name, last_name), attendance_status into v_name, v_status
    from public.incident_manual_personnel
    where id = v_source.manual_personnel_id and incident_id = p_incident_id and is_active for update;
  end if;
  if v_name is null or v_status is distinct from 'present' then
    raise exception 'ניתן להעביר רק איש צוות פעיל שנוכח באירוע' using errcode = '55000';
  end if;

  if v_role in ('commander', 'deputy') and exists (
    select 1 from public.incident_ad_hoc_team_members m
    where m.ad_hoc_team_id = p_target_ad_hoc_team_id and m.is_active and m.operational_role = v_role
  ) then
    raise exception 'לצוות היעד כבר מוגדר % פעיל', case when v_role = 'commander' then 'מפקד' else 'סגן מפקד' end
      using errcode = '23505';
  end if;

  update public.incident_ad_hoc_team_members
  set is_active = false, removed_by = v_actor, removed_at = clock_timestamp()
  where id = p_member_id;

  insert into public.incident_ad_hoc_team_members(
    incident_id, ad_hoc_team_id, unit_personnel_id, manual_personnel_id, operational_role, notes, added_by
  ) values (
    p_incident_id, p_target_ad_hoc_team_id, v_source.unit_personnel_id, v_source.manual_personnel_id,
    v_role, nullif(btrim(coalesce(p_notes, '')), ''), v_actor
  ) returning id into v_new_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_ad_hoc_member_transferred', 'איש צוות הועבר בין צוותי אד־הוק',
    v_name || ' הועבר מצוות אד־הוק "' || coalesce(v_source_team.name, '') || '" לצוות אד־הוק "' || v_target.name || '".',
    'important', null,
    jsonb_build_object('source_member_id', p_member_id, 'target_member_id', v_new_id,
      'source_ad_hoc_team_id', v_source.ad_hoc_team_id, 'target_ad_hoc_team_id', p_target_ad_hoc_team_id,
      'unit_personnel_id', v_source.unit_personnel_id, 'manual_personnel_id', v_source.manual_personnel_id,
      'source_operational_role', v_source.operational_role, 'target_operational_role', v_role, 'actor_id', v_actor)
  );
  return v_new_id;
end;
$$;

create or replace function public.return_incident_ad_hoc_team_member(
  p_incident_id uuid,
  p_member_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member public.incident_ad_hoc_team_members%rowtype;
  v_team public.incident_ad_hoc_teams%rowtype;
  v_name text;
  v_destination text;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
  select * into v_member from public.incident_ad_hoc_team_members
  where id = p_member_id and incident_id = p_incident_id for update;
  if not found then raise exception 'חברות בצוות אד־הוק לא נמצאה' using errcode = 'P0002'; end if;
  if not v_member.is_active then return; end if;

  select * into v_team from public.incident_ad_hoc_teams
  where id = v_member.ad_hoc_team_id and incident_id = p_incident_id for update;
  if v_member.unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name) into v_name
    from public.unit_personnel where id = v_member.unit_personnel_id for update;
    -- Unit personnel retain their existing organic affiliation; its display is a read concern.
    v_destination := 'הצוות האורגני';
  else
    select concat_ws(' ', first_name, last_name) into v_name
    from public.incident_manual_personnel
    where id = v_member.manual_personnel_id and incident_id = p_incident_id for update;
    v_destination := 'מאגר כוח האדם הכלל־אירועי';
  end if;

  update public.incident_ad_hoc_team_members
  set is_active = false, removed_by = v_actor, removed_at = clock_timestamp()
  where id = p_member_id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_ad_hoc_member_returned', 'איש צוות הוחזר מצוות אד־הוק',
    coalesce(v_name, 'איש צוות') || ' הוחזר מצוות אד־הוק "' || coalesce(v_team.name, '') || '" אל ' || v_destination || '.',
    'important', null,
    jsonb_build_object('member_id', p_member_id, 'ad_hoc_team_id', v_member.ad_hoc_team_id,
      'unit_personnel_id', v_member.unit_personnel_id, 'manual_personnel_id', v_member.manual_personnel_id,
      'operational_role', v_member.operational_role, 'notes', nullif(btrim(coalesce(p_notes, '')), ''), 'actor_id', v_actor)
  );
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
  v_team public.incident_ad_hoc_teams%rowtype;
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  -- Preserve the legacy RPC and event type while adopting idempotent return semantics.
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
  select * into v_member from public.incident_ad_hoc_team_members
  where id = p_member_id and incident_id = p_incident_id for update;
  if not found then raise exception 'חברות בצוות אד־הוק לא נמצאה' using errcode = 'P0002'; end if;
  if not v_member.is_active then return; end if;
  select * into v_team from public.incident_ad_hoc_teams
  where id = v_member.ad_hoc_team_id and incident_id = p_incident_id for update;
  update public.incident_ad_hoc_team_members
  set is_active = false, removed_by = v_actor, removed_at = clock_timestamp()
  where id = p_member_id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_ad_hoc_team_member_removed', 'איש צוות הוסר מצוות אד־הוק',
    'שיוך איש צוות הוסר מצוות אד־הוק "' || coalesce(v_team.name, '') || '".', 'important', null,
    jsonb_build_object('member_id', p_member_id, 'ad_hoc_team_id', v_member.ad_hoc_team_id,
      'unit_personnel_id', v_member.unit_personnel_id, 'manual_personnel_id', v_member.manual_personnel_id,
      'operational_role', v_member.operational_role, 'actor_id', v_actor)
  );
end;
$$;

create or replace function public.set_event_personnel_status(
  p_incident_id uuid,
  p_personnel_id uuid,
  p_attendance_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person public.unit_personnel%rowtype;
  v_old_status text;
begin
  perform public.assert_incident_writable(p_incident_id, 'set_event_personnel_status');
  if p_attendance_status not in ('present', 'en_route', 'unavailable', 'inactive') then
    raise exception 'סטטוס נוכחות לא תקין' using errcode = '22023';
  end if;
  perform 1 from public.incidents where id = p_incident_id for update;
  select * into v_person from public.unit_personnel where id = p_personnel_id for update;
  if not found then raise exception 'רשומת איש צוות אינה קיימת' using errcode = 'P0002'; end if;
  select attendance_status into v_old_status from public.event_personnel_status
  where incident_id = p_incident_id and personnel_id = p_personnel_id for update;
  if v_old_status = 'present' and p_attendance_status <> 'present' and exists (
    select 1 from public.incident_ad_hoc_team_members m
    where m.incident_id = p_incident_id and m.unit_personnel_id = p_personnel_id and m.is_active
  ) then
    raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה' using errcode = '55000';
  end if;
  insert into public.event_personnel_status(incident_id, personnel_id, attendance_status, updated_by, updated_at)
  values(p_incident_id, p_personnel_id, p_attendance_status, public.current_actor_id(), now())
  on conflict (incident_id, personnel_id) do update set attendance_status = excluded.attendance_status,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.create_event_log(
    p_incident_id, 'event_personnel_status_changed', 'עדכון סטטוס כח אדם',
    v_person.first_name || ' ' || v_person.last_name || ': ' || coalesce(v_old_status, 'לא הוגדר') || ' → ' || p_attendance_status,
    'operational', 'normal', now(), null, null, null, null, null, 'מערכת', null,
    jsonb_build_object('personnel_id', p_personnel_id, 'personnel_name', v_person.first_name || ' ' || v_person.last_name,
      'old_status', v_old_status, 'new_status', p_attendance_status, 'role', v_person.role, 'department', v_person.department)
  );
end;
$$;

create or replace function public.set_incident_manual_personnel_status(
  p_incident_id uuid,
  p_manual_personnel_id uuid,
  p_attendance_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person public.incident_manual_personnel%rowtype;
  v_old_status text;
begin
  perform public.assert_edit_personnel(p_incident_id);
  if p_attendance_status not in ('present', 'en_route', 'unavailable', 'inactive') then
    raise exception 'סטטוס נוכחות לא תקין' using errcode = '22023';
  end if;
  perform 1 from public.incidents where id = p_incident_id for update;
  select * into v_person from public.incident_manual_personnel
  where id = p_manual_personnel_id and incident_id = p_incident_id and is_active for update;
  if not found then raise exception 'רשומת איש צוות ידני אינה קיימת' using errcode = 'P0002'; end if;
  v_old_status := v_person.attendance_status;
  if v_old_status = 'present' and p_attendance_status <> 'present' and exists (
    select 1 from public.incident_ad_hoc_team_members m
    where m.incident_id = p_incident_id and m.manual_personnel_id = p_manual_personnel_id and m.is_active
  ) then
    raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה' using errcode = '55000';
  end if;
  update public.incident_manual_personnel set attendance_status = p_attendance_status,
    attendance_updated_by = public.current_actor_id(), attendance_updated_at = now(), updated_by = public.current_actor_id()
  where id = p_manual_personnel_id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_manual_personnel_status_changed', 'עודכן סטטוס איש צוות ידני',
    v_person.first_name || ' ' || v_person.last_name || ': ' || v_old_status || ' → ' || p_attendance_status,
    'normal', v_person.organic_team_id,
    jsonb_build_object('manual_personnel_id', p_manual_personnel_id, 'old_status', v_old_status, 'new_status', p_attendance_status)
  );
end;
$$;

revoke all on function public.set_incident_ad_hoc_team_member_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.transfer_incident_ad_hoc_team_member(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.return_incident_ad_hoc_team_member(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_incident_ad_hoc_team_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_incident_ad_hoc_team_member(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.return_incident_ad_hoc_team_member(uuid, uuid, text) to authenticated;

commit;
