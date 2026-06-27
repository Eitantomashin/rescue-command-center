-- Search Site Phase 5C fix: search_user access is derived from Search Sites, not manual incident assignments.
-- search_user can see active incidents that contain at least one active Search Site, and only Search Site structure within them.

create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() = 'commander'
          and (
            i.archived_at is null
            or exists (
              select 1
              from public.incident_memberships commander_membership
              where commander_membership.incident_id = i.id
                and commander_membership.user_id = public.current_actor_id()
            )
          )
        )
        or (
          i.archived_at is null
          and public.current_user_role() in ('editor', 'viewer')
          and exists (
            select 1
            from public.incident_memberships im
            where im.incident_id = i.id
              and im.user_id = public.current_actor_id()
          )
        )
        or (
          i.archived_at is null
          and public.current_user_role() = 'search_user'
          and exists (
            select 1
            from public.sites search_site
            where search_site.incident_id = i.id
              and search_site.site_type = 'search_site'
              and coalesce(search_site.is_active, true) = true
          )
        )
      )
  )
$$;

create or replace function public.can_read_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() <> 'search_user'
    and public.can_view_incident(p_incident_id)
$$;

create or replace function public.can_view_search_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    join public.incidents i on i.id = s.incident_id
    where s.id = p_site_id
      and s.site_type = 'search_site'
      and coalesce(s.is_active, true) = true
      and (
        public.can_read_incident(s.incident_id)
        or (
          public.current_user_role() = 'search_user'
          and i.archived_at is null
        )
      )
  )
$$;

create or replace function public.can_edit_search_site_data(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_write_incident(p_incident_id)
    or exists (
      select 1
      from public.incidents i
      where i.id = p_incident_id
        and i.is_closed = false
        and i.archived_at is null
        and public.current_user_role() = 'search_user'
        and exists (
          select 1
          from public.sites search_site
          where search_site.incident_id = i.id
            and search_site.site_type = 'search_site'
            and coalesce(search_site.is_active, true) = true
        )
    )
$$;

-- Keep incident selection centralized through can_view_incident, now including Search Site-derived search_user access.
drop policy if exists incidents_member_select on public.incidents;
create policy incidents_member_select
  on public.incidents for select
  using (public.can_view_incident(id));

-- Search users may see only Search Sites. Existing operational roles keep ordinary incident read access.
drop policy if exists sites_member_select on public.sites;
create policy sites_member_select
  on public.sites for select
  using (
    public.can_read_incident(incident_id)
    or public.can_view_search_site(id)
  );

drop policy if exists floors_member_select on public.floors;
create policy floors_member_select
  on public.floors for select
  using (
    public.can_read_incident(incident_id)
    or (
      public.current_user_role() = 'search_user'
      and exists (
        select 1
        from public.sites s
        where s.id = floors.site_id
          and public.can_view_search_site(s.id)
      )
    )
  );

drop policy if exists units_member_select on public.units;
create policy units_member_select
  on public.units for select
  using (
    public.can_read_incident(incident_id)
    or (
      public.current_user_role() = 'search_user'
      and exists (
        select 1
        from public.sites s
        where s.id = units.site_id
          and public.can_view_search_site(s.id)
      )
    )
  );

drop policy if exists site_search_units_member_select on public.site_search_units;
create policy site_search_units_member_select
  on public.site_search_units for select
  using (
    public.can_read_incident(incident_id)
    or public.can_view_search_site(site_id)
  );

grant execute on function public.can_view_search_site(uuid) to authenticated;
grant execute on function public.can_edit_search_site_data(uuid) to authenticated;