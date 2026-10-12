-- Stage 10.1C.1: temporary operational reinforcement between rescue teams 1–4.
-- Organic affiliation remains on unit_personnel.department / incident_manual_personnel.organic_team_id.

begin;

alter table public.teams
  add constraint teams_id_incident_key unique (id, incident_id);

create table public.incident_organic_team_reinforcements (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  unit_personnel_id uuid references public.unit_personnel(id),
  manual_personnel_id uuid,
  source_team_id uuid not null,
  source_team_number integer not null check (source_team_number between 1 and 4),
  destination_team_id uuid not null,
  destination_team_number integer not null check (destination_team_number between 1 and 4),
  notes text,
  is_active boolean not null default true,
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid references public.profiles(id),
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (unit_personnel_id is not null and manual_personnel_id is null)
    or (unit_personnel_id is null and manual_personnel_id is not null)
  ),
  check (source_team_id <> destination_team_id),
  foreign key (source_team_id, incident_id)
    references public.teams(id, incident_id),
  foreign key (destination_team_id, incident_id)
    references public.teams(id, incident_id),
  foreign key (manual_personnel_id, incident_id)
    references public.incident_manual_personnel(id, incident_id)
    on delete cascade
);

create unique index incident_organic_reinforcements_unit_active_uniq
  on public.incident_organic_team_reinforcements (incident_id, unit_personnel_id)
  where is_active and unit_personnel_id is not null;

create unique index incident_organic_reinforcements_manual_active_uniq
  on public.incident_organic_team_reinforcements (incident_id, manual_personnel_id)
  where is_active and manual_personnel_id is not null;

create index incident_organic_reinforcements_destination_active_idx
  on public.incident_organic_team_reinforcements (incident_id, destination_team_id)
  where is_active;

alter table public.incident_organic_team_reinforcements enable row level security;

create policy incident_organic_team_reinforcements_member_select
  on public.incident_organic_team_reinforcements for select
  using (public.can_read_incident(incident_id));

revoke all on public.incident_organic_team_reinforcements from public, anon, authenticated;
grant select on public.incident_organic_team_reinforcements to authenticated;

create trigger incident_organic_team_reinforcements_set_updated_at
  before update on public.incident_organic_team_reinforcements
  for each row execute function public.set_updated_at();

-- This lock key serializes cross-table assignment checks for one person.
-- It supplements the incident-first row locking used by the management RPCs,
-- and also protects privileged direct DML from creating a conflicting active row.
create or replace function public.guard_exclusive_operational_team_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person_key text;
begin
  if not new.is_active then
    return new;
  end if;

  v_person_key := coalesce(new.unit_personnel_id::text, new.manual_personnel_id::text);
  perform pg_advisory_xact_lock(hashtextextended('incident-operational-assignment:' || new.incident_id::text || ':' || v_person_key, 0));

  if tg_table_name = 'incident_ad_hoc_team_members' then
    if exists (
      select 1
      from public.incident_organic_team_reinforcements r
      where r.incident_id = new.incident_id
        and r.is_active
        and (
          (new.unit_personnel_id is not null and r.unit_personnel_id = new.unit_personnel_id)
          or (new.manual_personnel_id is not null and r.manual_personnel_id = new.manual_personnel_id)
        )
    ) then
      raise exception 'לא ניתן לשייך איש צוות לצוות אד־הוק בזמן תגבור אורגני פעיל'
        using errcode = '23505';
    end if;
  else
    if exists (
      select 1
      from public.incident_ad_hoc_team_members m
      where m.incident_id = new.incident_id
        and m.is_active
        and (
          (new.unit_personnel_id is not null and m.unit_personnel_id = new.unit_personnel_id)
          or (new.manual_personnel_id is not null and m.manual_personnel_id = new.manual_personnel_id)
        )
    ) then
      raise exception 'לא ניתן לתגבר איש צוות המשויך לצוות אד־הוק פעיל'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_exclusive_operational_team_assignment() from public, anon, authenticated;

create trigger incident_ad_hoc_team_members_exclusive_operational_assignment
  before insert or update of incident_id, unit_personnel_id, manual_personnel_id, is_active
  on public.incident_ad_hoc_team_members
  for each row execute function public.guard_exclusive_operational_team_assignment();

create trigger incident_organic_reinforcements_exclusive_operational_assignment
  before insert or update of incident_id, unit_personnel_id, manual_personnel_id, is_active
  on public.incident_organic_team_reinforcements
  for each row execute function public.guard_exclusive_operational_team_assignment();

-- Team numbers are retained as historical snapshots. Validate them only when
-- a reinforcement is created or its team snapshot is deliberately changed;
-- later team edits must not rewrite completed operational history.
create or replace function public.validate_organic_team_reinforcement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source_team_number integer;
  v_destination_team_number integer;
