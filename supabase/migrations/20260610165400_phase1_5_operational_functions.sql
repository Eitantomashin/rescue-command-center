-- RCC Phase 1.5 database hardening.
-- Adds structure/person operational functions, cross-table consistency checks,
-- and internal write guards for event-producing workflows.

create or replace function public.internal_write_allowed(p_key text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting(p_key, true), '') = 'on'
$$;

create or replace function public.validate_floor_consistency()
returns trigger
language plpgsql
as $$
declare
  v_site_incident_id uuid;
begin
  select incident_id into v_site_incident_id
  from public.sites
  where id = new.site_id;

  if not found then
    raise exception 'Floor site_id % does not exist', new.site_id;
  end if;

  if new.incident_id <> v_site_incident_id then
    raise exception 'Floor incident_id must match parent Site incident_id';
  end if;

  return new;
end;
$$;

create or replace function public.validate_unit_consistency()
returns trigger
language plpgsql
as $$
declare
  v_floor_site_id uuid;
  v_floor_incident_id uuid;
  v_site_incident_id uuid;
begin
  select site_id, incident_id
  into v_floor_site_id, v_floor_incident_id
  from public.floors
  where id = new.floor_id;

  if not found then
    raise exception 'Unit floor_id % does not exist', new.floor_id;
  end if;

  select incident_id into v_site_incident_id
  from public.sites
  where id = new.site_id;

  if not found then
    raise exception 'Unit site_id % does not exist', new.site_id;
  end if;

  if new.site_id <> v_floor_site_id then
    raise exception 'Unit site_id must match parent Floor site_id';
  end if;

  if new.incident_id <> v_floor_incident_id
    or new.incident_id <> v_site_incident_id
  then
    raise exception 'Unit incident_id must match parent Site and Floor incident_id';
  end if;

  return new;
end;
$$;

create or replace function public.validate_person_location_consistency()
returns trigger
language plpgsql
as $$
declare
  v_site_incident_id uuid;
  v_floor_site_id uuid;
  v_floor_incident_id uuid;
  v_unit_site_id uuid;
  v_unit_floor_id uuid;
  v_unit_incident_id uuid;
begin
  if new.site_id is not null then
    select incident_id into v_site_incident_id
    from public.sites
    where id = new.site_id;

    if not found then
      raise exception 'Person site_id % does not exist', new.site_id;
    end if;

    if new.incident_id <> v_site_incident_id then
      raise exception 'Person incident_id must match Site incident_id';
    end if;
  end if;

  if new.floor_id is not null then
    select site_id, incident_id
    into v_floor_site_id, v_floor_incident_id
    from public.floors
    where id = new.floor_id;

    if not found then
      raise exception 'Person floor_id % does not exist', new.floor_id;
    end if;

    if new.incident_id <> v_floor_incident_id then
      raise exception 'Person incident_id must match Floor incident_id';
    end if;

    if new.site_id is null or new.site_id <> v_floor_site_id then
      raise exception 'Person floor_id must belong to person site_id';
    end if;
  end if;

  if new.unit_id is not null then
    select site_id, floor_id, incident_id
    into v_unit_site_id, v_unit_floor_id, v_unit_incident_id
    from public.units
    where id = new.unit_id;

    if not found then
      raise exception 'Person unit_id % does not exist', new.unit_id;
    end if;

    if new.incident_id <> v_unit_incident_id then
      raise exception 'Person incident_id must match Unit incident_id';
    end if;

    if new.site_id is null or new.site_id <> v_unit_site_id then
      raise exception 'Person unit_id must belong to person site_id';
    end if;

    if new.floor_id is null or new.floor_id <> v_unit_floor_id then
      raise exception 'Person unit_id must belong to person floor_id';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_unit_resident_consistency()
returns trigger
language plpgsql
as $$
declare
  v_unit_incident_id uuid;
  v_person_incident_id uuid;
begin
  select incident_id into v_unit_incident_id
  from public.units
  where id = new.unit_id;

  if not found then
    raise exception 'Resident unit_id % does not exist', new.unit_id;
  end if;

  if new.incident_id <> v_unit_incident_id then
    raise exception 'Resident incident_id must match Unit incident_id';
  end if;

  if new.linked_person_id is not null then
    select incident_id into v_person_incident_id
    from public.persons
    where id = new.linked_person_id;

    if not found then
      raise exception 'Resident linked_person_id % does not exist', new.linked_person_id;
    end if;

    if new.incident_id <> v_person_incident_id then
      raise exception 'Resident linked Person must belong to same incident';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_team_assignment_consistency()
