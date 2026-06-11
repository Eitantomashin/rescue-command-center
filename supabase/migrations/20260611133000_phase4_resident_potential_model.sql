alter table public.unit_residents
  add column if not exists site_id uuid references public.sites(id);

update public.unit_residents ur
set site_id = u.site_id
from public.units u
where ur.unit_id = u.id
  and ur.site_id is null;

alter table public.unit_residents
  alter column site_id set not null,
  alter column unit_id drop not null;

create index if not exists unit_residents_site_id_idx
  on public.unit_residents (site_id);

alter table public.unit_residents
  drop constraint if exists unit_residents_unit_or_general_area,
  add constraint unit_residents_unit_or_general_area
    check (site_id is not null);

insert into public.status_types (
  incident_id,
  category,
  status_key,
  name,
  hebrew_label,
  color,
  is_open,
  is_dashboard_counted,
  is_default,
  sort_order
)
values
  (null, 'resident', 'missing', 'Missing', 'נעדר', 'blue', true, true, true, 40),
  (null, 'resident', 'in_progress', 'In Progress', 'בטיפול', 'orange', true, true, true, 50),
  (null, 'resident', 'rescued', 'Rescued', 'חולץ', 'green', false, true, true, 60),
  (null, 'resident', 'evacuated', 'Evacuated', 'פונה', 'green', false, true, true, 70),
  (null, 'resident', 'located_outside_site', 'Located Outside Site', 'אותר מחוץ לאתר', 'green', false, true, true, 80),
  (null, 'resident', 'resolved', 'Resolved', 'טופל', 'green', false, true, true, 90)
on conflict do nothing;

create or replace function public.validate_unit_resident_consistency()
returns trigger
language plpgsql
as $$
declare
  v_unit public.units%rowtype;
  v_site_incident_id uuid;
  v_person_incident_id uuid;
begin
  select incident_id into v_site_incident_id
  from public.sites
  where id = new.site_id;

  if not found then
    raise exception 'Resident site_id % does not exist', new.site_id;
  end if;

  if new.incident_id <> v_site_incident_id then
    raise exception 'Resident incident_id must match Site incident_id';
  end if;

  if new.unit_id is not null then
    select * into v_unit
    from public.units
    where id = new.unit_id;

    if not found then
      raise exception 'Resident unit_id % does not exist', new.unit_id;
    end if;

    if new.incident_id <> v_unit.incident_id then
      raise exception 'Resident incident_id must match Unit incident_id';
    end if;

    if new.site_id <> v_unit.site_id then
      raise exception 'Resident site_id must match Unit site_id';
    end if;
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

create or replace function public.prevent_delete()
returns trigger
language plpgsql
as $$
begin
  if TG_TABLE_SCHEMA = 'public'
    and TG_TABLE_NAME = 'unit_residents'
    and coalesce(current_setting('rcc.allow_placeholder_resident_delete_id', true), '') = old.id::text
    and old.unit_id is not null
    and old.linked_person_id is null
    and old.first_name ~ '^דייר [0-9]+$'
    and old.last_name is null
    and old.age is null
    and nullif(btrim(coalesce(old.phone, '')), '') is null
    and nullif(btrim(coalesce(old.notes, '')), '') is not distinct from 'placeholder'
  then
    return old;
  end if;

  raise exception 'Records cannot be deleted; mark them inactive instead';
end;
$$;

