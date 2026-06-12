-- Phase 5A EventLog hardening.
-- Replaces operational report functions so all future operational-number/report
-- EventLogs include the required metadata keys. Existing event_logs are immutable
-- and are not changed by this migration.

create or replace function public.create_operational_report(
  p_person_id uuid,
  p_status_id uuid,
  p_information_source_type text,
  p_information_source_name text default null,
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default 'לא ידוע',
  p_notes text default null,
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
  v_report_id uuid;
  v_reported_at timestamptz;
  v_source_type text;
  v_source_name text;
  v_source_phone text;
  v_grid_cell text;
  v_confidence_level text;
  v_notes text;
  v_person_name text;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Operational person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'create_operational_report');

  if v_person.is_merged then
    raise exception 'Merged operational numbers cannot receive new reports';
  end if;

  if v_person.site_id is null then
    raise exception 'Operational person % must be assigned to a site before reports can be created', p_person_id;
  end if;

  select * into v_previous_status
  from public.status_types
  where id = v_person.current_status_id;

  select * into v_new_status
  from public.status_types
  where id = p_status_id
    and category = 'person'
    and is_active = true
    and (incident_id = v_person.incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', p_status_id;
  end if;

  v_source_type := nullif(btrim(coalesce(p_information_source_type, '')), '');
  if v_source_type is null then
    raise exception 'Information source type is required';
  end if;

  if v_source_type not in (
    'חפ"ק',
    'אוכלוסיה',
    'משטרה',
    'מד"א',
    'כב"ה',
    'פיקוד העורף',
    'עירייה',
    'מחלצים',
    'אחר'
  ) then
    raise exception 'Information source type % is not valid', v_source_type;
  end if;

  v_confidence_level := coalesce(nullif(btrim(coalesce(p_confidence_level, '')), ''), 'לא ידוע');
  if v_confidence_level not in ('מאומת', 'גבוהה', 'בינונית', 'נמוכה', 'לא ידוע') then
    raise exception 'Confidence level % is not valid', v_confidence_level;
  end if;

  v_source_name := nullif(btrim(coalesce(p_information_source_name, '')), '');
  v_source_phone := nullif(btrim(coalesce(p_source_phone, '')), '');
  v_grid_cell := nullif(btrim(coalesce(p_grid_cell, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  v_reported_at := coalesce(p_reported_at, now());

  perform set_config('rcc.allow_operational_report_insert', 'on', true);
  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.operational_reports (
    incident_id,
    site_id,
    person_id,
    status_id,
    information_source_type,
    information_source_name,
    source_phone,
    grid_cell,
    confidence_level,
    notes,
    reported_at,
    created_by
  )
  values (
    v_person.incident_id,
    v_person.site_id,
    v_person.id,
    p_status_id,
    v_source_type,
    v_source_name,
    v_source_phone,
    v_grid_cell,
    v_confidence_level,
    v_notes,
    v_reported_at,
    public.current_actor_id()
  )
  returning id into v_report_id;

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    team_id,
    notes,
    created_by
  )
  values (
    v_person.id,
    v_person.incident_id,
    v_person.current_status_id,
    p_status_id,
    v_reported_at,
    v_source_type,
    v_source_name,
    null,
    v_notes,
    public.current_actor_id()
  );

  update public.persons
  set
    current_status_id = p_status_id,
    source = v_source_type,
    notes = coalesce(v_notes, notes),
    updated_by = public.current_actor_id()
  where id = v_person.id;

  perform set_config('rcc.allow_operational_report_insert', 'off', true);
  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_person_name := coalesce(
    nullif(btrim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''),
    'שם לא ידוע'
  );

  perform public.create_event_log(
    v_person.incident_id,
    'operational_report_created',
    'דיווח מבצעי חדש',
    '#' || v_person.operational_number || ' - ' || v_person_name || ': '
      || coalesce(v_previous_status.hebrew_label, 'ללא סטטוס')
      || ' → '
      || v_new_status.hebrew_label,
    'operational',
    'normal',
    v_reported_at,
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    null,
    v_source_type,
    coalesce(v_source_name, 'RCC'),
    jsonb_build_object(
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'report_id', v_report_id,
      'status_id', p_status_id,
      'information_source_type', v_source_type,
      'source_name', v_source_name,
      'source_phone', v_source_phone,
      'grid_cell', v_grid_cell,
      'confidence_level', v_confidence_level,
      'notes', v_notes,
      'old_status_id', v_person.current_status_id,
      'new_status_id', p_status_id,
      'old_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label,
      'old_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key
    )
  );

  return v_report_id;
exception
  when others then
    perform set_config('rcc.allow_operational_report_insert', 'off', true);
    perform set_config('rcc.allow_status_history_insert', 'off', true);
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

create or replace function public.create_operational_number(
  p_incident_id uuid,
  p_site_id uuid,
  p_team_number integer,
  p_operational_number integer,
  p_status_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_notes text default null,
  p_information_source_type text default 'חפ"ק',
  p_information_source_name text default 'RCC',
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default 'לא ידוע',
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents%rowtype;
  v_site public.sites%rowtype;
  v_status public.status_types%rowtype;
  v_status_id uuid;
  v_person_id uuid;
  v_report_id uuid;
  v_source_type text;
  v_source_name text;
  v_source_phone text;
  v_grid_cell text;
  v_confidence_level text;
  v_notes text;
  v_person_name text;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  if p_site_id is null then
    raise exception 'Site is required';
  end if;

  perform public.validate_operational_number_for_team(p_team_number, p_operational_number);

  select * into v_incident
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident % does not exist', p_incident_id;
  end if;

  perform public.assert_incident_writable(p_incident_id, 'create_operational_number');

  select * into v_site
  from public.sites
  where id = p_site_id
    and incident_id = p_incident_id;

  if not found then
    raise exception 'Site % does not belong to incident %', p_site_id, p_incident_id;
  end if;

  if exists (
    select 1
    from public.persons p
    where p.incident_id = p_incident_id
      and p.operational_number = p_operational_number
  ) then
    raise exception 'Operational number % already exists for this incident', p_operational_number;
  end if;

  v_status_id := coalesce(p_status_id, public.get_status_id('person', 'missing', p_incident_id));

  if v_status_id is null then
    raise exception 'Default person missing status is missing';
  end if;

  select * into v_status
  from public.status_types
  where id = v_status_id
    and category = 'person'
    and is_active = true
    and (incident_id = p_incident_id or incident_id is null);

  if not found then
    raise exception 'Person status % is not valid for this incident', v_status_id;
  end if;

  v_source_type := coalesce(nullif(btrim(coalesce(p_information_source_type, '')), ''), 'חפ"ק');
  v_source_name := nullif(btrim(coalesce(p_information_source_name, '')), '');
  v_source_phone := nullif(btrim(coalesce(p_source_phone, '')), '');
  v_grid_cell := nullif(btrim(coalesce(p_grid_cell, '')), '');
  v_confidence_level := coalesce(nullif(btrim(coalesce(p_confidence_level, '')), ''), 'לא ידוע');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.persons (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    operational_number,
    first_name,
    last_name,
    current_status_id,
    source,
    notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    p_site_id,
    null,
    null,
    p_operational_number,
    nullif(btrim(coalesce(p_first_name, '')), ''),
    nullif(btrim(coalesce(p_last_name, '')), ''),
    v_status.id,
    v_source_type,
    v_notes,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_person_id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_report_id := public.create_operational_report(
    v_person_id,
    v_status.id,
    v_source_type,
    v_source_name,
    v_source_phone,
    v_grid_cell,
    v_confidence_level,
    v_notes,
    p_reported_at
  );

  v_person_name := coalesce(
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), ''),
    'שם לא ידוע'
  );

  perform public.create_event_log(
    p_incident_id,
    'operational_number_created',
    'יצירת מספר מבצעי',
    '#' || p_operational_number || ' נוצר עבור ' || v_person_name,
    'operational',
    'normal',
    coalesce(p_reported_at, now()),
    p_site_id,
    null,
    null,
    v_person_id,
    null,
    v_source_type,
    coalesce(v_source_name, 'RCC'),
    jsonb_build_object(
      'person_id', v_person_id,
      'operational_number', p_operational_number,
      'report_id', v_report_id,
      'status_id', v_status.id,
      'information_source_type', v_source_type,
      'source_name', v_source_name,
      'source_phone', v_source_phone,
      'grid_cell', v_grid_cell,
      'confidence_level', v_confidence_level,
      'notes', v_notes,
      'team_number', p_team_number,
      'sequence_number', public.operational_number_sequence(p_operational_number),
      'status_key', v_status.status_key,
      'status_label', v_status.hebrew_label,
      'site_id', p_site_id
    )
  );

  return v_person_id;
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;
