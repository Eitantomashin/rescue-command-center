-- Phase 2: incident vehicle movement rosters ("שבצ\"קים").
-- Database infrastructure and server-side business logic only. No operational UI.

create table if not exists public.incident_vehicle_rosters (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  main_sequence integer not null check (main_sequence > 0),
  clone_suffix_index integer not null default 0 check (clone_suffix_index >= 0),
  root_roster_id uuid references public.incident_vehicle_rosters(id),
  source_roster_id uuid references public.incident_vehicle_rosters(id),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'en_route', 'arrived', 'cancelled')),
  movement_type text not null default 'outbound_to_incident'
    check (movement_type in ('outbound_to_incident', 'return_to_unit', 'between_sites', 'exercise', 'other')),
  origin_text text,
  destination_text text,
  origin_site_id uuid references public.sites(id),
  destination_site_id uuid references public.sites(id),
  planned_departure_at timestamptz,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  vehicle_license_plate text,
  normalized_license_plate text,
  vehicle_description text,
  vehicle_type text,
  vehicle_notes text,
  operational_notes text,
  ready_at timestamptz,
  ready_by uuid references public.profiles(id),
  departed_at timestamptz,
  departed_by uuid references public.profiles(id),
  arrived_at timestamptz,
  arrived_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, main_sequence, clone_suffix_index),
  constraint incident_vehicle_rosters_root_for_clone check (
    (clone_suffix_index = 0 and root_roster_id is null and source_roster_id is null)
    or
    (clone_suffix_index > 0 and root_roster_id is not null and source_roster_id is not null)
  ),
  constraint incident_vehicle_rosters_timestamp_order check (
    (actual_departure_at is null or actual_arrival_at is null or actual_arrival_at >= actual_departure_at)
  ),
  constraint incident_vehicle_rosters_status_timestamps check (
    (status <> 'ready' or ready_at is not null)
    and (status <> 'en_route' or departed_at is not null)
    and (status <> 'arrived' or arrived_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  )
);

create unique index if not exists incident_vehicle_rosters_active_vehicle_idx
  on public.incident_vehicle_rosters (incident_id, normalized_license_plate)
  where status in ('ready', 'en_route') and normalized_license_plate is not null;

create index if not exists incident_vehicle_rosters_incident_sort_idx
  on public.incident_vehicle_rosters (incident_id, main_sequence, clone_suffix_index, created_at);

create index if not exists incident_vehicle_rosters_incident_status_idx
  on public.incident_vehicle_rosters (incident_id, status, updated_at desc);

create index if not exists incident_vehicle_rosters_root_idx
  on public.incident_vehicle_rosters (incident_id, root_roster_id, clone_suffix_index);

drop trigger if exists incident_vehicle_rosters_set_updated_at on public.incident_vehicle_rosters;
create trigger incident_vehicle_rosters_set_updated_at
  before update on public.incident_vehicle_rosters
  for each row execute function public.set_updated_at();

alter table public.incident_vehicle_rosters enable row level security;

drop policy if exists incident_vehicle_rosters_member_select on public.incident_vehicle_rosters;
create policy incident_vehicle_rosters_member_select
  on public.incident_vehicle_rosters for select
  using (public.can_read_incident(incident_id));

create table if not exists public.incident_roster_external_people (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  full_name text not null,
  mobile_phone text not null,
  normalized_mobile_phone text not null,
  external_role text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, normalized_mobile_phone)
);

create index if not exists incident_roster_external_people_incident_idx
  on public.incident_roster_external_people (incident_id, is_active, full_name);

drop trigger if exists incident_roster_external_people_set_updated_at on public.incident_roster_external_people;
create trigger incident_roster_external_people_set_updated_at
  before update on public.incident_roster_external_people
  for each row execute function public.set_updated_at();

alter table public.incident_roster_external_people enable row level security;

drop policy if exists incident_roster_external_people_member_select on public.incident_roster_external_people;
create policy incident_roster_external_people_member_select
  on public.incident_roster_external_people for select
  using (public.can_read_incident(incident_id));

create table if not exists public.incident_roster_participants (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  roster_id uuid not null references public.incident_vehicle_rosters(id) on delete cascade,
  source_type text not null check (source_type in ('unit_personnel', 'manual_personnel', 'external_person')),
  unit_personnel_id uuid references public.unit_personnel(id),
  manual_personnel_id uuid references public.incident_manual_personnel(id),
  external_person_id uuid references public.incident_roster_external_people(id),
  participant_key text not null,
  display_name_snapshot text not null,
  normalized_mobile_phone text,
  is_driver boolean not null default false,
  is_movement_commander boolean not null default false,
  is_passenger boolean not null default true,
  notes text,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint incident_roster_participant_one_source check (
    (source_type = 'unit_personnel' and unit_personnel_id is not null and manual_personnel_id is null and external_person_id is null)
    or
    (source_type = 'manual_personnel' and unit_personnel_id is null and manual_personnel_id is not null and external_person_id is null)
    or
    (source_type = 'external_person' and unit_personnel_id is null and manual_personnel_id is null and external_person_id is not null)
  ),
  constraint incident_roster_participant_has_role check (
    is_driver or is_movement_commander or is_passenger
  ),
  unique (roster_id, participant_key)
);

create index if not exists incident_roster_participants_incident_idx
  on public.incident_roster_participants (incident_id, roster_id);

