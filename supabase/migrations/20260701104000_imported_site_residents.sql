-- Municipal resident list import and linking to building unit residents.

create table if not exists public.imported_site_residents (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  site_id uuid not null references public.sites(id),
  floor text,
  apartment text,
  first_name text,
  last_name text,
  gender text not null default 'unknown'
    check (gender in ('male', 'female', 'unknown')),
  age integer check (age is null or age >= 0),
  phone text,
  notes text,
  linked_resident_id uuid references public.unit_residents(id),
  linked_unit_id uuid references public.units(id),
  linked_at timestamptz,
  linked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  is_active boolean not null default true
);

create index if not exists imported_site_residents_site_idx
  on public.imported_site_residents (site_id, is_active, linked_at);

create index if not exists imported_site_residents_incident_idx
  on public.imported_site_residents (incident_id, site_id);

create unique index if not exists imported_site_residents_one_active_link_idx
  on public.imported_site_residents (linked_resident_id)
  where linked_resident_id is not null and is_active = true;

alter table public.imported_site_residents enable row level security;

drop policy if exists imported_site_residents_select on public.imported_site_residents;
create policy imported_site_residents_select
  on public.imported_site_residents for select
  using (public.can_view_incident(incident_id));

drop policy if exists imported_site_residents_mutate on public.imported_site_residents;
create policy imported_site_residents_mutate
  on public.imported_site_residents for all
  using (public.can_edit_operational_data(incident_id))
  with check (public.can_edit_operational_data(incident_id));

create or replace function public.import_site_residents(
  p_site_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_row jsonb;
  v_count integer := 0;
begin
  select *
  into v_site
  from public.sites
  where id = p_site_id;

  if not found or not v_site.is_active or coalesce(v_site.is_cancelled, false) then
    raise exception 'Active site was not found';
  end if;

  perform public.assert_edit_operational_data(v_site.incident_id);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Resident rows must be an array';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(coalesce(v_row ->> 'first_name', '')), '') is null
      and nullif(btrim(coalesce(v_row ->> 'last_name', '')), '') is null
    then
      continue;
    end if;

    insert into public.imported_site_residents (
      incident_id,
      site_id,
      floor,
      apartment,
      first_name,
      last_name,
      gender,
      age,
      phone,
      notes,
      created_by
    )
    values (
      v_site.incident_id,
      v_site.id,
      nullif(btrim(coalesce(v_row ->> 'floor', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'apartment', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'last_name', '')), ''),
      case
        when coalesce(v_row ->> 'gender', 'unknown') in ('male', 'female', 'unknown') then coalesce(v_row ->> 'gender', 'unknown')
        else 'unknown'
      end,
      case
        when nullif(btrim(coalesce(v_row ->> 'age', '')), '') is null then null
        else greatest(0, (v_row ->> 'age')::integer)
      end,
      nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
      v_actor_id
    );

    v_count := v_count + 1;
  end loop;

  perform public.create_event_log(
    v_site.incident_id,
    'site_resident_list_imported',
    'רשימת דיירים נטענה',
    'רשימת דיירים נטענה לאתר ' || coalesce(v_site.name, v_site.street || ' ' || v_site.house_number) || ' על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'operational',
    'important',
    now(),
    v_site.id,
    null,
    null,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', v_site.id,
      'imported_count', v_count
    )
  );

  return v_count;
end;
$$;

create or replace function public.link_imported_site_resident(
  p_imported_resident_id uuid,
  p_resident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imported public.imported_site_residents%rowtype;
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_floor_number integer;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_name text;
begin
  select *
  into v_imported
  from public.imported_site_residents
  where id = p_imported_resident_id
  for update;

  if not found or not v_imported.is_active then
    raise exception 'Imported resident was not found';
  end if;

  if v_imported.linked_resident_id is not null then
    raise exception 'Imported resident is already linked';
  end if;

  select *
  into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Building resident was not found';
  end if;

  if v_resident.incident_id <> v_imported.incident_id
    or v_resident.site_id <> v_imported.site_id
  then
    raise exception 'Resident belongs to a different site';
  end if;

  perform public.assert_edit_operational_data(v_imported.incident_id);

  if exists (
    select 1
    from public.imported_site_residents other
    where other.id <> v_imported.id
      and other.is_active = true
      and other.linked_resident_id = p_resident_id
  ) then
    raise exception 'Building resident is already linked to imported resident';
  end if;

  if v_resident.unit_id is not null then
    select * into v_unit from public.units where id = v_resident.unit_id;
    select floor_number into v_floor_number from public.floors where id = v_unit.floor_id;
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  update public.unit_residents
  set first_name = v_imported.first_name,
      last_name = v_imported.last_name,
      gender = v_imported.gender,
      age = v_imported.age,
      phone = v_imported.phone,
      notes = v_imported.notes,
      updated_by = v_actor_id
  where id = v_resident.id;

  update public.imported_site_residents
  set linked_resident_id = v_resident.id,
      linked_unit_id = v_resident.unit_id,
      linked_at = now(),
      linked_by = v_actor_id
  where id = v_imported.id;

  v_name := coalesce(nullif(btrim(concat_ws(' ', v_imported.first_name, v_imported.last_name)), ''), 'דייר ללא שם');

  perform public.create_event_log(
    v_imported.incident_id,
    'imported_resident_linked',
    'דייר שויך לדירה',
    'הדייר ' || v_name || ' שויך ל' ||
      case
        when v_resident.unit_id is null then 'אזור כללי'
        when v_floor_number is null then 'יחידה ' || coalesce(v_unit.unit_number, '')
        else 'דירה ' || coalesce(v_unit.unit_number, '') || ' קומה ' || v_floor_number
      end || '.',
    'operational',
    'normal',
    now(),
    v_imported.site_id,
    case when v_resident.unit_id is null then null else v_unit.floor_id end,
    v_resident.unit_id,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'imported_resident_id', v_imported.id,
      'resident_id', v_resident.id,
      'unit_id', v_resident.unit_id
    )
  );
end;
$$;

grant execute on function public.import_site_residents(uuid, jsonb) to authenticated;
grant execute on function public.link_imported_site_resident(uuid, uuid) to authenticated;