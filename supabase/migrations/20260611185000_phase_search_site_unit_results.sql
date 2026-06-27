-- Search Site Phase 5A: apartment/unit search results for Search Sites only.
-- Search Sites continue to reuse public.sites, public.floors, and public.units.

create table if not exists public.site_search_units (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  family_name text,
  occupants_count integer check (occupants_count is null or occupants_count >= 0),
  contact_phone text,
  search_status text not null default 'not_visited'
    check (search_status in ('not_visited', 'no_answer', 'clear', 'casualties', 'completed')),
  casualty_psych boolean not null default false,
  casualty_body boolean not null default false,
  medical_evacuation boolean not null default false,
  notes text,
  searched_by uuid null references public.profiles(id),
  searched_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_search_units_site_unit_unique unique (site_id, unit_id)
);

create index if not exists site_search_units_site_id_idx
  on public.site_search_units (site_id);

create index if not exists site_search_units_incident_id_idx
  on public.site_search_units (incident_id);

create index if not exists site_search_units_search_status_idx
  on public.site_search_units (search_status);

create or replace function public.validate_site_search_unit_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_site_incident_id uuid;
  v_site_type text;
  v_unit_site_id uuid;
  v_unit_incident_id uuid;
begin
  select incident_id, site_type
  into v_site_incident_id, v_site_type
  from public.sites
  where id = new.site_id;

  if v_site_incident_id is null then
    raise exception 'Search Site not found';
  end if;

  if v_site_type <> 'search_site' then
    raise exception 'Search unit results can only be recorded for Search Sites';
  end if;

  if new.incident_id <> v_site_incident_id then
    raise exception 'Search unit incident must match Search Site incident';
  end if;

  select site_id, incident_id
  into v_unit_site_id, v_unit_incident_id
  from public.units
  where id = new.unit_id;

  if v_unit_site_id is null then
    raise exception 'Unit not found';
  end if;

  if v_unit_site_id <> new.site_id then
    raise exception 'Search unit must belong to the selected Search Site';
  end if;

  if v_unit_incident_id <> new.incident_id then
    raise exception 'Search unit incident must match unit incident';
  end if;

  return new;
end;
$$;

drop trigger if exists site_search_units_validate_consistency on public.site_search_units;
create trigger site_search_units_validate_consistency
  before insert or update on public.site_search_units
  for each row execute function public.validate_site_search_unit_consistency();

drop trigger if exists site_search_units_set_updated_at on public.site_search_units;
create trigger site_search_units_set_updated_at
  before update on public.site_search_units
  for each row execute function public.set_updated_at();

alter table public.site_search_units enable row level security;

drop policy if exists site_search_units_member_select on public.site_search_units;
create policy site_search_units_member_select
  on public.site_search_units for select
  using (public.can_read_incident(incident_id));

drop policy if exists site_search_units_operator_mutate on public.site_search_units;
create policy site_search_units_operator_mutate
  on public.site_search_units for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

