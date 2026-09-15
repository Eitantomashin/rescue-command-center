-- Equipment stage 1: global refuel-based equipment catalog only.
-- No incident dependencies. All application mutations go through four RPCs.
begin;

create function public.equipment_catalog_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
      and p.is_active = true and p.deleted_at is null
  )
$$;

create function public.assert_equipment_catalog_admin()
returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.equipment_catalog_admin() then
    raise exception 'Active authenticated admin required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Canonical identity: trim/collapse POSIX whitespace, then lowercase.
-- Punctuation remains significant. The stored value is canonical too.
create function public.normalize_equipment_identifier(p_value text)
returns text
language sql immutable strict
set search_path = pg_catalog
as $$
  select lower(btrim(regexp_replace(p_value, '[[:space:]]+', ' ', 'g')))
$$;

create table public.equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '[^[:space:]]'),
  category text not null check (category ~ '[^[:space:]]'),
  full_runtime_seconds integer not null check (full_runtime_seconds > 0),
  warning_before_seconds integer not null default 1800
    check (warning_before_seconds > 0 and warning_before_seconds <= full_runtime_seconds),
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id)
);

create table public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  equipment_type_id uuid not null references public.equipment_types(id) on delete restrict,
  asset_identifier text not null unique
    check (asset_identifier <> '' and asset_identifier = public.normalize_equipment_identifier(asset_identifier)),
  serial_number text,
  serviceability text not null default 'serviceable'
    check (serviceability in ('serviceable', 'restricted', 'unserviceable')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id)
);
create index equipment_items_type_idx on public.equipment_items(equipment_type_id);

create table public.equipment_catalog_audit (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('equipment_type', 'equipment_item')),
  entity_id uuid not null,
  action_type text not null check (action_type in ('create', 'update')),
  before_state jsonb,
  after_state jsonb not null,
  actor_id uuid not null references public.profiles(id),
  occurred_at timestamptz not null default now(),
  check ((action_type = 'create' and before_state is null)
    or (action_type = 'update' and before_state is not null))
);
create index equipment_catalog_audit_entity_idx
  on public.equipment_catalog_audit(entity_type, entity_id, occurred_at desc);

create function public.reject_equipment_catalog_removal()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Equipment catalog records cannot be deleted; audit records are immutable'
    using errcode = '42501';
end;
$$;

create trigger equipment_types_no_delete before delete on public.equipment_types
  for each row execute function public.reject_equipment_catalog_removal();
create trigger equipment_items_no_delete before delete on public.equipment_items
  for each row execute function public.reject_equipment_catalog_removal();
create trigger equipment_audit_immutable before update or delete on public.equipment_catalog_audit
  for each row execute function public.reject_equipment_catalog_removal();
create trigger equipment_types_no_truncate before truncate on public.equipment_types
  for each statement execute function public.reject_equipment_catalog_removal();
create trigger equipment_items_no_truncate before truncate on public.equipment_items
  for each statement execute function public.reject_equipment_catalog_removal();
create trigger equipment_audit_no_truncate before truncate on public.equipment_catalog_audit
  for each statement execute function public.reject_equipment_catalog_removal();

-- Stamp authenticated identity and preserve creation provenance on every write.
create function public.stamp_equipment_catalog_write()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.assert_equipment_catalog_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := v_actor;
    new.created_at := statement_timestamp();
  else
    if new.id is distinct from old.id then
      raise exception 'Equipment identity is immutable' using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := v_actor;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

-- AFTER trigger guarantees the exact stored row is audited in the same transaction.
-- No exception is swallowed: an audit failure rolls back the catalog mutation.
create function public.audit_equipment_catalog_write()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.equipment_catalog_audit
    (entity_type, entity_id, action_type, before_state, after_state, actor_id)
  values (
    case tg_table_name when 'equipment_types' then 'equipment_type' else 'equipment_item' end,
    new.id, case tg_op when 'INSERT' then 'create' else 'update' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), public.assert_equipment_catalog_admin()
  );
  return new;
end;
$$;
create trigger equipment_types_stamp before insert or update on public.equipment_types
  for each row execute function public.stamp_equipment_catalog_write();
create trigger equipment_items_stamp before insert or update on public.equipment_items
  for each row execute function public.stamp_equipment_catalog_write();
create trigger equipment_types_audit after insert or update on public.equipment_types
  for each row execute function public.audit_equipment_catalog_write();
create trigger equipment_items_audit after insert or update on public.equipment_items
  for each row execute function public.audit_equipment_catalog_write();

