-- Phase 8C: unit personnel roster and incident-specific attendance.
-- Incident attendance changes append EventLogs only through public.create_event_log(...).

create table if not exists public.unit_personnel (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  role text not null check (role in (
    'unit_commander',
    'deputy_unit_commander',
    'team_commander',
    'deputy_team_commander',
    'rescuer',
    'personnel',
    'medic',
    'engineer',
    'other'
  )),
  department text not null check (department in (
    'headquarters',
    'logistics',
    'population',
    'command_post',
    'medical',
    'team_1',
    'team_2',
    'team_3',
    'team_4',
    'other'
  )),
  mobile_phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists unit_personnel_active_department_idx
  on public.unit_personnel (is_active, department, last_name, first_name);

drop trigger if exists unit_personnel_set_updated_at on public.unit_personnel;
create trigger unit_personnel_set_updated_at
  before update on public.unit_personnel
  for each row execute function public.set_updated_at();

alter table public.unit_personnel enable row level security;

drop policy if exists unit_personnel_authenticated_select on public.unit_personnel;
create policy unit_personnel_authenticated_select
  on public.unit_personnel for select
  using (public.current_actor_id() is not null);

drop policy if exists unit_personnel_authenticated_mutate on public.unit_personnel;
create policy unit_personnel_authenticated_mutate
  on public.unit_personnel for all
  using (public.current_actor_id() is not null)
  with check (public.current_actor_id() is not null);

create table if not exists public.event_personnel_status (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  personnel_id uuid not null references public.unit_personnel(id) on delete cascade,
  attendance_status text not null check (attendance_status in ('present', 'en_route', 'unavailable', 'inactive')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (incident_id, personnel_id)
);

create index if not exists event_personnel_status_incident_idx
  on public.event_personnel_status (incident_id, attendance_status, updated_at desc);

alter table public.event_personnel_status enable row level security;

drop policy if exists event_personnel_status_member_select on public.event_personnel_status;
create policy event_personnel_status_member_select
  on public.event_personnel_status for select
  using (public.can_read_incident(incident_id));

drop policy if exists event_personnel_status_operator_mutate on public.event_personnel_status;
create policy event_personnel_status_operator_mutate
  on public.event_personnel_status for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create or replace function public.create_unit_personnel(
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_last_name text;
begin
  if public.current_actor_id() is null then
    raise exception 'Authentication required';
  end if;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  insert into public.unit_personnel (
    first_name,
    last_name,
    role,
    department,
    mobile_phone,
    created_by
  )
  values (
    v_first_name,
    v_last_name,
    p_role,
    p_department,
    nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    public.current_actor_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_unit_personnel(
  p_personnel_id uuid,
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  if public.current_actor_id() is null then
    raise exception 'Authentication required';
  end if;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  update public.unit_personnel
  set
    first_name = v_first_name,
    last_name = v_last_name,
    role = p_role,
    department = p_department,
    mobile_phone = nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    is_active = coalesce(p_is_active, true)
  where id = p_personnel_id;

  if not found then
    raise exception 'Personnel record not found';
  end if;
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
set search_path = public
as $$
declare
  v_person public.unit_personnel%rowtype;
  v_old_status text;
begin
  perform public.assert_incident_writable(p_incident_id, 'set_event_personnel_status');

  if p_attendance_status not in ('present', 'en_route', 'unavailable', 'inactive') then
    raise exception 'Invalid attendance status';
  end if;

  select * into v_person
  from public.unit_personnel
  where id = p_personnel_id;

  if not found then
    raise exception 'Personnel record not found';
  end if;

  select attendance_status into v_old_status
  from public.event_personnel_status
  where incident_id = p_incident_id
    and personnel_id = p_personnel_id;

  insert into public.event_personnel_status (
    incident_id,
    personnel_id,
    attendance_status,
    updated_by,
    updated_at
  )
  values (
    p_incident_id,
    p_personnel_id,
    p_attendance_status,
    public.current_actor_id(),
    now()
  )
  on conflict (incident_id, personnel_id)
  do update set
    attendance_status = excluded.attendance_status,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  perform public.create_event_log(
    p_incident_id,
    'event_personnel_status_changed',
    'עדכון סטטוס כח אדם',
    v_person.first_name || ' ' || v_person.last_name || ': ' || coalesce(v_old_status, 'לא הוגדר') || ' → ' || p_attendance_status,
    'operational',
    'normal',
    now(),
    null,
    null,
    null,
    null,
    null,
    'מערכת',
    null,
    jsonb_build_object(
      'personnel_id', p_personnel_id,
      'personnel_name', v_person.first_name || ' ' || v_person.last_name,
      'old_status', v_old_status,
      'new_status', p_attendance_status,
      'role', v_person.role,
      'department', v_person.department
    )
  );
end;
$$;
