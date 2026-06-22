-- Phase 9G: default incident visibility by system role.
-- Archived incidents are visible only to admins.
-- Editors and viewers continue to require incident_memberships.

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
  select public.can_view_incident(p_incident_id)
$$;

create or replace function public.assert_incident_viewer(p_incident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_incident(p_incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;
end;
$$;

drop policy if exists incidents_member_select on public.incidents;
create policy incidents_member_select
  on public.incidents for select
  using (public.can_view_incident(id));
