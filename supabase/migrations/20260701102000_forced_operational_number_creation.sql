-- Forced creation of non-sequential operational numbers.
-- No placeholder numbers are created; only the requested number is opened.

create or replace function public.create_forced_operational_number(
  p_incident_id uuid,
  p_site_id uuid,
  p_team_number integer,
  p_operational_number integer,
  p_status_id uuid default null,
  p_reason text default null,
  p_information_source_type text default 'חפ"ק',
  p_confidence_level text default 'לא ידוע',
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'Forced creation reason is required';
  end if;

  perform public.validate_operational_number_for_team(p_team_number, p_operational_number);
  perform public.assert_incident_writable(p_incident_id, 'create_operational_number');

  v_person_id := public.create_operational_number(
    p_incident_id,
    p_site_id,
    p_team_number,
    p_operational_number,
    p_status_id,
    null,
    null,
    v_reason,
    p_information_source_type,
    null,
    null,
    null,
    p_confidence_level,
    p_reported_at
  );

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform public.create_event_log(
    p_incident_id,
    'operational_number_forced_created',
    '🔢 מספר מבצעי נפתח מאולץ',
    'המספר המבצעי ' || p_operational_number || ' נפתח מאולץ על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '. סיבה: ' || v_reason || '.',
    'operational',
    'important',
    coalesce(p_reported_at, now()),
    p_site_id,
    null,
    null,
    v_person_id,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'team_number', p_team_number,
      'requested_operational_number', p_operational_number,
      'reason', v_reason,
      'created_at', coalesce(p_reported_at, now())
    )
  );

  return v_person_id;
end;
$$;

grant execute on function public.create_forced_operational_number(uuid, uuid, integer, integer, uuid, text, text, text, timestamptz) to authenticated;