returns trigger
language plpgsql
as $$
declare
  v_team_incident_id uuid;
  v_site_incident_id uuid;
begin
  select incident_id into v_team_incident_id
  from public.teams
  where id = new.team_id;

  if not found then
    raise exception 'Team assignment team_id % does not exist', new.team_id;
  end if;

  select incident_id into v_site_incident_id
  from public.sites
  where id = new.site_id;

  if not found then
    raise exception 'Team assignment site_id % does not exist', new.site_id;
  end if;

  if new.incident_id <> v_team_incident_id
    or new.incident_id <> v_site_incident_id
  then
    raise exception 'Team assignment incident_id must match Team and Site incident_id';
  end if;

  return new;
end;
$$;

create trigger floors_validate_consistency
  before insert or update on public.floors
  for each row execute function public.validate_floor_consistency();

create trigger units_validate_consistency
  before insert or update on public.units
  for each row execute function public.validate_unit_consistency();

create trigger persons_validate_location_consistency
  before insert or update on public.persons
  for each row execute function public.validate_person_location_consistency();

create trigger unit_residents_validate_consistency
  before insert or update on public.unit_residents
  for each row execute function public.validate_unit_resident_consistency();

create trigger team_site_assignments_validate_consistency
  before insert or update on public.team_site_assignments
  for each row execute function public.validate_team_assignment_consistency();

create or replace function public.guard_site_structure_write()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_structure_write') then
    raise exception 'Sites must be created or structurally changed through approved database functions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_floor_structure_write()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_structure_write') then
    raise exception 'Floors must be created or structurally changed through approved database functions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_unit_operational_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not public.internal_write_allowed('rcc.allow_structure_write') then
      raise exception 'Units must be created through approved database functions';
    end if;
  elsif tg_op = 'UPDATE' then
    if (
      old.incident_id is distinct from new.incident_id
      or old.site_id is distinct from new.site_id
      or old.floor_id is distinct from new.floor_id
      or old.unit_number is distinct from new.unit_number
      or old.status_id is distinct from new.status_id
      or old.is_fully_cleared is distinct from new.is_fully_cleared
      or old.is_active is distinct from new.is_active
      or old.inactive_reason is distinct from new.inactive_reason
    )
    and not (
      public.internal_write_allowed('rcc.allow_structure_write')
      or public.internal_write_allowed('rcc.allow_unit_operational_write')
    ) then
      raise exception 'Unit operational fields must be changed through approved database functions';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_person_operational_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and (
      old.incident_id is distinct from new.incident_id
      or old.site_id is distinct from new.site_id
      or old.floor_id is distinct from new.floor_id
      or old.unit_id is distinct from new.unit_id
      or old.current_status_id is distinct from new.current_status_id
      or old.is_merged is distinct from new.is_merged
      or old.merged_into_person_id is distinct from new.merged_into_person_id
    )
    and not public.internal_write_allowed('rcc.allow_person_operational_write')
  then
    raise exception 'Person operational fields must be changed through approved database functions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_internal_event_log_insert()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_event_log_insert') then
    raise exception 'Event logs must be created through approved database functions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_internal_status_history_insert()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_status_history_insert') then
    raise exception 'Person status history must be created through approved database functions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_internal_person_merge_insert()
returns trigger
language plpgsql
as $$
begin
  if not public.internal_write_allowed('rcc.allow_person_merge_insert') then
    raise exception 'Person merge records must be created through approved database functions';
  end if;

  return new;
end;
$$;

create trigger sites_guard_structure_write
  before insert or update on public.sites
  for each row execute function public.guard_site_structure_write();

create trigger floors_guard_structure_write
  before insert or update on public.floors
  for each row execute function public.guard_floor_structure_write();

create trigger units_guard_operational_write
  before insert or update on public.units
  for each row execute function public.guard_unit_operational_write();

create trigger persons_guard_operational_write
  before update on public.persons
  for each row execute function public.guard_person_operational_write();

create trigger event_logs_guard_insert
  before insert on public.event_logs
  for each row execute function public.guard_internal_event_log_insert();

create trigger person_status_history_guard_insert
  before insert on public.person_status_history
  for each row execute function public.guard_internal_status_history_insert();

