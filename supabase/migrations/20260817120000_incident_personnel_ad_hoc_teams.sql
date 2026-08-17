-- Phase 1: incident-scoped manual personnel and ad-hoc teams.
-- This keeps the permanent unit_personnel roster immutable for incident-only additions.

create table if not exists public.incident_manual_personnel (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  mobile_phone text not null,
  normalized_mobile_phone text not null,
  role text,
  notes text,
  organic_team_id uuid references public.teams(id),
  attendance_status text not null default 'unavailable'
    check (attendance_status in ('present', 'en_route', 'unavailable', 'inactive')),
  attendance_updated_by uuid references public.profiles(id),
  attendance_updated_at timestamptz,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'roster', 'imported', 'external')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists incident_manual_personnel_incident_phone_active_idx
  on public.incident_manual_personnel (incident_id, normalized_mobile_phone)
  where is_active;

create index if not exists incident_manual_personnel_incident_team_idx
  on public.incident_manual_personnel (incident_id, organic_team_id, is_active);

drop trigger if exists incident_manual_personnel_set_updated_at on public.incident_manual_personnel;
create trigger incident_manual_personnel_set_updated_at
  before update on public.incident_manual_personnel
  for each row execute function public.set_updated_at();

alter table public.incident_manual_personnel enable row level security;

drop policy if exists incident_manual_personnel_member_select on public.incident_manual_personnel;
create policy incident_manual_personnel_member_select
  on public.incident_manual_personnel for select
  using (public.can_read_incident(incident_id));

drop policy if exists incident_manual_personnel_operator_mutate on public.incident_manual_personnel;
create policy incident_manual_personnel_operator_mutate
  on public.incident_manual_personnel for all
  using (public.can_edit_personnel(incident_id))
  with check (public.can_edit_personnel(incident_id));

create table if not exists public.incident_ad_hoc_teams (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  name text not null,
  purpose text,
  related_site_id uuid references public.sites(id),
  commander_name text,
  notes text,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  restored_at timestamptz,
  restored_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, name)
);

create index if not exists incident_ad_hoc_teams_incident_status_idx
  on public.incident_ad_hoc_teams (incident_id, status, name);

drop trigger if exists incident_ad_hoc_teams_set_updated_at on public.incident_ad_hoc_teams;
create trigger incident_ad_hoc_teams_set_updated_at
  before update on public.incident_ad_hoc_teams
  for each row execute function public.set_updated_at();

alter table public.incident_ad_hoc_teams enable row level security;

drop policy if exists incident_ad_hoc_teams_member_select on public.incident_ad_hoc_teams;
create policy incident_ad_hoc_teams_member_select
  on public.incident_ad_hoc_teams for select
  using (public.can_read_incident(incident_id));

drop policy if exists incident_ad_hoc_teams_operator_mutate on public.incident_ad_hoc_teams;
create policy incident_ad_hoc_teams_operator_mutate
  on public.incident_ad_hoc_teams for all
  using (public.can_edit_personnel(incident_id))
  with check (public.can_edit_personnel(incident_id));

create table if not exists public.incident_ad_hoc_team_members (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  ad_hoc_team_id uuid not null references public.incident_ad_hoc_teams(id) on delete cascade,
  unit_personnel_id uuid references public.unit_personnel(id),
  manual_personnel_id uuid references public.incident_manual_personnel(id),
  notes text,
  is_active boolean not null default true,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  constraint incident_ad_hoc_member_one_person check (
    (unit_personnel_id is not null and manual_personnel_id is null)
    or
    (unit_personnel_id is null and manual_personnel_id is not null)
  )
);

create unique index if not exists incident_ad_hoc_team_members_unit_active_idx
  on public.incident_ad_hoc_team_members (ad_hoc_team_id, unit_personnel_id)
  where is_active and unit_personnel_id is not null;

create unique index if not exists incident_ad_hoc_team_members_manual_active_idx
  on public.incident_ad_hoc_team_members (ad_hoc_team_id, manual_personnel_id)
  where is_active and manual_personnel_id is not null;

create index if not exists incident_ad_hoc_team_members_incident_idx
  on public.incident_ad_hoc_team_members (incident_id, ad_hoc_team_id, is_active);

alter table public.incident_ad_hoc_team_members enable row level security;

drop policy if exists incident_ad_hoc_team_members_member_select on public.incident_ad_hoc_team_members;
create policy incident_ad_hoc_team_members_member_select
  on public.incident_ad_hoc_team_members for select
  using (public.can_read_incident(incident_id));

drop policy if exists incident_ad_hoc_team_members_operator_mutate on public.incident_ad_hoc_team_members;
create policy incident_ad_hoc_team_members_operator_mutate
  on public.incident_ad_hoc_team_members for all
  using (public.can_edit_personnel(incident_id))
  with check (public.can_edit_personnel(incident_id));

