-- Phase 5A operational reports foundation.
-- Operational reports are append-only. Current person status is updated only for
-- compatibility with existing dashboards and workflows.

create unique index if not exists sites_incident_id_id_uidx
  on public.sites (incident_id, id);

create unique index if not exists persons_incident_id_id_uidx
  on public.persons (incident_id, id);

create table if not exists public.operational_reports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid not null references public.sites(id),
  person_id uuid not null references public.persons(id),
  status_id uuid not null references public.status_types(id),
  information_source_type text not null
    check (
      information_source_type in (
        'חפ"ק',
        'אוכלוסיה',
        'משטרה',
        'מד"א',
        'כב"ה',
        'פיקוד העורף',
        'עירייה',
        'מחלצים',
        'אחר'
      )
    ),
  information_source_name text,
  source_phone text,
  grid_cell text,
  confidence_level text not null default 'לא ידוע'
    check (confidence_level in ('מאומת', 'גבוהה', 'בינונית', 'נמוכה', 'לא ידוע')),
  notes text,
  reported_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint operational_reports_site_incident_consistency
    foreign key (incident_id, site_id) references public.sites(incident_id, id),
  constraint operational_reports_person_incident_consistency
    foreign key (incident_id, person_id) references public.persons(incident_id, id)
);

create index if not exists operational_reports_incident_idx
  on public.operational_reports (incident_id);

create index if not exists operational_reports_site_idx
  on public.operational_reports (site_id);

create index if not exists operational_reports_person_reported_idx
  on public.operational_reports (person_id, reported_at desc, created_at desc);

create index if not exists operational_reports_status_idx
  on public.operational_reports (status_id);

alter table public.operational_reports enable row level security;

create policy operational_reports_member_select
  on public.operational_reports for select
  using (public.can_read_incident(incident_id));

create policy operational_reports_service_insert
  on public.operational_reports for insert
  with check (public.can_write_incident(incident_id));

create trigger operational_reports_immutable
  before update or delete on public.operational_reports
  for each row execute function public.prevent_update_or_delete();

create or replace function public.guard_internal_operational_report_insert()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_operational_report_insert') then
    raise exception 'Operational reports must be created through approved database functions';
  end if;

  return new;
end;
$$;

create trigger operational_reports_guard_insert
  before insert on public.operational_reports
  for each row execute function public.guard_internal_operational_report_insert();

create or replace function public.operational_number_team_number(p_operational_number integer)
returns integer
language sql
immutable
as $$
  select floor(p_operational_number::numeric / 100)::integer
$$;

create or replace function public.operational_number_sequence(p_operational_number integer)
returns integer
language sql
immutable
as $$
  select p_operational_number % 100
$$;

create or replace function public.validate_operational_number_for_team(
  p_team_number integer,
  p_operational_number integer
)
returns void
language plpgsql
immutable
as $$
declare
  v_sequence integer;
begin
  if p_team_number is null or p_team_number <= 0 then
    raise exception 'Team number must be positive';
  end if;

  if p_operational_number is null or p_operational_number <= 0 then
    raise exception 'Operational number must be positive';
  end if;

  v_sequence := public.operational_number_sequence(p_operational_number);

  if public.operational_number_team_number(p_operational_number) <> p_team_number
    or v_sequence < 1
    or v_sequence > 99
  then
    raise exception 'Operational number % is not valid for team %. Expected team_number * 100 + sequence 1-99.',
      p_operational_number,
      p_team_number;
  end if;