create trigger person_merges_guard_insert
  before insert on public.person_merges
  for each row execute function public.guard_internal_person_merge_insert();

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
    auth.uid()
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
    auth.uid()
  )
  returning id into v_id;

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_id;
end;
$$;

create or replace function public.create_site_with_structure(
  p_incident_id uuid,
  p_site_number integer,
  p_street text,
  p_house_number text,
  p_floors_count integer,
  p_default_units_per_floor integer,
  p_name text default null,
  p_city text default null,
  p_default_people_per_unit integer default 5,
  p_additional_potential integer default 0,
  p_additional_potential_reason text default null,
  p_status_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_floor_id uuid;
  v_site_status_id uuid;
  v_floor_status_id uuid;
  v_unit_status_id uuid;
  v_initial_potential integer;
  v_floor_number integer;
begin
  perform public.assert_incident_writable(p_incident_id, 'create_site_with_structure');

  if p_site_number <= 0 then
    raise exception 'Site number must be positive';
  end if;

  if p_floors_count < 0 or p_default_units_per_floor < 0 or p_default_people_per_unit < 0 then
    raise exception 'Floor, unit, and people counts cannot be negative';
  end if;

  if coalesce(p_additional_potential, 0) > 0
    and nullif(btrim(p_additional_potential_reason), '') is null
  then
    raise exception 'Additional potential reason is required';
  end if;

  v_site_status_id := coalesce(p_status_id, public.get_status_id('site', 'created', p_incident_id));
  v_floor_status_id := public.get_status_id('floor', 'active', p_incident_id);
  v_unit_status_id := public.get_status_id('unit', 'unknown', p_incident_id);

  if v_site_status_id is null
    or not exists (
      select 1
      from public.status_types st
      where st.id = v_site_status_id
        and st.category = 'site'
        and st.is_active = true
        and (st.incident_id = p_incident_id or st.incident_id is null)
    )
  then
    raise exception 'Valid site status is required';
  end if;

  if v_floor_status_id is null or v_unit_status_id is null then
    raise exception 'Default floor/unit statuses are missing';
  end if;

  v_initial_potential :=
    (p_floors_count * p_default_units_per_floor * p_default_people_per_unit)
    + coalesce(p_additional_potential, 0);

  perform set_config('rcc.allow_structure_write', 'on', true);

  insert into public.sites (
    incident_id,
    site_number,
    name,
    city,
    street,
    house_number,
    floors_count,
    default_units_per_floor,
    default_people_per_unit,
    additional_potential,
    additional_potential_reason,
    initial_potential,
    updated_potential,
    status_id,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    p_site_number,
    p_name,
    p_city,
    p_street,
    p_house_number,
    p_floors_count,
    p_default_units_per_floor,
    p_default_people_per_unit,
    coalesce(p_additional_potential, 0),
    p_additional_potential_reason,
    v_initial_potential,
    v_initial_potential,
    v_site_status_id,
    auth.uid(),
    auth.uid()
  )
  returning id into v_site_id;

  for v_floor_number in 1..p_floors_count loop
    insert into public.floors (
      incident_id,
      site_id,
      floor_number,
      units_count,
      status_id,
      created_by,
      updated_by
    )
    values (
      p_incident_id,
      v_site_id,
      v_floor_number,
      p_default_units_per_floor,
      v_floor_status_id,
      auth.uid(),
      auth.uid()
    )
    returning id into v_floor_id;

    insert into public.units (
      incident_id,
      site_id,
      floor_id,
      unit_number,
      status_id,
      created_by,
      updated_by
    )
    select
      p_incident_id,
      v_site_id,
      v_floor_id,
      unit_idx::text,
      v_unit_status_id,
      auth.uid(),
      auth.uid()
    from generate_series(1, p_default_units_per_floor) as unit_idx;
  end loop;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    p_incident_id,
    'site_created',
    'Site Created',
    null,
    'operational',
    'normal',
    now(),
    v_site_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'site_number', p_site_number,
      'floors_count', p_floors_count,
      'default_units_per_floor', p_default_units_per_floor,
      'default_people_per_unit', p_default_people_per_unit,
      'additional_potential', coalesce(p_additional_potential, 0),
      'initial_potential', v_initial_potential,
      'updated_potential', v_initial_potential
    )
  );

  return v_site_id;
end;
$$;