create index if not exists incident_roster_participants_key_idx
  on public.incident_roster_participants (incident_id, participant_key);

drop trigger if exists incident_roster_participants_set_updated_at on public.incident_roster_participants;
create trigger incident_roster_participants_set_updated_at
  before update on public.incident_roster_participants
  for each row execute function public.set_updated_at();

alter table public.incident_roster_participants enable row level security;

drop policy if exists incident_roster_participants_member_select on public.incident_roster_participants;
create policy incident_roster_participants_member_select
  on public.incident_roster_participants for select
  using (public.can_read_incident(incident_id));

create or replace function public.validate_incident_vehicle_roster_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root_incident_id uuid;
  v_root_suffix integer;
  v_source_incident_id uuid;
  v_origin_incident_id uuid;
  v_destination_incident_id uuid;
begin
  if new.root_roster_id is not null then
    select incident_id, clone_suffix_index into v_root_incident_id, v_root_suffix
    from public.incident_vehicle_rosters
    where id = new.root_roster_id;

    if v_root_incident_id is distinct from new.incident_id then
      raise exception 'Root roster must belong to the same incident';
    end if;

    if coalesce(v_root_suffix, -1) <> 0 then
      raise exception 'Root roster must be the independent root roster';
    end if;
  end if;

  if new.source_roster_id is not null then
    select incident_id into v_source_incident_id
    from public.incident_vehicle_rosters
    where id = new.source_roster_id;

    if v_source_incident_id is distinct from new.incident_id then
      raise exception 'Source roster must belong to the same incident';
    end if;
  end if;

  if new.origin_site_id is not null then
    select incident_id into v_origin_incident_id
    from public.sites
    where id = new.origin_site_id;

    if v_origin_incident_id is distinct from new.incident_id then
      raise exception 'Origin site must belong to the same incident';
    end if;
  end if;

  if new.destination_site_id is not null then
    select incident_id into v_destination_incident_id
    from public.sites
    where id = new.destination_site_id;

    if v_destination_incident_id is distinct from new.incident_id then
      raise exception 'Destination site must belong to the same incident';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists incident_vehicle_rosters_validate_refs on public.incident_vehicle_rosters;
create trigger incident_vehicle_rosters_validate_refs
  before insert or update on public.incident_vehicle_rosters
  for each row execute function public.validate_incident_vehicle_roster_refs();

create or replace function public.validate_incident_roster_participant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster_incident_id uuid;
  v_manual_incident_id uuid;
  v_external_incident_id uuid;
  v_unit_active boolean;
  v_expected_key text;
begin
  select incident_id into v_roster_incident_id
  from public.incident_vehicle_rosters
  where id = new.roster_id;

  if v_roster_incident_id is distinct from new.incident_id then
    raise exception 'Roster participant must belong to the same incident as the roster';
  end if;

  if new.source_type = 'unit_personnel' then
    select is_active into v_unit_active
    from public.unit_personnel
    where id = new.unit_personnel_id;

    if coalesce(v_unit_active, false) is not true then
      raise exception 'Unit personnel participant must be active';
    end if;
  elsif new.source_type = 'manual_personnel' then
    select incident_id into v_manual_incident_id
    from public.incident_manual_personnel
    where id = new.manual_personnel_id
      and is_active;

    if v_manual_incident_id is distinct from new.incident_id then
      raise exception 'Manual participant must belong to the same incident';
    end if;
  elsif new.source_type = 'external_person' then
    select incident_id into v_external_incident_id
    from public.incident_roster_external_people
    where id = new.external_person_id
      and is_active;

    if v_external_incident_id is distinct from new.incident_id then
      raise exception 'External participant must belong to the same incident';
    end if;
  end if;

  v_expected_key := public.incident_roster_participant_key(
    new.source_type,
    new.unit_personnel_id,
    new.manual_personnel_id,
    new.external_person_id
  );

  if new.participant_key is distinct from v_expected_key then
    raise exception 'Participant key does not match participant source';
  end if;

  return new;
end;
$$;

drop trigger if exists incident_roster_participants_validate_refs on public.incident_roster_participants;
create trigger incident_roster_participants_validate_refs
  before insert or update on public.incident_roster_participants
  for each row execute function public.validate_incident_roster_participant_refs();