end;
$$;

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
  v_confidence_level text;
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
    nullif(btrim(coalesce(p_information_source_name, '')), ''),
    nullif(btrim(coalesce(p_source_phone, '')), ''),
    nullif(btrim(coalesce(p_grid_cell, '')), ''),
    v_confidence_level,
    nullif(btrim(coalesce(p_notes, '')), ''),
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
    nullif(btrim(coalesce(p_information_source_name, '')), ''),
    null,
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id()
  );

  update public.persons
  set
    current_status_id = p_status_id,
    source = v_source_type,
    notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
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
    coalesce(nullif(btrim(coalesce(p_information_source_name, '')), ''), 'RCC'),
    jsonb_build_object(
      'report_id', v_report_id,
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'old_status_id', v_person.current_status_id,
      'new_status_id', p_status_id,
      'old_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label,
      'old_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key,
      'information_source_type', v_source_type,
      'information_source_name', nullif(btrim(coalesce(p_information_source_name, '')), ''),
      'source_phone', nullif(btrim(coalesce(p_source_phone, '')), ''),
      'grid_cell', nullif(btrim(coalesce(p_grid_cell, '')), ''),
      'confidence_level', v_confidence_level,
      'notes', nullif(btrim(coalesce(p_notes, '')), '')
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
    coalesce(nullif(btrim(coalesce(p_information_source_type, '')), ''), 'חפ"ק'),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_person_id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  v_report_id := public.create_operational_report(
    v_person_id,
    v_status.id,
    coalesce(nullif(btrim(coalesce(p_information_source_type, '')), ''), 'חפ"ק'),
    p_information_source_name,
    p_source_phone,
    p_grid_cell,
    p_confidence_level,
    p_notes,
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
    coalesce(nullif(btrim(coalesce(p_information_source_type, '')), ''), 'חפ"ק'),
    coalesce(nullif(btrim(coalesce(p_information_source_name, '')), ''), 'RCC'),
    jsonb_build_object(
      'person_id', v_person_id,
      'report_id', v_report_id,
      'team_number', p_team_number,
      'sequence_number', public.operational_number_sequence(p_operational_number),
      'operational_number', p_operational_number,
      'status_id', v_status.id,
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

create or replace view public.operational_numbers_dashboard as
with linked_residents as (
  select distinct on (ur.linked_person_id)
    ur.linked_person_id as person_id,
    ur.id as resident_id,
    ur.first_name as resident_first_name,
    ur.last_name as resident_last_name,
    ur.unit_id as resident_unit_id
  from public.unit_residents ur
  where ur.linked_person_id is not null
    and ur.is_active = true
  order by ur.linked_person_id, ur.updated_at desc, ur.created_at desc
),
latest_reports as (
  select distinct on (opr.person_id)
    opr.*
  from public.operational_reports opr
  order by opr.person_id, opr.reported_at desc, opr.created_at desc
)
select
  p.incident_id,
  p.site_id,
  p.id as person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  p.first_name,
  p.last_name,
  p.current_status_id,
  current_status.status_key as current_status_key,
  current_status.hebrew_label as current_status_label,
  current_status.counts_as_gap_resolved,
  p.unit_id,
  u.unit_number,
  f.floor_number,
  lr.resident_id,
  lr.resident_first_name,
  lr.resident_last_name,
  latest.id as latest_report_id,
  latest.status_id as latest_report_status_id,
  latest_status.status_key as latest_report_status_key,
  latest_status.hebrew_label as latest_report_status_label,
  latest.information_source_type as latest_source_type,
  latest.information_source_name as latest_source_name,
  latest.source_phone as latest_source_phone,
  latest.grid_cell as latest_grid_cell,
  latest.confidence_level as latest_confidence_level,
  latest.notes as latest_notes,
  latest.reported_at as latest_reported_at,
  latest.created_at as latest_report_created_at,
  p.is_merged,
  p.merged_into_person_id
from public.persons p
join public.status_types current_status on current_status.id = p.current_status_id
left join latest_reports latest on latest.person_id = p.id
left join public.status_types latest_status on latest_status.id = latest.status_id
left join linked_residents lr on lr.person_id = p.id
left join public.units u on u.id = coalesce(p.unit_id, lr.resident_unit_id)
left join public.floors f on f.id = u.floor_id;

create or replace view public.operational_report_history as
select
  opr.id as report_id,
  opr.incident_id,
  opr.site_id,
  opr.person_id,
  p.operational_number,
  public.operational_number_team_number(p.operational_number) as team_number,
  public.operational_number_sequence(p.operational_number) as sequence_number,
  opr.status_id,
  st.status_key,
  st.hebrew_label as status_label,
  opr.information_source_type,
  opr.information_source_name,
  opr.source_phone,
  opr.grid_cell,
  opr.confidence_level,
  opr.notes,
  opr.reported_at,
  opr.created_by,
  opr.created_at
from public.operational_reports opr
join public.persons p on p.id = opr.person_id
join public.status_types st on st.id = opr.status_id
order by opr.reported_at desc, opr.created_at desc;

comment on table public.operational_reports
  is 'Append-only reports for operational numbers. Cards show latest report; history remains preserved.';

comment on function public.create_operational_number(uuid, uuid, integer, integer, uuid, text, text, text, text, text, text, text, text, timestamp with time zone)
  is 'Creates a site-specific operational number, writes the initial operational report, updates compatibility status, and appends immutable EventLog rows.';

comment on function public.create_operational_report(uuid, uuid, text, text, text, text, text, text, timestamp with time zone)
  is 'Appends an operational report, updates persons.current_status_id for compatibility, writes status history, and appends an immutable EventLog row.';