create or replace function public.create_missing_resident_placeholders_for_unit(
  p_unit_id uuid,
  p_target_count integer default 5
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units%rowtype;
  v_missing_status_id uuid;
  v_existing_count integer;
  v_created_count integer := 0;
  v_idx integer;
begin
  if p_target_count < 0 then
    raise exception 'Target count cannot be negative';
  end if;

  select * into v_unit
  from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Unit % does not exist', p_unit_id;
  end if;

  perform public.assert_incident_writable(v_unit.incident_id, 'create_missing_resident_placeholders_for_unit');

  v_missing_status_id := public.get_status_id('resident', 'missing', v_unit.incident_id);

  if v_missing_status_id is null then
    raise exception 'Default resident missing status is missing';
  end if;

  select count(*)::integer into v_existing_count
  from public.unit_residents
  where unit_id = v_unit.id
    and is_active = true;

  if v_existing_count >= p_target_count then
    return 0;
  end if;

  for v_idx in (v_existing_count + 1)..p_target_count loop
    insert into public.unit_residents (
      incident_id,
      site_id,
      unit_id,
      first_name,
      status_id,
      notes,
      created_by,
      updated_by
    )
    values (
      v_unit.incident_id,
      v_unit.site_id,
      v_unit.id,
      'דייר ' || v_idx,
      v_missing_status_id,
      'placeholder',
      auth.uid(),
      auth.uid()
    );

    v_created_count := v_created_count + 1;
  end loop;

  return v_created_count;
end;
$$;

create or replace function public.backfill_missing_resident_placeholders(
  p_target_count integer default 5
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit record;
  v_total integer := 0;
begin
  for v_unit in
    select id
    from public.units
    where is_active = true
  loop
    v_total := v_total + public.create_missing_resident_placeholders_for_unit(v_unit.id, p_target_count);
  end loop;

  return v_total;
end;
$$;

create or replace function public.delete_empty_placeholder_resident(
  p_resident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
begin
  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'delete_empty_placeholder_resident');

  if v_resident.linked_person_id is not null then
    raise exception 'Cannot delete resident linked to an operational person';
  end if;

  if v_resident.unit_id is null then
    raise exception 'Only apartment placeholders can be deleted';
  end if;

  if v_resident.first_name !~ '^דייר [0-9]+$'
    or v_resident.last_name is not null
    or v_resident.age is not null
    or nullif(btrim(coalesce(v_resident.phone, '')), '') is not null
    or nullif(btrim(coalesce(v_resident.notes, '')), '') is distinct from 'placeholder'
  then
    raise exception 'Only empty placeholder residents can be deleted';
  end if;

  select * into v_unit
  from public.units
  where id = v_resident.unit_id;

  perform set_config('rcc.allow_placeholder_resident_delete_id', v_resident.id::text, true);

  delete from public.unit_residents
  where id = v_resident.id;

  perform set_config('rcc.allow_placeholder_resident_delete_id', '', true);

  perform public.create_event_log(
    v_resident.incident_id,
    'placeholder_resident_deleted',
    'Placeholder Resident Deleted',
    'Deleted empty placeholder resident',
    'operational',
    'normal',
    now(),
    v_resident.site_id,
    v_unit.floor_id,
    v_resident.unit_id,
    null,
    null,
    'ui',
    'RCC',
    jsonb_build_object(
      'resident_id', v_resident.id,
      'resident_name', v_resident.first_name,
      'unit_number', v_unit.unit_number
    )
  );
end;
$$;

with active_units as (
  select
    u.id as unit_id,
    u.incident_id,
    u.site_id,
    coalesce(count(ur.id) filter (where ur.is_active = true), 0)::integer as existing_count
  from public.units u
  left join public.unit_residents ur on ur.unit_id = u.id
  where u.is_active = true
  group by u.id, u.incident_id, u.site_id
),
missing_statuses as (
  select
    au.*,
    public.get_status_id('resident', 'missing', au.incident_id) as missing_status_id
  from active_units au
  where au.existing_count < 5
)
insert into public.unit_residents (
  incident_id,
  site_id,
  unit_id,
  first_name,
  status_id,
  notes
)
select
  ms.incident_id,
  ms.site_id,
  ms.unit_id,
  'דייר ' || (ms.existing_count + gs.placeholder_index),
  ms.missing_status_id,
  'placeholder'
from missing_statuses ms
cross join lateral generate_series(1, 5 - ms.existing_count) as gs(placeholder_index)
where ms.missing_status_id is not null;
