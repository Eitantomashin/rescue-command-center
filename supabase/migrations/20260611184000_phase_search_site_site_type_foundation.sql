-- Search Site Phase 1 foundation: discriminator and optional Search Site metadata.

alter table public.sites
  add column if not exists site_type text not null default 'rescue_site',
  add column if not exists parent_site_id uuid null references public.sites(id),
  add column if not exists search_status text not null default 'not_started',
  add column if not exists search_reason text null,
  add column if not exists search_priority text null,
  add column if not exists search_completed_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sites_site_type_check'
      and conrelid = 'public.sites'::regclass
  ) then
    alter table public.sites
      add constraint sites_site_type_check
      check (site_type in ('rescue_site', 'search_site'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sites_search_status_check'
      and conrelid = 'public.sites'::regclass
  ) then
    alter table public.sites
      add constraint sites_search_status_check
      check (search_status in ('not_started', 'in_progress', 'has_open_items', 'cleared'));
  end if;
end $$;

create index if not exists sites_incident_site_type_idx
  on public.sites (incident_id, site_type);

create index if not exists sites_parent_site_id_idx
  on public.sites (parent_site_id);