create or replace function public.reassign_person(
  p_person_id uuid,
  p_site_id uuid default null,
  p_floor_id uuid default null,
  p_unit_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_new_site_id uuid := p_site_id;
  v_new_floor_id uuid := p_floor_id;
  v_new_unit_id uuid := p_unit_id;
  v_unit public.units%rowtype;
  v_floor public.floors%rowtype;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'reassign_person');

  if v_person.is_merged then
    raise exception 'Merged persons cannot be reassigned';
  end if;

  if v_new_unit_id is not null then
    select * into v_unit
    from public.units
    where id = v_new_unit_id
      and is_active = true;

    if not found then
      raise exception 'Target unit does not exist or is inactive';
    end if;

    if v_unit.incident_id <> v_person.incident_id then
      raise exception 'Target unit must belong to same incident as person';
    end if;

    if v_new_floor_id is not null and v_new_floor_id <> v_unit.floor_id then
      raise exception 'Target unit must belong to target floor';
    end if;

    if v_new_site_id is not null and v_new_site_id <> v_unit.site_id then
      raise exception 'Target unit must belong to target site';
    end if;

    v_new_floor_id := v_unit.floor_id;
    v_new_site_id := v_unit.site_id;
  end if;

  if v_new_floor_id is not null then
    select * into v_floor
    from public.floors
    where id = v_new_floor_id
      and is_active = true;

    if not found then
      raise exception 'Target floor does not exist or is inactive';
    end if;

    if v_floor.incident_id <> v_person.incident_id then
      raise exception 'Target floor must belong to same incident as person';
    end if;

    if v_new_site_id is not null and v_new_site_id <> v_floor.site_id then
      raise exception 'Target floor must belong to target site';
    end if;

    v_new_site_id := v_floor.site_id;
  end if;

  if v_new_site_id is not null
    and not exists (
      select 1
      from public.sites s
      where s.id = v_new_site_id
        and s.incident_id = v_person.incident_id
        and s.is_active = true
    )
  then
    raise exception 'Target site does not exist, is inactive, or belongs to another incident';
  end if;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set
    site_id = v_new_site_id,
    floor_id = v_new_floor_id,
    unit_id = v_new_unit_id,
    updated_by = auth.uid()
  where id = p_person_id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_person.incident_id,
    'person_reassigned',
    'Person Reassigned',
    p_reason,
    'operational',
    'normal',
    now(),
    v_new_site_id,
    v_new_floor_id,
    v_new_unit_id,
    p_person_id,
    null,
    null,
    null,
    jsonb_build_object(
      'operational_number', v_person.operational_number,
      'old_location', jsonb_build_object(
        'site_id', v_person.site_id,
        'floor_id', v_person.floor_id,
        'unit_id', v_person.unit_id
      ),
      'new_location', jsonb_build_object(
        'site_id', v_new_site_id,
        'floor_id', v_new_floor_id,
        'unit_id', v_new_unit_id
      )
    )
  );
end;
$$;

create or replace function public.update_person_status(
  p_person_id uuid,
  p_new_status_id uuid,
  p_reported_at timestamptz default now(),
  p_source_type text default null,
  p_source_name text default null,
  p_team_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_previous_status public.status_types%rowtype;
  v_new_status public.status_types%rowtype;
begin
  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'update_person_status');

  if v_person.is_merged then
    raise exception 'Merged persons cannot receive operational status changes';
  end if;

  select * into v_previous_status
  from public.status_types
  where id = v_person.current_status_id;

  select * into v_new_status
  from public.status_types
  where id = p_new_status_id
    and category = 'person'
    and (incident_id = v_person.incident_id or incident_id is null);

  if not found then
    raise exception 'New status % is not valid for this person incident', p_new_status_id;
  end if;

  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

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
    p_person_id,
    v_person.incident_id,
    v_person.current_status_id,
    p_new_status_id,
    coalesce(p_reported_at, now()),
    p_source_type,
    p_source_name,
    p_team_id,
    p_notes,
    auth.uid()
  );

  update public.persons
  set
    current_status_id = p_new_status_id,
    updated_by = auth.uid()
  where id = p_person_id;

  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_person.incident_id,
    'person_status_changed',
    'Person Status Changed',
    p_notes,
    'status_change',
    'normal',
    coalesce(p_reported_at, now()),
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    p_team_id,
    p_source_type,
    p_source_name,
    jsonb_build_object(
      'operational_number', v_person.operational_number,
      'previous_status_key', v_previous_status.status_key,
      'new_status_key', v_new_status.status_key,
      'previous_status_label', v_previous_status.hebrew_label,
      'new_status_label', v_new_status.hebrew_label
    )
  );
end;
$$;