create or replace function public.normalize_vehicle_license_plate(p_license_plate text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text;
begin
  v_value := upper(regexp_replace(coalesce(p_license_plate, ''), '[^0-9A-Z]+', '', 'g'));
  return nullif(v_value, '');
end;
$$;

create or replace function public.incident_roster_hebrew_suffix(p_suffix_index integer)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_letters text[] := array[
    U&'\05D0', U&'\05D1', U&'\05D2', U&'\05D3', U&'\05D4', U&'\05D5',
    U&'\05D6', U&'\05D7', U&'\05D8', U&'\05D9', U&'\05DB', U&'\05DC',
    U&'\05DE', U&'\05E0', U&'\05E1', U&'\05E2', U&'\05E4', U&'\05E6',
    U&'\05E7', U&'\05E8', U&'\05E9', U&'\05EA'
  ];
  v_base integer := array_length(v_letters, 1);
  v_n integer := coalesce(p_suffix_index, 0);
  v_result text := '';
begin
  if v_n < 0 then
    raise exception 'Suffix index must not be negative';
  end if;

  if v_n = 0 then
    return '';
  end if;

  while v_n > 0 loop
    v_result := v_letters[((v_n - 1) % v_base) + 1] || v_result;
    v_n := (v_n - 1) / v_base;
  end loop;

  return v_result || U&'\05F3';
end;
$$;

create or replace function public.incident_roster_display_number(
  p_main_sequence integer,
  p_clone_suffix_index integer default 0
)
returns text
language sql
immutable
set search_path = public
as $$
  select lpad(p_main_sequence::text, 2, '0') || public.incident_roster_hebrew_suffix(coalesce(p_clone_suffix_index, 0))
$$;

create or replace function public.incident_roster_participant_key(
  p_source_type text,
  p_unit_personnel_id uuid default null,
  p_manual_personnel_id uuid default null,
  p_external_person_id uuid default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_source_type
    when 'unit_personnel' then 'unit:' || p_unit_personnel_id::text
    when 'manual_personnel' then 'manual:' || p_manual_personnel_id::text
    when 'external_person' then 'external:' || p_external_person_id::text
    else null
  end
$$;

create or replace function public.log_incident_roster_event_internal(
  p_incident_id uuid,
  p_roster_id uuid,
  p_log_type text,
  p_title text,
  p_description text,
  p_importance text default 'normal',
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
    p_log_type,
    'administrative',
    now(),
    'system',
    'מערכת',
    p_title,
    p_description,
    coalesce(p_importance, 'normal'),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('roster_id', p_roster_id),
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

revoke all on function public.log_incident_roster_event_internal(uuid, uuid, text, text, text, text, jsonb) from public;

create or replace function public.assert_incident_roster_mutable(
  p_incident_id uuid,
  p_roster_id uuid,
  p_allow_ready boolean default false
)
returns public.incident_vehicle_rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
begin
  perform public.assert_edit_personnel(p_incident_id);

  select * into v_roster
  from public.incident_vehicle_rosters
  where id = p_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Roster not found';
  end if;

  if v_roster.status <> 'draft' and not (p_allow_ready and v_roster.status = 'ready') then
    raise exception 'Roster is not editable in status %', v_roster.status;
  end if;

  return v_roster;
end;
$$;

revoke all on function public.assert_incident_roster_mutable(uuid, uuid, boolean) from public;

create or replace function public.create_incident_vehicle_roster(
  p_incident_id uuid,
  p_movement_type text default 'outbound_to_incident',
  p_origin_text text default null,
  p_destination_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence integer;
  v_id uuid;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select coalesce(max(main_sequence), 0) + 1 into v_sequence
  from public.incident_vehicle_rosters
  where incident_id = p_incident_id
    and clone_suffix_index = 0;

  insert into public.incident_vehicle_rosters (
    incident_id,
    main_sequence,
    movement_type,
    origin_text,
    destination_text,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_sequence,
    coalesce(p_movement_type, 'outbound_to_incident'),
    nullif(btrim(coalesce(p_origin_text, '')), ''),
    nullif(btrim(coalesce(p_destination_text, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_id,
    'incident_vehicle_roster_created',
    'שבצ"ק נוצר',
    'נוצר שבצ"ק ' || public.incident_roster_display_number(v_sequence, 0) || '.',
    'important',
    jsonb_build_object('display_number', public.incident_roster_display_number(v_sequence, 0))
  );

  return jsonb_build_object(
    'success', true,
    'roster_id', v_id,
    'display_number', public.incident_roster_display_number(v_sequence, 0)
  );
end;
$$;

create or replace function public.update_incident_vehicle_roster_draft(
  p_incident_id uuid,
  p_roster_id uuid,
  p_movement_type text default null,
  p_origin_text text default null,
  p_destination_text text default null,
  p_origin_site_id uuid default null,
  p_destination_site_id uuid default null,
  p_planned_departure_at timestamptz default null,
  p_vehicle_license_plate text default null,
  p_vehicle_description text default null,
  p_vehicle_type text default null,
  p_vehicle_notes text default null,
  p_operational_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_normalized_plate text := public.normalize_vehicle_license_plate(p_vehicle_license_plate);
begin
  v_roster := public.assert_incident_roster_mutable(p_incident_id, p_roster_id, false);

  if p_movement_type is not null
    and p_movement_type not in ('outbound_to_incident', 'return_to_unit', 'between_sites', 'exercise', 'other')
  then
    raise exception 'Invalid movement type';
  end if;

  if p_origin_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_origin_site_id and s.incident_id = p_incident_id
  ) then
    raise exception 'Origin site does not belong to this incident';
  end if;

  if p_destination_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_destination_site_id and s.incident_id = p_incident_id
  ) then
    raise exception 'Destination site does not belong to this incident';
  end if;

  update public.incident_vehicle_rosters
  set movement_type = coalesce(p_movement_type, movement_type),
      origin_text = nullif(btrim(coalesce(p_origin_text, '')), ''),
      destination_text = nullif(btrim(coalesce(p_destination_text, '')), ''),
      origin_site_id = p_origin_site_id,
      destination_site_id = p_destination_site_id,
      planned_departure_at = p_planned_departure_at,
      vehicle_license_plate = nullif(btrim(coalesce(p_vehicle_license_plate, '')), ''),
      normalized_license_plate = v_normalized_plate,
      vehicle_description = nullif(btrim(coalesce(p_vehicle_description, '')), ''),
      vehicle_type = nullif(btrim(coalesce(p_vehicle_type, '')), ''),
      vehicle_notes = nullif(btrim(coalesce(p_vehicle_notes, '')), ''),
      operational_notes = nullif(btrim(coalesce(p_operational_notes, '')), ''),
      updated_by = public.current_actor_id()
  where id = p_roster_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    p_roster_id,
    'incident_vehicle_roster_edited',
    'שבצ"ק עודכן',
    'פרטי שבצ"ק ' || public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index) || ' עודכנו.',
    'normal',
    jsonb_build_object('display_number', public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index))
  );

  return jsonb_build_object('success', true, 'roster_id', p_roster_id);
end;
$$;

create or replace function public.create_or_reuse_incident_roster_external_person(
  p_incident_id uuid,
  p_full_name text,
  p_mobile_phone text,
  p_external_role text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_mobile text := nullif(btrim(coalesce(p_mobile_phone, '')), '');
  v_normalized text := public.normalize_incident_mobile_phone(p_mobile_phone);
  v_existing_manual public.incident_manual_personnel%rowtype;
  v_existing_external public.incident_roster_external_people%rowtype;
  v_existing_unit public.unit_personnel%rowtype;
  v_id uuid;
begin
  perform public.assert_edit_personnel(p_incident_id);

  if v_full_name is null then
    raise exception 'Full name is required';
  end if;

  if v_mobile is null or v_normalized is null then
    raise exception 'Mobile phone is required';
  end if;

  select * into v_existing_manual
  from public.incident_manual_personnel
  where incident_id = p_incident_id
    and normalized_mobile_phone = v_normalized
    and is_active
  limit 1;

  if found then
    return jsonb_build_object(
      'success', false,
      'code', 'duplicate_manual_personnel',
      'source_type', 'manual_personnel',
      'existing_id', v_existing_manual.id,
      'display_name', v_existing_manual.first_name || ' ' || v_existing_manual.last_name
    );
  end if;

  select * into v_existing_unit
  from public.unit_personnel
  where public.normalize_incident_mobile_phone(mobile_phone) = v_normalized
    and is_active
  limit 1;

  if found then
    return jsonb_build_object(
      'success', false,
      'code', 'duplicate_unit_personnel',
      'source_type', 'unit_personnel',
      'existing_id', v_existing_unit.id,
      'display_name', v_existing_unit.first_name || ' ' || v_existing_unit.last_name
    );
  end if;

  select * into v_existing_external
  from public.incident_roster_external_people
  where incident_id = p_incident_id
    and normalized_mobile_phone = v_normalized;

  if found then
    return jsonb_build_object(
      'success', true,
      'status', 'reused',
      'external_person_id', v_existing_external.id,
      'display_name', v_existing_external.full_name
    );
  end if;

  insert into public.incident_roster_external_people (
    incident_id,
    full_name,
    mobile_phone,
    normalized_mobile_phone,
    external_role,
    notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_full_name,
    v_mobile,
    v_normalized,
    nullif(btrim(coalesce(p_external_role, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    null,
    'incident_roster_external_person_created',
    'גורם חיצוני נוצר לשבצ"ק',
    v_full_name || ' נוצר כגורם חיצוני לשבצ"ק בלבד.',
    'normal',
    jsonb_build_object('external_person_id', v_id)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'created',
    'external_person_id', v_id,
    'display_name', v_full_name
  );
end;
$$;

create or replace function public.add_incident_roster_participant(
  p_incident_id uuid,
  p_roster_id uuid,
  p_source_type text,
  p_unit_personnel_id uuid default null,
  p_manual_personnel_id uuid default null,
  p_external_person_id uuid default null,
  p_is_driver boolean default false,
  p_is_movement_commander boolean default false,
  p_is_passenger boolean default true,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_key text;
  v_name text;
  v_phone text;
  v_id uuid;
begin
  v_roster := public.assert_incident_roster_mutable(p_incident_id, p_roster_id, false);

  if not (coalesce(p_is_driver, false) or coalesce(p_is_movement_commander, false) or coalesce(p_is_passenger, false)) then
    raise exception 'At least one roster role is required';
  end if;

  if p_source_type = 'unit_personnel' then
    select first_name || ' ' || last_name, mobile_phone into v_name, v_phone
    from public.unit_personnel
    where id = p_unit_personnel_id
      and is_active;
  elsif p_source_type = 'manual_personnel' then
    select first_name || ' ' || last_name, mobile_phone into v_name, v_phone
    from public.incident_manual_personnel
    where id = p_manual_personnel_id
      and incident_id = p_incident_id
      and is_active;
  elsif p_source_type = 'external_person' then
    select full_name, mobile_phone into v_name, v_phone
    from public.incident_roster_external_people
    where id = p_external_person_id
      and incident_id = p_incident_id
      and is_active;
  else
    raise exception 'Invalid participant source type';
  end if;

  if v_name is null then
    raise exception 'Participant source was not found or does not belong to this incident';
  end if;

  v_key := public.incident_roster_participant_key(p_source_type, p_unit_personnel_id, p_manual_personnel_id, p_external_person_id);

  insert into public.incident_roster_participants (
    incident_id,
    roster_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    added_by,
    updated_by
  )
  values (
    p_incident_id,
    p_roster_id,
    p_source_type,
    p_unit_personnel_id,
    p_manual_personnel_id,
    p_external_person_id,
    v_key,
    v_name,
    public.normalize_incident_mobile_phone(v_phone),
    coalesce(p_is_driver, false),
    coalesce(p_is_movement_commander, false),
    coalesce(p_is_passenger, true),
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.current_actor_id(),
    public.current_actor_id()
  )
  on conflict (roster_id, participant_key)
  do update set
    is_driver = incident_roster_participants.is_driver or excluded.is_driver,
    is_movement_commander = incident_roster_participants.is_movement_commander or excluded.is_movement_commander,
    is_passenger = incident_roster_participants.is_passenger or excluded.is_passenger,
    notes = coalesce(excluded.notes, incident_roster_participants.notes),
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into v_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    p_roster_id,
    'incident_roster_participant_added',
    'משתתף נוסף לשבצ"ק',
    v_name || ' נוסף לשבצ"ק ' || public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index) || '.',
    'normal',
    jsonb_build_object('participant_id', v_id, 'participant_key', v_key, 'display_number', public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index))
  );

  return jsonb_build_object('success', true, 'participant_id', v_id);
end;
$$;

create or replace function public.update_incident_roster_participant_roles(
  p_incident_id uuid,
  p_participant_id uuid,
  p_is_driver boolean,
  p_is_movement_commander boolean,
  p_is_passenger boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.incident_roster_participants%rowtype;
  v_roster public.incident_vehicle_rosters%rowtype;
begin
  select * into v_participant
  from public.incident_roster_participants
  where id = p_participant_id
    and incident_id = p_incident_id;

  if not found then
    raise exception 'Participant not found';
  end if;

  v_roster := public.assert_incident_roster_mutable(p_incident_id, v_participant.roster_id, false);

  if not (coalesce(p_is_driver, false) or coalesce(p_is_movement_commander, false) or coalesce(p_is_passenger, false)) then
    raise exception 'At least one roster role is required';
  end if;

  update public.incident_roster_participants
  set is_driver = coalesce(p_is_driver, false),
      is_movement_commander = coalesce(p_is_movement_commander, false),
      is_passenger = coalesce(p_is_passenger, false),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_participant_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_participant.roster_id,
    'incident_roster_participant_roles_changed',
    'תפקידי משתתף בשבצ"ק עודכנו',
    v_participant.display_name_snapshot || ' עודכן בשבצ"ק.',
    'normal',
    jsonb_build_object('participant_id', p_participant_id)
  );

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.remove_incident_roster_participant(
  p_incident_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.incident_roster_participants%rowtype;
  v_roster public.incident_vehicle_rosters%rowtype;
begin
  select * into v_participant
  from public.incident_roster_participants
  where id = p_participant_id
    and incident_id = p_incident_id;

  if not found then
    raise exception 'Participant not found';
  end if;

  v_roster := public.assert_incident_roster_mutable(p_incident_id, v_participant.roster_id, false);

  delete from public.incident_roster_participants
  where id = p_participant_id;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_participant.roster_id,
    'incident_roster_participant_removed',
    'משתתף הוסר משבצ"ק',
    v_participant.display_name_snapshot || ' הוסר משבצ"ק ' || public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index) || '.',
    'important',
    jsonb_build_object('participant_key', v_participant.participant_key)
  );

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.validate_incident_roster_ready(
  p_incident_id uuid,
  p_roster_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_missing text[] := array[]::text[];
  v_conflict record;
begin
  select * into v_roster
  from public.incident_vehicle_rosters
  where id = p_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Roster not found';
  end if;

  if nullif(btrim(coalesce(v_roster.vehicle_license_plate, '')), '') is null
    or v_roster.normalized_license_plate is null
  then
    v_missing := array_append(v_missing, 'vehicle_license_plate');
  end if;

  if nullif(btrim(coalesce(v_roster.vehicle_description, '')), '') is null then
    v_missing := array_append(v_missing, 'vehicle_description');
  end if;

  if nullif(btrim(coalesce(v_roster.origin_text, '')), '') is null then
    v_missing := array_append(v_missing, 'origin');
  end if;

  if nullif(btrim(coalesce(v_roster.destination_text, '')), '') is null then
    v_missing := array_append(v_missing, 'destination');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
  ) then
    v_missing := array_append(v_missing, 'participants');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
      and p.is_driver
  ) then
    v_missing := array_append(v_missing, 'driver');
  end if;

  if not exists (
    select 1 from public.incident_roster_participants p
    where p.roster_id = p_roster_id
      and p.is_movement_commander
  ) then
    v_missing := array_append(v_missing, 'movement_commander');
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('valid', false, 'code', 'missing_required_fields', 'missing', to_jsonb(v_missing));
  end if;

  select r.id, public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number
  into v_conflict
  from public.incident_vehicle_rosters r
  where r.incident_id = p_incident_id
    and r.id <> p_roster_id
    and r.status in ('ready', 'en_route')
    and r.normalized_license_plate = v_roster.normalized_license_plate
  limit 1;

  if found then
    return jsonb_build_object(
      'valid', false,
      'code', 'vehicle_conflict',
      'conflict_type', 'vehicle',
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'vehicle_license_plate', v_roster.vehicle_license_plate
    );
  end if;

  select r.id,
         public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number,
         p.display_name_snapshot as person_name
  into v_conflict
  from public.incident_roster_participants p
  join public.incident_roster_participants current_p
    on current_p.roster_id = p_roster_id
   and current_p.participant_key = p.participant_key
  join public.incident_vehicle_rosters r
    on r.id = p.roster_id
  where r.incident_id = p_incident_id
    and r.id <> p_roster_id
    and r.status in ('ready', 'en_route')
  limit 1;

  if found then
    return jsonb_build_object(
      'valid', false,
      'code', 'person_conflict',
      'conflict_type', 'person',
      'conflicting_roster_id', v_conflict.id,
      'conflicting_roster_display_number', v_conflict.display_number,
      'person_name', v_conflict.person_name
    );
  end if;

  return jsonb_build_object('valid', true);
end;
$$;

revoke all on function public.validate_incident_roster_ready(uuid, uuid) from public;

create or replace function public.transition_incident_vehicle_roster(
  p_incident_id uuid,
  p_roster_id uuid,
  p_target_status text,
  p_operational_timestamp timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.incident_vehicle_rosters%rowtype;
  v_validation jsonb;
  v_now timestamptz := coalesce(p_operational_timestamp, now());
  v_display text;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select * into v_roster
  from public.incident_vehicle_rosters
  where id = p_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Roster not found';
  end if;

  v_display := public.incident_roster_display_number(v_roster.main_sequence, v_roster.clone_suffix_index);

  if p_target_status = 'ready' then
    if v_roster.status <> 'draft' then
      return jsonb_build_object('success', false, 'code', 'invalid_transition', 'from_status', v_roster.status, 'to_status', p_target_status);
    end if;

    v_validation := public.validate_incident_roster_ready(p_incident_id, p_roster_id);
    if coalesce((v_validation ->> 'valid')::boolean, false) is not true then
      perform public.log_incident_roster_event_internal(
        p_incident_id,
        p_roster_id,
        'incident_vehicle_roster_allocation_conflict',
        'שיבוץ שבצ"ק נדחה',
        'לא ניתן להפוך את שבצ"ק ' || v_display || ' למוכן ליציאה.',
        'important',
        v_validation || jsonb_build_object('display_number', v_display)
      );
      return v_validation || jsonb_build_object('success', false);
    end if;

    update public.incident_vehicle_rosters
    set status = 'ready',
        ready_at = v_now,
        ready_by = public.current_actor_id(),
        updated_by = public.current_actor_id()
    where id = p_roster_id;
  elsif p_target_status = 'draft' then
    if v_roster.status <> 'ready' then
      return jsonb_build_object('success', false, 'code', 'invalid_transition', 'from_status', v_roster.status, 'to_status', p_target_status);
    end if;

    update public.incident_vehicle_rosters
    set status = 'draft',
        ready_at = null,
        ready_by = null,
        updated_by = public.current_actor_id()
    where id = p_roster_id;
  elsif p_target_status = 'en_route' then
    if v_roster.status <> 'ready' then
      return jsonb_build_object('success', false, 'code', 'invalid_transition', 'from_status', v_roster.status, 'to_status', p_target_status);
    end if;

    update public.incident_vehicle_rosters
    set status = 'en_route',
        departed_at = v_now,
        departed_by = public.current_actor_id(),
        actual_departure_at = v_now,
        updated_by = public.current_actor_id()
    where id = p_roster_id;
  elsif p_target_status = 'arrived' then
    if v_roster.status <> 'en_route' then
      return jsonb_build_object('success', false, 'code', 'invalid_transition', 'from_status', v_roster.status, 'to_status', p_target_status);
    end if;

    update public.incident_vehicle_rosters
    set status = 'arrived',
        arrived_at = v_now,
        arrived_by = public.current_actor_id(),
        actual_arrival_at = v_now,
        updated_by = public.current_actor_id()
    where id = p_roster_id;
  elsif p_target_status = 'cancelled' then
    if v_roster.status not in ('draft', 'ready') then
      return jsonb_build_object('success', false, 'code', 'invalid_transition', 'from_status', v_roster.status, 'to_status', p_target_status);
    end if;

    update public.incident_vehicle_rosters
    set status = 'cancelled',
        cancelled_at = v_now,
        cancelled_by = public.current_actor_id(),
        cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        updated_by = public.current_actor_id()
    where id = p_roster_id;
  else
    raise exception 'Invalid target status';
  end if;

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    p_roster_id,
    case p_target_status
      when 'ready' then 'incident_vehicle_roster_marked_ready'
      when 'draft' then 'incident_vehicle_roster_returned_to_draft'
      when 'en_route' then 'incident_vehicle_roster_departed'
      when 'arrived' then 'incident_vehicle_roster_arrived'
      when 'cancelled' then 'incident_vehicle_roster_cancelled'
    end,
    'סטטוס שבצ"ק עודכן',
    'שבצ"ק ' || v_display || ': ' || v_roster.status || ' → ' || p_target_status || '.',
    case when p_target_status in ('cancelled', 'ready') then 'important' else 'normal' end,
    jsonb_build_object('display_number', v_display, 'old_status', v_roster.status, 'new_status', p_target_status)
  );

  return jsonb_build_object('success', true, 'roster_id', p_roster_id, 'display_number', v_display, 'status', p_target_status);
end;
$$;

create or replace function public.clone_incident_vehicle_roster_for_return(
  p_incident_id uuid,
  p_source_roster_id uuid,
  p_planned_departure_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.incident_vehicle_rosters%rowtype;
  v_root_id uuid;
  v_suffix integer;
  v_clone_id uuid;
  v_display text;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select * into v_source
  from public.incident_vehicle_rosters
  where id = p_source_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    raise exception 'Source roster not found';
  end if;

  if v_source.status <> 'arrived' then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_arrived');
  end if;

  v_root_id := coalesce(v_source.root_roster_id, v_source.id);

  select coalesce(max(clone_suffix_index), 0) + 1 into v_suffix
  from public.incident_vehicle_rosters
  where incident_id = p_incident_id
    and (
      id = v_root_id
      or root_roster_id = v_root_id
    );

  insert into public.incident_vehicle_rosters (
    incident_id,
    main_sequence,
    clone_suffix_index,
    root_roster_id,
    source_roster_id,
    status,
    movement_type,
    origin_text,
    destination_text,
    origin_site_id,
    destination_site_id,
    planned_departure_at,
    vehicle_license_plate,
    normalized_license_plate,
    vehicle_description,
    vehicle_type,
    vehicle_notes,
    operational_notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_source.main_sequence,
    v_suffix,
    v_root_id,
    p_source_roster_id,
    'draft',
    'return_to_unit',
    v_source.destination_text,
    v_source.origin_text,
    v_source.destination_site_id,
    v_source.origin_site_id,
    p_planned_departure_at,
    v_source.vehicle_license_plate,
    v_source.normalized_license_plate,
    v_source.vehicle_description,
    v_source.vehicle_type,
    v_source.vehicle_notes,
    null,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_clone_id;

  insert into public.incident_roster_participants (
    incident_id,
    roster_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    added_by,
    updated_by
  )
  select
    incident_id,
    v_clone_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    public.current_actor_id(),
    public.current_actor_id()
  from public.incident_roster_participants
  where roster_id = p_source_roster_id;

  v_display := public.incident_roster_display_number(v_source.main_sequence, v_suffix);

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_clone_id,
    'incident_vehicle_roster_return_cloned',
    'שבצ"ק חזור נוצר',
    'נוצר שבצ"ק חזור ' || v_display || ' על בסיס ' || public.incident_roster_display_number(v_source.main_sequence, v_source.clone_suffix_index) || '.',
    'important',
    jsonb_build_object(
      'display_number', v_display,
      'source_roster_id', p_source_roster_id,
      'root_roster_id', v_root_id
    )
  );

  return jsonb_build_object('success', true, 'roster_id', v_clone_id, 'display_number', v_display);
end;
$$;

create or replace function public.list_incident_vehicle_rosters(p_incident_id uuid)
returns table (
  id uuid,
  incident_id uuid,
  display_number text,
  main_sequence integer,
  clone_suffix_index integer,
  root_roster_id uuid,
  source_roster_id uuid,
  status text,
  movement_type text,
  origin_text text,
  destination_text text,
  vehicle_license_plate text,
  vehicle_description text,
  planned_departure_at timestamptz,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  participant_count bigint,
  driver_names text,
  movement_commander_names text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.incident_id,
    public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index),
    r.main_sequence,
    r.clone_suffix_index,
    r.root_roster_id,
    r.source_roster_id,
    r.status,
    r.movement_type,
    r.origin_text,
    r.destination_text,
    r.vehicle_license_plate,
    r.vehicle_description,
    r.planned_departure_at,
    r.actual_departure_at,
    r.actual_arrival_at,
    count(p.id) as participant_count,
    string_agg(p.display_name_snapshot, ', ' order by p.display_name_snapshot) filter (where p.is_driver) as driver_names,
    string_agg(p.display_name_snapshot, ', ' order by p.display_name_snapshot) filter (where p.is_movement_commander) as movement_commander_names,
    r.updated_at
  from public.incident_vehicle_rosters r
  left join public.incident_roster_participants p on p.roster_id = r.id
  where r.incident_id = p_incident_id
    and public.can_read_incident(p_incident_id)
  group by r.id
  order by r.main_sequence, r.clone_suffix_index;
$$;

create or replace function public.get_incident_vehicle_roster(p_incident_id uuid, p_roster_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roster jsonb;
  v_participants jsonb;
begin
  if not public.can_read_incident(p_incident_id) then
    raise exception 'User is not allowed to read this incident';
  end if;

  select to_jsonb(r) || jsonb_build_object(
    'display_number', public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index)
  )
  into v_roster
  from public.incident_vehicle_rosters r
  where r.id = p_roster_id
    and r.incident_id = p_incident_id;

  if v_roster is null then
    raise exception 'Roster not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_name_snapshot), '[]'::jsonb)
  into v_participants
  from public.incident_roster_participants p
  where p.roster_id = p_roster_id;

  return v_roster || jsonb_build_object('participants', v_participants);
end;
$$;

create or replace function public.list_incident_roster_eligible_people(p_incident_id uuid)
returns table (
  source_type text,
  source_id uuid,
  display_name text,
  mobile_phone text,
  normalized_mobile_phone text,
  source_label text,
  organic_team text,
  ad_hoc_teams text,
  attendance_status text,
  allocated_roster_id uuid,
  allocated_roster_display_number text
)
language sql
stable
security definer
set search_path = public
as $$
  with people as (
    select
      'unit_personnel'::text as source_type,
      up.id as source_id,
      up.first_name || ' ' || up.last_name as display_name,
      up.mobile_phone,
      public.normalize_incident_mobile_phone(up.mobile_phone) as normalized_mobile_phone,
      'צוות אורגני'::text as source_label,
      up.department as organic_team,
      coalesce(eps.attendance_status, 'unavailable') as attendance_status
    from public.unit_personnel up
    left join public.event_personnel_status eps
      on eps.personnel_id = up.id
     and eps.incident_id = p_incident_id
    where up.is_active
    union all
    select
      'manual_personnel',
      imp.id,
      imp.first_name || ' ' || imp.last_name,
      imp.mobile_phone,
      imp.normalized_mobile_phone,
      'נוסף ידנית',
      coalesce(t.name, 'צוות ' || t.team_number::text),
      imp.attendance_status
    from public.incident_manual_personnel imp
    left join public.teams t on t.id = imp.organic_team_id
    where imp.incident_id = p_incident_id
      and imp.is_active
    union all
    select
      'external_person',
      ep.id,
      ep.full_name,
      ep.mobile_phone,
      ep.normalized_mobile_phone,
      'גורם חיצוני – שבצ"ק בלבד',
      ep.external_role,
      null::text
    from public.incident_roster_external_people ep
    where ep.incident_id = p_incident_id
      and ep.is_active
  ),
  active_allocations as (
    select
      p.participant_key,
      r.id as roster_id,
      public.incident_roster_display_number(r.main_sequence, r.clone_suffix_index) as display_number
    from public.incident_roster_participants p
    join public.incident_vehicle_rosters r on r.id = p.roster_id
    where r.incident_id = p_incident_id
      and r.status in ('ready', 'en_route')
  ),
  ad_hoc as (
    select
      public.incident_roster_participant_key(
        case when m.unit_personnel_id is not null then 'unit_personnel' else 'manual_personnel' end,
        m.unit_personnel_id,
        m.manual_personnel_id,
        null
      ) as participant_key,
      string_agg(t.name, ', ' order by t.name) as team_names
    from public.incident_ad_hoc_team_members m
    join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
    where m.incident_id = p_incident_id
      and m.is_active
      and t.status = 'active'
    group by 1
  )
  select
    people.source_type,
    people.source_id,
    people.display_name,
    people.mobile_phone,
    people.normalized_mobile_phone,
    people.source_label,
    people.organic_team,
    ad_hoc.team_names,
    people.attendance_status,
    active_allocations.roster_id,
    active_allocations.display_number
  from people
  left join active_allocations
    on active_allocations.participant_key = public.incident_roster_participant_key(
      people.source_type,
      case when people.source_type = 'unit_personnel' then people.source_id else null end,
      case when people.source_type = 'manual_personnel' then people.source_id else null end,
      case when people.source_type = 'external_person' then people.source_id else null end
    )
  left join ad_hoc
    on ad_hoc.participant_key = public.incident_roster_participant_key(
      people.source_type,
      case when people.source_type = 'unit_personnel' then people.source_id else null end,
      case when people.source_type = 'manual_personnel' then people.source_id else null end,
      case when people.source_type = 'external_person' then people.source_id else null end
    )
  where public.can_read_incident(p_incident_id)
  order by people.display_name;
$$;

revoke all on function public.normalize_vehicle_license_plate(text) from public;
revoke all on function public.incident_roster_hebrew_suffix(integer) from public;
revoke all on function public.incident_roster_display_number(integer, integer) from public;
revoke all on function public.incident_roster_participant_key(text, uuid, uuid, uuid) from public;
revoke all on function public.validate_incident_vehicle_roster_refs() from public;
revoke all on function public.validate_incident_roster_participant_refs() from public;
revoke all on function public.create_incident_vehicle_roster(uuid, text, text, text) from public;
revoke all on function public.update_incident_vehicle_roster_draft(uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, text, text, text) from public;
revoke all on function public.create_or_reuse_incident_roster_external_person(uuid, text, text, text, text) from public;
revoke all on function public.add_incident_roster_participant(uuid, uuid, text, uuid, uuid, uuid, boolean, boolean, boolean, text) from public;
revoke all on function public.update_incident_roster_participant_roles(uuid, uuid, boolean, boolean, boolean) from public;
revoke all on function public.remove_incident_roster_participant(uuid, uuid) from public;
revoke all on function public.transition_incident_vehicle_roster(uuid, uuid, text, timestamptz, text) from public;
revoke all on function public.clone_incident_vehicle_roster_for_return(uuid, uuid, timestamptz) from public;
revoke all on function public.list_incident_vehicle_rosters(uuid) from public;
revoke all on function public.get_incident_vehicle_roster(uuid, uuid) from public;
revoke all on function public.list_incident_roster_eligible_people(uuid) from public;

grant execute on function public.create_incident_vehicle_roster(uuid, text, text, text) to authenticated;
grant execute on function public.update_incident_vehicle_roster_draft(uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.create_or_reuse_incident_roster_external_person(uuid, text, text, text, text) to authenticated;
grant execute on function public.add_incident_roster_participant(uuid, uuid, text, uuid, uuid, uuid, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.update_incident_roster_participant_roles(uuid, uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.remove_incident_roster_participant(uuid, uuid) to authenticated;
grant execute on function public.transition_incident_vehicle_roster(uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.clone_incident_vehicle_roster_for_return(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.list_incident_vehicle_rosters(uuid) to authenticated;
grant execute on function public.get_incident_vehicle_roster(uuid, uuid) to authenticated;
grant execute on function public.list_incident_roster_eligible_people(uuid) to authenticated;