create or replace function public.normalize_incident_mobile_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]+', '', 'g');

  if v_digits like '972%' and length(v_digits) >= 11 then
    v_digits := '0' || substring(v_digits from 4);
  end if;

  return nullif(v_digits, '');
end;
$$;

create or replace function public.log_incident_personnel_event_internal(
  p_incident_id uuid,
  p_log_type text,
  p_title text,
  p_description text,
  p_importance text default 'normal',
  p_team_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    team_id,
    log_type,
    category,
    reported_at,
    source_type,
    source_name,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    p_incident_id,
    p_team_id,
    p_log_type,
    'administrative',
    now(),
    'system',
    'מערכת',
    p_title,
    p_description,
    coalesce(p_importance, 'normal'),
    coalesce(p_metadata, '{}'::jsonb),
    public.current_actor_id()
  )
  returning id into v_id;

  perform set_config('rcc.allow_event_log_insert', 'off', true);
  return v_id;
exception
  when others then
    perform set_config('rcc.allow_event_log_insert', 'off', true);
    raise;
end;
$$;

revoke all on function public.log_incident_personnel_event_internal(uuid, text, text, text, text, uuid, jsonb) from public;

create or replace function public.create_or_reuse_incident_manual_personnel(
  p_incident_id uuid,
  p_first_name text,
  p_last_name text,
  p_mobile_phone text,
  p_organic_team_id uuid default null,
  p_role text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_mobile text := nullif(btrim(coalesce(p_mobile_phone, '')), '');
  v_normalized text := public.normalize_incident_mobile_phone(p_mobile_phone);
  v_manual public.incident_manual_personnel%rowtype;
  v_roster public.unit_personnel%rowtype;
  v_team_name text;
  v_id uuid;
begin
  perform public.assert_edit_personnel(p_incident_id);

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  if v_mobile is null or v_normalized is null then
    raise exception 'Mobile phone is required';
  end if;

  if p_organic_team_id is not null then
    select coalesce(t.name, 'צוות ' || t.team_number::text) into v_team_name
    from public.teams t
    where t.id = p_organic_team_id
      and t.incident_id = p_incident_id
      and t.is_active;

    if v_team_name is null then
      raise exception 'Selected team is not active in this incident';
    end if;
  end if;

  select * into v_manual
  from public.incident_manual_personnel
  where incident_id = p_incident_id
    and normalized_mobile_phone = v_normalized
    and is_active
  limit 1;

  if found then
    if p_organic_team_id is not null and v_manual.organic_team_id is distinct from p_organic_team_id then
      update public.incident_manual_personnel
      set organic_team_id = p_organic_team_id,
          updated_by = public.current_actor_id()
      where id = v_manual.id;

      perform public.log_incident_personnel_event_internal(
        p_incident_id,
        'incident_personnel_existing_reused',
        'איש צוות קיים שויך לצוות',
        v_manual.first_name || ' ' || v_manual.last_name || ' שויך לצוות ' || coalesce(v_team_name, ''),
        'normal',
        p_organic_team_id,
        jsonb_build_object('manual_personnel_id', v_manual.id, 'team_id', p_organic_team_id)
      );
    end if;

    return jsonb_build_object(
      'status', 'reused',
      'kind', 'manual',
      'id', v_manual.id,
      'message', 'איש צוות עם מספר טלפון זה כבר קיים באירוע. לא נוצרה כפילות.'
    );
  end if;

  select * into v_roster
  from public.unit_personnel up
  where public.normalize_incident_mobile_phone(up.mobile_phone) = v_normalized
    and up.is_active
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate_roster',
      'kind', 'roster',
      'id', v_roster.id,
      'message', 'איש צוות עם מספר טלפון זה כבר קיים ברשימת היחידה. לא נוצרה רשומה ידנית.'
    );
  end if;

  insert into public.incident_manual_personnel (
    incident_id,
    first_name,
    last_name,
    mobile_phone,
    normalized_mobile_phone,
    role,
    notes,
    organic_team_id,
    attendance_updated_by,
    attendance_updated_at,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_first_name,
    v_last_name,
    v_mobile,
    v_normalized,
    nullif(btrim(coalesce(p_role, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_organic_team_id,
    public.current_actor_id(),
    now(),
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_manual_personnel_added',
    'איש צוות נוסף ידנית',
    v_first_name || ' ' || v_last_name || coalesce(' נוסף לצוות ' || v_team_name, ''),
    'important',
    p_organic_team_id,
    jsonb_build_object('manual_personnel_id', v_id, 'team_id', p_organic_team_id, 'source_type', 'manual')
  );

  return jsonb_build_object(
    'status', 'created',
    'kind', 'manual',
    'id', v_id,
    'message', 'איש הצוות נוסף לאירוע.'
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
set search_path = public
as $$
declare
  v_person public.incident_manual_personnel%rowtype;
  v_old_status text;
begin
  perform public.assert_edit_personnel(p_incident_id);

  if p_attendance_status not in ('present', 'en_route', 'unavailable', 'inactive') then
    raise exception 'Invalid attendance status';
  end if;

  select * into v_person
  from public.incident_manual_personnel
  where id = p_manual_personnel_id
    and incident_id = p_incident_id
    and is_active;

  if not found then
    raise exception 'Manual personnel record not found';
  end if;

  v_old_status := v_person.attendance_status;

  update public.incident_manual_personnel
  set attendance_status = p_attendance_status,
      attendance_updated_by = public.current_actor_id(),
      attendance_updated_at = now(),
      updated_by = public.current_actor_id()
  where id = p_manual_personnel_id;

  perform public.log_incident_personnel_event_internal(
    p_incident_id,
    'incident_manual_personnel_status_changed',
    'עודכן סטטוס איש צוות ידני',
    v_person.first_name || ' ' || v_person.last_name || ': ' || v_old_status || ' → ' || p_attendance_status,
    'normal',
    v_person.organic_team_id,
    jsonb_build_object('manual_personnel_id', p_manual_personnel_id, 'old_status', v_old_status, 'new_status', p_attendance_status)
  );
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
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  perform public.assert_edit_personnel(p_incident_id);

  if v_name is null then
    raise exception 'Team name is required';
  end if;

  if p_related_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_related_site_id and s.incident_id = p_incident_id
  ) then
    raise exception 'Related site does not belong to this incident';
  end if;

  insert into public.incident_ad_hoc_teams (
    incident_id,
    name,
    purpose,
    related_site_id,
    commander_name,
    notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_name,
    nullif(btrim(coalesce(p_purpose, '')), ''),
    p_related_site_id,
    nullif(btrim(coalesce(p_commander_name, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
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

create or replace function public.archive_incident_ad_hoc_team(
  p_incident_id uuid,
  p_ad_hoc_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.incident_ad_hoc_teams%rowtype;
begin
  perform public.assert_edit_personnel(p_incident_id);

  select * into v_team
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id
    and incident_id = p_incident_id;

  if not found then
    raise exception 'Ad-hoc team not found';
  end if;

  update public.incident_ad_hoc_teams
  set status = 'archived',
      archived_at = now(),
      archived_by = public.current_actor_id(),
      updated_by = public.current_actor_id()
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
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_old public.incident_ad_hoc_teams%rowtype;
begin
  perform public.assert_edit_personnel(p_incident_id);

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
      updated_by = public.current_actor_id()
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
set search_path = public
as $$
declare
  v_team public.incident_ad_hoc_teams%rowtype;
  v_name text;
  v_id uuid;
begin
  perform public.assert_edit_personnel(p_incident_id);

  if (p_unit_personnel_id is null and p_manual_personnel_id is null)
    or (p_unit_personnel_id is not null and p_manual_personnel_id is not null)
  then
    raise exception 'Exactly one member source is required';
  end if;

  select * into v_team
  from public.incident_ad_hoc_teams
  where id = p_ad_hoc_team_id
    and incident_id = p_incident_id
    and status = 'active';

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
  else
    select first_name || ' ' || last_name into v_name
    from public.incident_manual_personnel
    where id = p_manual_personnel_id
      and incident_id = p_incident_id
      and is_active;

    if v_name is null then
      raise exception 'Manual personnel record not found';
    end if;
  end if;

  insert into public.incident_ad_hoc_team_members (
    incident_id,
    ad_hoc_team_id,
    unit_personnel_id,
    manual_personnel_id,
    notes,
    added_by
  )
  values (
    p_incident_id,
    p_ad_hoc_team_id,
    p_unit_personnel_id,
    p_manual_personnel_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.incident_ad_hoc_team_members
    where ad_hoc_team_id = p_ad_hoc_team_id
      and is_active
      and (
        (p_unit_personnel_id is not null and unit_personnel_id = p_unit_personnel_id)
        or
        (p_manual_personnel_id is not null and manual_personnel_id = p_manual_personnel_id)
      )
    limit 1;
  end if;

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
set search_path = public
as $$
declare
  v_member public.incident_ad_hoc_team_members%rowtype;
  v_team_name text;
begin
  perform public.assert_edit_personnel(p_incident_id);

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
      removed_by = public.current_actor_id(),
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

grant execute on function public.normalize_incident_mobile_phone(text) to authenticated;
grant execute on function public.create_or_reuse_incident_manual_personnel(uuid, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.set_incident_manual_personnel_status(uuid, uuid, text) to authenticated;
grant execute on function public.create_incident_ad_hoc_team(uuid, text, text, uuid, text, text) to authenticated;
grant execute on function public.update_incident_ad_hoc_team(uuid, uuid, text, text, uuid, text, text) to authenticated;
grant execute on function public.archive_incident_ad_hoc_team(uuid, uuid) to authenticated;
grant execute on function public.add_incident_ad_hoc_team_member(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.remove_incident_ad_hoc_team_member(uuid, uuid) to authenticated;