begin
  select t.team_number into v_source_team_number
  from public.teams t
  where t.id = new.source_team_id and t.incident_id = new.incident_id
  for key share;

  if not found or v_source_team_number is distinct from new.source_team_number then
    raise exception 'מספר צוות המקור אינו תואם לצוות המקור באירוע'
      using errcode = '23514';
  end if;

  select t.team_number into v_destination_team_number
  from public.teams t
  where t.id = new.destination_team_id and t.incident_id = new.incident_id
  for key share;

  if not found or v_destination_team_number is distinct from new.destination_team_number then
    raise exception 'מספר צוות היעד אינו תואם לצוות היעד באירוע'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_organic_team_reinforcement_snapshot() from public, anon, authenticated;

create trigger incident_organic_reinforcements_validate_team_snapshot
  before insert or update of incident_id, source_team_id, source_team_number,
    destination_team_id, destination_team_number
  on public.incident_organic_team_reinforcements
  for each row execute function public.validate_organic_team_reinforcement_snapshot();

-- Extend the existing attendance guard without changing any attendance semantics.
-- A present person remains present until the active reinforcement is explicitly returned.
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
        select 1 from public.incident_ad_hoc_team_members m
        where m.incident_id = old.incident_id and m.unit_personnel_id = old.personnel_id and m.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה'
          using errcode = '55000';
      elsif exists (
        select 1 from public.incident_organic_team_reinforcements r
        where r.incident_id = old.incident_id and r.unit_personnel_id = old.personnel_id and r.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות בתגבור אורגני פעיל. יש להחזירו תחילה'
          using errcode = '55000';
      end if;
    elsif tg_table_name = 'incident_manual_personnel' then
      if exists (
        select 1 from public.incident_ad_hoc_team_members m
        where m.incident_id = old.incident_id and m.manual_personnel_id = old.id and m.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות המשויך לצוות אד־הוק פעיל. יש להחזירו או להעבירו תחילה'
          using errcode = '55000';
      elsif exists (
        select 1 from public.incident_organic_team_reinforcements r
        where r.incident_id = old.incident_id and r.manual_personnel_id = old.id and r.is_active
      ) then
        raise exception 'לא ניתן לשנות נוכחות של איש צוות בתגבור אורגני פעיל. יש להחזירו תחילה'
          using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.assert_manage_incident_organic_team_reinforcements(p_incident_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.assert_manage_incident_ad_hoc_teams(p_incident_id);
begin
  if not exists (
    select 1 from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
      and not i.is_closed
      and i.lifecycle_status = 'active'
  ) then
    raise exception 'תגבור בין צוותים אורגניים מותר רק באירוע פעיל' using errcode = '55000';
  end if;
  return v_actor;
end;
$$;

create or replace function public.assign_incident_organic_team_reinforcement(
  p_incident_id uuid,
  p_target_team_id uuid,
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
  v_actor uuid;
  v_name text;
  v_department text;
  v_attendance text;
  v_manual_organic_team_id uuid;
  v_source_team public.teams%rowtype;
  v_target_team public.teams%rowtype;
  v_existing public.incident_organic_team_reinforcements%rowtype;
  v_source_team_number integer;
  v_source_team_count integer;
  v_id uuid;
begin
  if (p_unit_personnel_id is null and p_manual_personnel_id is null)
    or (p_unit_personnel_id is not null and p_manual_personnel_id is not null) then
    raise exception 'יש לבחור איש צוות אחד בלבד' using errcode = '22023';
  end if;

  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_organic_team_reinforcements(p_incident_id);

  select * into v_target_team from public.teams
  where id = p_target_team_id and incident_id = p_incident_id and is_active and team_number between 1 and 4
  for update;
  if not found then
    raise exception 'צוות היעד אינו צוות חילוץ פעיל 1–4 באירוע' using errcode = 'P0002';
  end if;

  if p_unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name), department into v_name, v_department
    from public.unit_personnel where id = p_unit_personnel_id and is_active for update;
    if not found then raise exception 'רשומת איש הצוות אינה קיימת או אינה פעילה' using errcode = 'P0002'; end if;
    select attendance_status into v_attendance from public.event_personnel_status
    where incident_id = p_incident_id and personnel_id = p_unit_personnel_id for update;
    v_source_team_number := case v_department
      when 'team_1' then 1 when 'team_2' then 2 when 'team_3' then 3 when 'team_4' then 4 else null end;
  else
    select concat_ws(' ', first_name, last_name), organic_team_id, attendance_status
    into v_name, v_manual_organic_team_id, v_attendance
    from public.incident_manual_personnel
    where id = p_manual_personnel_id and incident_id = p_incident_id and is_active for update;
    if not found then raise exception 'רשומת איש הצוות הידני אינה קיימת או אינה פעילה' using errcode = 'P0002'; end if;
  end if;

  if v_attendance is distinct from 'present' then
    raise exception 'ניתן לתגבר רק איש צוות פעיל שנוכח באירוע' using errcode = '55000';
  end if;

  if p_unit_personnel_id is not null then
    if v_source_team_number is null then
      raise exception 'לאיש הצוות אין שיוך אורגני לצוותי חילוץ 1–4' using errcode = '22023';
    end if;
    select count(*) into v_source_team_count from public.teams
    where incident_id = p_incident_id and team_number = v_source_team_number;
    if v_source_team_count <> 1 then
      raise exception 'הצוות האורגני של איש הצוות אינו מוגדר באופן חד־משמעי באירוע' using errcode = 'P0002';
    end if;
    select * into v_source_team from public.teams
    where incident_id = p_incident_id and team_number = v_source_team_number for update;
  else
    select * into v_source_team from public.teams
    where id = v_manual_organic_team_id and incident_id = p_incident_id and team_number between 1 and 4 for update;
  end if;
  if not found then raise exception 'הצוות האורגני של איש הצוות אינו מוגדר באירוע' using errcode = 'P0002'; end if;
  v_source_team_number := v_source_team.team_number;

  if v_source_team.id = v_target_team.id then
    raise exception 'לא ניתן לתגבר איש צוות אל הצוות האורגני שלו' using errcode = '22023';
  end if;

  select * into v_existing from public.incident_organic_team_reinforcements
  where incident_id = p_incident_id and is_active
    and ((p_unit_personnel_id is not null and unit_personnel_id = p_unit_personnel_id)
      or (p_manual_personnel_id is not null and manual_personnel_id = p_manual_personnel_id))
  for update;
  if found then
    if v_existing.destination_team_id = p_target_team_id then return v_existing.id; end if;
    raise exception 'לאיש הצוות כבר קיים תגבור אורגני פעיל' using errcode = '23505';
  end if;

  insert into public.incident_organic_team_reinforcements(
    incident_id, unit_personnel_id, manual_personnel_id, source_team_id, source_team_number,
    destination_team_id, destination_team_number, notes, assigned_by
  ) values (
    p_incident_id, p_unit_personnel_id, p_manual_personnel_id, v_source_team.id, v_source_team_number,
    v_target_team.id, v_target_team.team_number, nullif(btrim(coalesce(p_notes, '')), ''), v_actor
  ) returning id into v_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_organic_team_reinforcement_assigned', 'איש צוות תוגבר לצוות אורגני',
    v_name || ' תוגבר מצוות ' || v_source_team_number || ' לצוות ' || v_target_team.team_number || '.',
    'important', v_target_team.id,
    jsonb_build_object('reinforcement_id', v_id, 'unit_personnel_id', p_unit_personnel_id,
      'manual_personnel_id', p_manual_personnel_id, 'source_team_id', v_source_team.id,
      'destination_team_id', v_target_team.id, 'actor_id', v_actor)
  );
  return v_id;
end;
$$;

create or replace function public.transfer_incident_organic_team_reinforcement(
  p_incident_id uuid,
  p_reinforcement_id uuid,
  p_target_team_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_source public.incident_organic_team_reinforcements%rowtype;
  v_target public.teams%rowtype;
  v_name text;
  v_attendance text;
  v_existing public.incident_organic_team_reinforcements%rowtype;
  v_new_id uuid;
begin
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_organic_team_reinforcements(p_incident_id);
  select * into v_source from public.incident_organic_team_reinforcements
  where id = p_reinforcement_id and incident_id = p_incident_id for update;
  if not found then raise exception 'תגבור אורגני לא נמצא' using errcode = 'P0002'; end if;

  perform 1 from public.teams
  where incident_id = p_incident_id and id in (v_source.destination_team_id, p_target_team_id)
  order by id for update;
  select * into v_target from public.teams
  where id = p_target_team_id and incident_id = p_incident_id and is_active and team_number between 1 and 4;
  if not found then raise exception 'צוות היעד אינו צוות חילוץ פעיל 1–4 באירוע' using errcode = 'P0002'; end if;

  if not v_source.is_active then
    select * into v_existing from public.incident_organic_team_reinforcements
    where incident_id = p_incident_id and destination_team_id = p_target_team_id and is_active
      and ((v_source.unit_personnel_id is not null and unit_personnel_id = v_source.unit_personnel_id)
        or (v_source.manual_personnel_id is not null and manual_personnel_id = v_source.manual_personnel_id))
    for update;
    if found then return v_existing.id; end if;
    raise exception 'תגבור המקור אינו פעיל' using errcode = 'P0002';
  end if;
  if v_source.destination_team_id = p_target_team_id then return v_source.id; end if;
  if v_source.source_team_id = p_target_team_id then
    raise exception 'יש להשתמש בפעולת החזרה לצוות המקור' using errcode = '22023';
  end if;

  if v_source.unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name) into v_name from public.unit_personnel
    where id = v_source.unit_personnel_id and is_active for update;
    select attendance_status into v_attendance from public.event_personnel_status
    where incident_id = p_incident_id and personnel_id = v_source.unit_personnel_id for update;
  else
    select concat_ws(' ', first_name, last_name), attendance_status into v_name, v_attendance
    from public.incident_manual_personnel
    where id = v_source.manual_personnel_id and incident_id = p_incident_id and is_active for update;
  end if;
  if v_name is null or v_attendance is distinct from 'present' then
    raise exception 'ניתן להעביר תגבור רק עבור איש צוות פעיל שנוכח באירוע' using errcode = '55000';
  end if;

  update public.incident_organic_team_reinforcements
  set is_active = false, released_at = clock_timestamp(), released_by = v_actor
  where id = v_source.id;
  insert into public.incident_organic_team_reinforcements(
    incident_id, unit_personnel_id, manual_personnel_id, source_team_id, source_team_number,
    destination_team_id, destination_team_number, notes, assigned_by
  ) values (
    p_incident_id, v_source.unit_personnel_id, v_source.manual_personnel_id,
    v_source.source_team_id, v_source.source_team_number, v_target.id, v_target.team_number,
    nullif(btrim(coalesce(p_notes, '')), ''), v_actor
  ) returning id into v_new_id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_organic_team_reinforcement_transferred', 'תגבור אורגני הועבר בין צוותים',
    v_name || ' הועבר מתגבור בצוות ' || v_source.destination_team_number || ' לתגבור בצוות ' || v_target.team_number || '.',
    'important', v_target.id,
    jsonb_build_object('source_reinforcement_id', v_source.id, 'target_reinforcement_id', v_new_id,
      'unit_personnel_id', v_source.unit_personnel_id, 'manual_personnel_id', v_source.manual_personnel_id,
      'source_team_id', v_source.destination_team_id, 'destination_team_id', v_target.id, 'actor_id', v_actor)
  );
  return v_new_id;
end;
$$;

create or replace function public.return_incident_organic_team_reinforcement(
  p_incident_id uuid,
  p_reinforcement_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_reinforcement public.incident_organic_team_reinforcements%rowtype;
  v_name text;
begin
  perform 1 from public.incidents where id = p_incident_id for update;
  v_actor := public.assert_manage_incident_organic_team_reinforcements(p_incident_id);
  select * into v_reinforcement from public.incident_organic_team_reinforcements
  where id = p_reinforcement_id and incident_id = p_incident_id for update;
  if not found then raise exception 'תגבור אורגני לא נמצא' using errcode = 'P0002'; end if;
  if not v_reinforcement.is_active then return; end if;

  if v_reinforcement.unit_personnel_id is not null then
    select concat_ws(' ', first_name, last_name) into v_name from public.unit_personnel
    where id = v_reinforcement.unit_personnel_id for update;
  else
    select concat_ws(' ', first_name, last_name) into v_name from public.incident_manual_personnel
    where id = v_reinforcement.manual_personnel_id and incident_id = p_incident_id for update;
  end if;
  update public.incident_organic_team_reinforcements
  set is_active = false, released_at = clock_timestamp(), released_by = v_actor
  where id = v_reinforcement.id;
  perform public.log_incident_personnel_event_internal(
    p_incident_id, 'incident_organic_team_reinforcement_returned', 'איש צוות הוחזר לצוות האורגני',
    coalesce(v_name, 'איש צוות') || ' הוחזר מצוות ' || v_reinforcement.destination_team_number || ' לצוות ' || v_reinforcement.source_team_number || '.',
    'important', v_reinforcement.source_team_id,
    jsonb_build_object('reinforcement_id', v_reinforcement.id, 'unit_personnel_id', v_reinforcement.unit_personnel_id,
      'manual_personnel_id', v_reinforcement.manual_personnel_id, 'source_team_id', v_reinforcement.source_team_id,
      'destination_team_id', v_reinforcement.destination_team_id,
      'notes', nullif(btrim(coalesce(p_notes, '')), ''), 'actor_id', v_actor)
  );
end;
$$;

revoke all on function public.assert_manage_incident_organic_team_reinforcements(uuid) from public, anon, authenticated;
revoke all on function public.assign_incident_organic_team_reinforcement(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.transfer_incident_organic_team_reinforcement(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.return_incident_organic_team_reinforcement(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assign_incident_organic_team_reinforcement(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.transfer_incident_organic_team_reinforcement(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.return_incident_organic_team_reinforcement(uuid, uuid, text) to authenticated;

commit;