create function public.create_equipment_type(
  p_name text, p_category text, p_full_runtime_seconds integer,
  p_warning_before_seconds integer default 1800,
  p_instructions text default null, p_is_active boolean default true
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  perform public.assert_equipment_catalog_admin();
  insert into public.equipment_types
    (name, category, full_runtime_seconds, warning_before_seconds, instructions, is_active)
  values (btrim(p_name), btrim(p_category), p_full_runtime_seconds,
    p_warning_before_seconds, nullif(btrim(p_instructions), ''), p_is_active)
  returning id into v_id;
  return v_id;
end;
$$;

-- Updates replace the supplied editable fields; NULL is not a patch sentinel.
create function public.update_equipment_type(
  p_id uuid, p_name text, p_category text, p_full_runtime_seconds integer,
  p_warning_before_seconds integer, p_instructions text, p_is_active boolean
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_equipment_catalog_admin();
  update public.equipment_types set name = btrim(p_name), category = btrim(p_category),
    full_runtime_seconds = p_full_runtime_seconds, warning_before_seconds = p_warning_before_seconds,
    instructions = nullif(btrim(p_instructions), ''), is_active = p_is_active
  where id = p_id;
  if not found then raise exception 'Equipment type not found' using errcode = 'P0002'; end if;
  return p_id;
end;
$$;

create function public.create_equipment_item(
  p_equipment_type_id uuid, p_asset_identifier text,
  p_serial_number text default null, p_serviceability text default 'serviceable',
  p_notes text default null, p_is_active boolean default true
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  perform public.assert_equipment_catalog_admin();
  insert into public.equipment_items
    (equipment_type_id, asset_identifier, serial_number, serviceability, notes, is_active)
  values (p_equipment_type_id, public.normalize_equipment_identifier(p_asset_identifier),
    nullif(btrim(p_serial_number), ''), p_serviceability, nullif(btrim(p_notes), ''), p_is_active)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_equipment_item(
  p_id uuid, p_equipment_type_id uuid, p_asset_identifier text,
  p_serial_number text, p_serviceability text, p_notes text, p_is_active boolean
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_equipment_catalog_admin();
  update public.equipment_items set equipment_type_id = p_equipment_type_id,
    asset_identifier = public.normalize_equipment_identifier(p_asset_identifier),
    serial_number = nullif(btrim(p_serial_number), ''), serviceability = p_serviceability,
    notes = nullif(btrim(p_notes), ''), is_active = p_is_active
  where id = p_id;
  if not found then raise exception 'Equipment item not found' using errcode = 'P0002'; end if;
  return p_id;
end;
$$;

alter table public.equipment_types enable row level security;
alter table public.equipment_items enable row level security;
alter table public.equipment_catalog_audit enable row level security;
-- Stage 1 exposes reads only to active admins. Operational reads are a later stage.
create policy equipment_types_admin_read on public.equipment_types
  for select to authenticated using (public.equipment_catalog_admin());
create policy equipment_items_admin_read on public.equipment_items
  for select to authenticated using (public.equipment_catalog_admin());
create policy equipment_audit_admin_read on public.equipment_catalog_audit
  for select to authenticated using (public.equipment_catalog_admin());
-- No INSERT/UPDATE/DELETE policies, even for admins. Also remove default grants.
revoke all on public.equipment_types, public.equipment_items, public.equipment_catalog_audit
  from public, anon, authenticated, service_role;
grant select on public.equipment_types, public.equipment_items, public.equipment_catalog_audit to authenticated;

revoke all on function public.equipment_catalog_admin() from public, anon, authenticated, service_role;
revoke all on function public.assert_equipment_catalog_admin() from public, anon, authenticated, service_role;
revoke all on function public.normalize_equipment_identifier(text) from public, anon, authenticated, service_role;
revoke all on function public.reject_equipment_catalog_removal() from public, anon, authenticated, service_role;
revoke all on function public.stamp_equipment_catalog_write() from public, anon, authenticated, service_role;
revoke all on function public.audit_equipment_catalog_write() from public, anon, authenticated, service_role;
revoke all on function public.create_equipment_type(text, text, integer, integer, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.update_equipment_type(uuid, text, text, integer, integer, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.create_equipment_item(uuid, text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.update_equipment_item(uuid, uuid, text, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.equipment_catalog_admin() to authenticated;
grant execute on function public.create_equipment_type(text, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.update_equipment_type(uuid, text, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.create_equipment_item(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.update_equipment_item(uuid, uuid, text, text, text, text, boolean) to authenticated;

commit;
