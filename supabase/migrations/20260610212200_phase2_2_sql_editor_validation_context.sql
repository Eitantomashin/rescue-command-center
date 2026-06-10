-- RCC Phase 2.2 SQL Editor validation context.
--
-- Supabase SQL Editor does not run with a request JWT, so auth.uid() is null.
-- This migration adds an explicit validation actor mechanism for SQL Editor
-- scripts while keeping production behavior based on auth.uid().

create or replace function public.sql_editor_validation_mode_enabled()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('rcc.sql_editor_validation_mode', true), '') = 'on'
$$;

create or replace function public.current_actor_id()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_auth_uid uuid;
  v_test_user_id text;
begin
  v_auth_uid := auth.uid();

  if v_auth_uid is not null then
    return v_auth_uid;
  end if;

  if not public.sql_editor_validation_mode_enabled() then
    return null;
  end if;

  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '');

  if v_test_user_id is null then
    return null;
  end if;

  return v_test_user_id::uuid;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = public.current_actor_id()
$$;

create or replace function public.current_user_incident_role(p_incident_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.profiles p
      where p.id = public.current_actor_id()
        and p.role = 'system_administrator'
    )
    then 'system_administrator'
    else (
      select im.role
      from public.incident_memberships im
      where im.incident_id = p_incident_id
        and im.user_id = public.current_actor_id()
      limit 1
    )
  end
$$;

create or replace function public.create_event_log(
  p_incident_id uuid,
  p_log_type text,
  p_title text,
  p_description text default null,
  p_category text default 'operational',
  p_importance text default 'normal',
  p_reported_at timestamptz default now(),
  p_site_id uuid default null,
  p_floor_id uuid default null,
  p_unit_id uuid default null,
  p_person_id uuid default null,
  p_team_id uuid default null,
  p_source_type text default null,
  p_source_name text default null,
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
  if not public.can_write_incident(p_incident_id) then
    raise exception 'User is not allowed to write event logs for this incident';
  end if;

  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
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
    p_site_id,
    p_floor_id,
    p_unit_id,
    p_person_id,
    p_team_id,
    p_log_type,
    p_category,
    coalesce(p_reported_at, now()),
    p_source_type,
    p_source_name,
    p_title,
    p_description,
    coalesce(p_importance, 'normal'),
    coalesce(p_metadata, '{}'::jsonb),
    public.current_actor_id()
  )
  returning id into v_id;

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_id;
end;
$$;

create or replace function public.create_authorized_correction_event_log(
  p_incident_id uuid,
  p_title text,
  p_reason text,
  p_description text default null,
  p_site_id uuid default null,
  p_floor_id uuid default null,
  p_unit_id uuid default null,
  p_person_id uuid default null,
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
  if not public.can_correct_closed_incident(p_incident_id)
    and public.current_user_incident_role(p_incident_id) <> 'system_administrator'
  then
    raise exception 'User is not allowed to create authorized corrections for this incident';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'Correction reason is required';
  end if;

  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
    team_id,
    log_type,
    category,
    reported_at,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    p_incident_id,
    p_site_id,
    p_floor_id,
    p_unit_id,
    p_person_id,
    p_team_id,
    'authorized_correction',
    'correction',
    now(),
    p_title,
    p_description,
    'important',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('correction_reason', p_reason),
    public.current_actor_id()
  )
  returning id into v_id;

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_id;
end;
$$;

comment on function public.current_actor_id()
  is 'Returns auth.uid() in production. In Supabase SQL Editor validation only, returns rcc.test_user_id when rcc.sql_editor_validation_mode is on.';

comment on function public.sql_editor_validation_mode_enabled()
  is 'Explicit session flag used by SQL Editor validation scripts. It does not replace auth.uid() for production requests.';
