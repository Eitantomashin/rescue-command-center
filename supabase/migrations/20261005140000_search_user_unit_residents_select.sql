-- Permit a search_user to read residents only within a Search Site it may view.
-- Existing incident-level readers retain their current access path.

drop policy if exists unit_residents_member_select on public.unit_residents;

create policy unit_residents_member_select
  on public.unit_residents for select
  using (
    public.can_read_incident(incident_id)
    or public.can_view_search_site(site_id)
  );