create or replace function public.set_unit_clearance(
  p_unit_id uuid,
  p_is_fully_cleared boolean,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_status_id uuid;
  v_has_open_persons boolean;
  v_role text;
begin
  select * into v_unit
  from public.units
  where id = p_unit_id
  for update;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'set_unit_clearance');

  if not v_unit.is_active then
    raise exception 'Inactive units cannot be cleared or reopened';
  end if;

  v_has_open_persons := public.has_open_persons_in_unit(p_unit_id);
  v_role := public.current_user_incident_role(v_unit.incident_id);

  if p_is_fully_cleared
    and v_has_open_persons
    and v_role <> 'system_administrator'
    and not (
      v_role = 'incident_commander'
      and nullif(btrim(p_override_reason), '') is not null
    )
  then
    raise exception 'Unit cannot be cleared while open persons are linked without commander override reason';
  end if;

  if p_is_fully_cleared then
    v_status_id := public.get_status_id('unit', 'fully_cleared', v_unit.incident_id);
  else
    v_status_id := public.get_status_id('unit', 'active_investigation', v_unit.incident_id);
  end if;

  perform set_config('rcc.allow_unit_operational_write', 'on', true);

  update public.units
  set
    is_fully_cleared = p_is_fully_cleared,
    status_id = coalesce(v_status_id, status_id),
    updated_by = auth.uid()
  where id = p_unit_id;

  perform set_config('rcc.allow_unit_operational_write', 'off', true);

  perform public.create_event_log(
    v_unit.incident_id,
    case when p_is_fully_cleared then 'unit_cleared' else 'unit_clearance_removed' end,
    case when p_is_fully_cleared then 'Unit Cleared' else 'Unit Clearance Removed' end,
    case
      when p_is_fully_cleared and v_has_open_persons
      then 'Commander override: ' || p_override_reason
      else null
    end,
    'clearance',
    case when p_is_fully_cleared and v_has_open_persons then 'important' else 'normal' end,
    now(),
    v_unit.site_id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_is_fully_cleared', v_unit.is_fully_cleared,
      'new_is_fully_cleared', p_is_fully_cleared,
      'open_persons_override', p_is_fully_cleared and v_has_open_persons,
      'override_reason', p_override_reason
    )
  );
end;
$$;

create or replace function public.set_floor_unit_count(
  p_floor_id uuid,
  p_units_count integer,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor public.floors%rowtype;
  v_current_count integer;
  v_unit_status_id uuid;
begin
  if p_units_count < 0 then
    raise exception 'Unit count cannot be negative';
  end if;

  select * into v_floor
  from public.floors
  where id = p_floor_id
  for update;

  if not found then
    raise exception 'Floor % does not exist', p_floor_id;
  end if;

  perform public.assert_incident_writable(v_floor.incident_id, 'set_floor_unit_count');

  if not v_floor.is_active then
    raise exception 'Inactive floors cannot have unit counts changed';
  end if;

  select count(*)::integer into v_current_count
  from public.units
  where floor_id = p_floor_id
    and is_active = true;

  v_unit_status_id := public.get_status_id('unit', 'inactive', v_floor.incident_id);

  perform set_config('rcc.allow_structure_write', 'on', true);

  if p_units_count < v_current_count then
    with ranked_units as (
      select
        id,
        row_number() over (order by unit_number desc, created_at desc) as rn
      from public.units
      where floor_id = p_floor_id
        and is_active = true
    )
    update public.units u
    set
      is_active = false,
      inactive_reason = coalesce(nullif(btrim(p_reason), ''), 'Floor unit count reduced'),
      status_id = coalesce(v_unit_status_id, u.status_id),
      updated_by = auth.uid()
    from ranked_units ru
    where u.id = ru.id
      and ru.rn <= (v_current_count - p_units_count);
  end if;

  update public.floors
  set
    units_count = p_units_count,
    updated_by = auth.uid()
  where id = p_floor_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_floor.incident_id,
    'floor_unit_count_changed',
    'Floor Unit Count Changed',
    p_reason,
    'operational',
    'normal',
    now(),
    v_floor.site_id,
    v_floor.id,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_units_count', v_current_count,
      'new_units_count', p_units_count,
      'inactive_units_created_by_reduction', greatest(v_current_count - p_units_count, 0)
    )
  );
end;
$$;

