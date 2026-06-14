-- Phase 6C incident creation wizard foundation.
--
-- Creates incidents through a secure database function so the incident,
-- initial teams, membership, and immutable EventLog are created together.

alter table public.incidents
  add column if not exists incident_type text,
  add column if not exists initial_description text,
  add column if not exists command_structure jsonb not null default '{}'::jsonb;

alter table public.incidents
  drop constraint if exists incidents_incident_type_check,
  add constraint incidents_incident_type_check
    check (
      incident_type is null
      or incident_type in (
        'missile_strike',
        'structure_collapse',
        'earthquake',
        'fire',
        'hazmat',
        'flood',
        'height_rescue',
        'elevator_rescue',
        'other'
      )
    );

create or replace function public.create_incident_from_wizard(
  p_incident_name text,
  p_incident_type text,
  p_city text,
  p_address text default null,
  p_initial_description text default null,
  p_command_structure jsonb default '{}'::jsonb,
  p_teams jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_incident_id uuid;
  v_status_id uuid;
  v_team_status_id uuid;
  v_team jsonb;
  v_team_number integer;
  v_commander_name text;
  v_phone text;
  v_personnel_count integer;
begin
  v_actor_id := public.current_actor_id();
  v_actor_role := public.current_user_role();

  if v_actor_id is null then
    raise exception 'לא זוהה משתמש מחובר';
  end if;

  if v_actor_role not in ('system_administrator', 'incident_commander', 'command_post_operator') then
    raise exception 'אין הרשאה לפתיחת אירוע חדש';
  end if;

  if nullif(btrim(p_incident_name), '') is null then
    raise exception 'שם האירוע הוא שדה חובה';
  end if;

  if nullif(btrim(p_incident_type), '') is null then
    raise exception 'סוג האירוע הוא שדה חובה';
  end if;

  if p_incident_type not in (
    'missile_strike',
    'structure_collapse',
    'earthquake',
    'fire',
    'hazmat',
    'flood',
    'height_rescue',
    'elevator_rescue',
    'other'
  ) then
    raise exception 'סוג האירוע אינו תקין';
  end if;

  if nullif(btrim(p_city), '') is null then
    raise exception 'עיר ראשית היא שדה חובה';
  end if;

  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then
    raise exception 'רשימת הצוותים לא נשלחה בצורה תקינה';
  end if;

  v_status_id := public.get_status_id('incident', 'active', null);
  v_team_status_id := public.get_status_id('team', 'available', null);

  if v_status_id is null then
    raise exception 'סטטוס אירוע פעיל לא קיים';
  end if;

  if v_team_status_id is null then
    raise exception 'סטטוס צוות זמין לא קיים';
  end if;

  insert into public.incidents (
    name,
    incident_type,
    city,
    address,
    initial_description,
    command_structure,
    opened_at,
    status_id,
    is_closed,
    created_by,
    updated_by
  )
  values (
    btrim(p_incident_name),
    p_incident_type,
    btrim(p_city),
    coalesce(nullif(btrim(p_address), ''), btrim(p_city)),
    nullif(btrim(p_initial_description), ''),
    coalesce(p_command_structure, '{}'::jsonb),
    now(),
    v_status_id,
    false,
    v_actor_id,
    v_actor_id
  )
  returning id into v_incident_id;

  insert into public.incident_memberships (
    incident_id,
    user_id,
    role,
    created_by
  )
  values (
    v_incident_id,
    v_actor_id,
    'incident_commander',
    v_actor_id
  )
  on conflict (incident_id, user_id) do nothing;

  for v_team in select value from jsonb_array_elements(p_teams)
  loop
    v_team_number := nullif(v_team->>'teamNumber', '')::integer;
    v_commander_name := nullif(btrim(coalesce(v_team->>'leader', '')), '');
    v_phone := nullif(btrim(coalesce(v_team->>'phone', '')), '');
    v_personnel_count := nullif(v_team->>'rescuers', '')::integer;

    if v_team_number is null or v_team_number <= 0 then
      raise exception 'מספר צוות חייב להיות מספר תקין';
    end if;

    insert into public.teams (
      incident_id,
      team_number,
      name,
      commander_name,
      phone,
      personnel_count,
      status_id,
      is_active,
      created_by,
      updated_by
    )
    values (
      v_incident_id,
      v_team_number,
      case
        when v_team_number = 9 then 'צוות 9 אוכלוסייה'
        else 'צוות ' || v_team_number
      end,
      v_commander_name,
      v_phone,
      v_personnel_count,
      v_team_status_id,
      true,
      v_actor_id,
      v_actor_id
    )
    on conflict (incident_id, team_number) do update
    set
      commander_name = excluded.commander_name,
      phone = excluded.phone,
      personnel_count = excluded.personnel_count,
      updated_by = v_actor_id,
      updated_at = now();
  end loop;

  perform public.create_event_log(
    v_incident_id,
    'incident_created',
    'פתיחת אירוע',
    'נפתח אירוע ' || btrim(p_incident_name),
    'administrative',
    'important',
    now(),
    null,
    null,
    null,
    null,
    null,
    'system',
    null,
    jsonb_build_object(
      'incident_id', v_incident_id,
      'incident_name', btrim(p_incident_name),
      'incident_type', p_incident_type,
      'city', btrim(p_city),
      'address', nullif(btrim(p_address), ''),
      'assigned_teams', p_teams
    )
  );

  return v_incident_id;
end;
$$;

comment on function public.create_incident_from_wizard(text, text, text, text, text, jsonb, jsonb)
  is 'Creates an active incident, initial commander membership, selected initial teams, and an immutable incident creation EventLog.';