create or replace function public.merge_persons(
  p_primary_person_id uuid,
  p_merged_person_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary public.persons%rowtype;
  v_merged public.persons%rowtype;
  v_duplicate_status_id uuid;
  v_merge_id uuid;
begin
  if p_primary_person_id = p_merged_person_id then
    raise exception 'Cannot merge a person into itself';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'Merge reason is required';
  end if;

  select * into v_primary
  from public.persons
  where id = p_primary_person_id
  for update;

  if not found then
    raise exception 'Primary person % does not exist', p_primary_person_id;
  end if;

  select * into v_merged
  from public.persons
  where id = p_merged_person_id
  for update;

  if not found then
    raise exception 'Merged person % does not exist', p_merged_person_id;
  end if;

  if v_primary.incident_id <> v_merged.incident_id then
    raise exception 'Persons must belong to the same incident';
  end if;

  if v_primary.is_merged or v_merged.is_merged then
    raise exception 'Cannot merge persons that are already marked as merged';
  end if;

  if exists (
    select 1
    from public.person_merges pm
    where pm.incident_id = v_primary.incident_id
      and (
        pm.merged_person_id in (v_primary.id, v_merged.id)
        or pm.primary_person_id = v_merged.id
      )
  ) then
    raise exception 'One of these persons already participates in a completed merge';
  end if;

  if not public.can_command_incident(v_primary.incident_id) then
    raise exception 'User is not allowed to merge persons for this incident';
  end if;

  perform public.assert_incident_writable(v_primary.incident_id, 'merge_persons');

  v_duplicate_status_id := public.get_status_id('person', 'duplicate_cancelled', v_primary.incident_id);

  if v_duplicate_status_id is null then
    raise exception 'Duplicate/cancelled status is missing';
  end if;

  perform set_config('rcc.allow_person_merge_insert', 'on', true);
  perform set_config('rcc.allow_status_history_insert', 'on', true);
  perform set_config('rcc.allow_person_operational_write', 'on', true);

  insert into public.person_merges (
    incident_id,
    primary_person_id,
    merged_person_id,
    primary_operational_number,
    merged_operational_number,
    reason,
    merged_by
  )
  values (
    v_primary.incident_id,
    v_primary.id,
    v_merged.id,
    v_primary.operational_number,
    v_merged.operational_number,
    p_reason,
    auth.uid()
  )
  returning id into v_merge_id;

  insert into public.person_status_history (
    person_id,
    incident_id,
    previous_status_id,
    new_status_id,
    reported_at,
    source_type,
    source_name,
    notes,
    created_by
  )
  values (
    v_merged.id,
    v_merged.incident_id,
    v_merged.current_status_id,
    v_duplicate_status_id,
    now(),
    'system',
    'merge_persons',
    p_reason,
    auth.uid()
  );

  update public.persons
  set
    is_merged = true,
    merged_into_person_id = v_primary.id,
    current_status_id = v_duplicate_status_id,
    updated_by = auth.uid()
  where id = v_merged.id;

  perform set_config('rcc.allow_person_merge_insert', 'off', true);
  perform set_config('rcc.allow_status_history_insert', 'off', true);
  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_primary.incident_id,
    'person_merged',
    'Person Merge',
    p_reason,
    'merge',
    'important',
    now(),
    coalesce(v_primary.site_id, v_merged.site_id),
    coalesce(v_primary.floor_id, v_merged.floor_id),
    coalesce(v_primary.unit_id, v_merged.unit_id),
    v_primary.id,
    null,
    null,
    null,
    jsonb_build_object(
      'merge_id', v_merge_id,
      'primary_person_id', v_primary.id,
      'merged_person_id', v_merged.id,
      'primary_operational_number', v_primary.operational_number,
      'merged_operational_number', v_merged.operational_number,
      'merged_previous_status_id', v_merged.current_status_id,
      'merged_new_status_id', v_duplicate_status_id
    )
  );

  return v_merge_id;
end;
$$;

comment on function public.create_site_with_structure(uuid, integer, text, text, integer, integer, text, text, integer, integer, text, uuid)
  is 'Creates a Site with generated Floors and Units, calculates potential, and writes a Site Created EventLog.';

comment on function public.reassign_person(uuid, uuid, uuid, uuid, text)
  is 'Reassigns a Person to a validated Site/Floor/Unit and writes old/new location metadata to EventLog.';

comment on function public.merge_persons(uuid, uuid, text)
  is 'Merges a duplicate Person into a primary Person, preserves merge record/history, marks duplicate/cancelled, and writes EventLog.';
