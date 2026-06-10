-- RCC Phase 1 RLS baseline.
-- These policies are intentionally conservative. Mutating critical operational data should be routed
-- through shared service/database functions that create event logs.

alter table public.profiles enable row level security;
alter table public.status_types enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_memberships enable row level security;
alter table public.sites enable row level security;
alter table public.floors enable row level security;
alter table public.units enable row level security;
alter table public.unit_residents enable row level security;
alter table public.persons enable row level security;
alter table public.teams enable row level security;
alter table public.team_site_assignments enable row level security;
alter table public.person_status_history enable row level security;
alter table public.person_merges enable row level security;
alter table public.event_logs enable row level security;

create policy profiles_self_or_admin_select
  on public.profiles for select
  using (id = auth.uid() or public.current_user_role() = 'system_administrator');

create policy profiles_self_update
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_all
  on public.profiles for all
  using (public.current_user_role() = 'system_administrator')
  with check (public.current_user_role() = 'system_administrator');

create policy status_types_global_select
  on public.status_types for select
  using (
    incident_id is null
    or public.can_read_incident(incident_id)
  );

create policy status_types_admin_or_commander_mutate
  on public.status_types for all
  using (
    public.current_user_role() = 'system_administrator'
    or (
      incident_id is not null
      and public.current_user_incident_role(incident_id) = 'incident_commander'
    )
  )
  with check (
    public.current_user_role() = 'system_administrator'
    or (
      incident_id is not null
      and public.current_user_incident_role(incident_id) = 'incident_commander'
    )
  );

create policy incidents_member_select
  on public.incidents for select
  using (public.can_read_incident(id));

create policy incidents_authorized_insert
  on public.incidents for insert
  with check (public.current_user_role() in ('system_administrator', 'incident_commander', 'command_post_operator'));

create policy incidents_commander_update
  on public.incidents for update
  using (
    public.current_user_role() = 'system_administrator'
    or (
      public.can_command_incident(id)
      and is_closed = false
    )
  )
  with check (
    public.current_user_role() = 'system_administrator'
    or (
      public.can_command_incident(id)
      and is_closed = false
    )
  );

create policy incident_memberships_member_select
  on public.incident_memberships for select
  using (
    user_id = auth.uid()
    or public.can_command_incident(incident_id)
  );

create policy incident_memberships_admin_or_commander_mutate
  on public.incident_memberships for all
  using (public.can_command_incident(incident_id))
  with check (public.can_command_incident(incident_id));

create policy sites_member_select
  on public.sites for select
  using (public.can_read_incident(incident_id));

create policy sites_operator_mutate
  on public.sites for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy floors_member_select
  on public.floors for select
  using (public.can_read_incident(incident_id));

create policy floors_operator_mutate
  on public.floors for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy units_member_select
  on public.units for select
  using (public.can_read_incident(incident_id));

create policy units_operator_mutate
  on public.units for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy unit_residents_member_select
  on public.unit_residents for select
  using (public.can_read_incident(incident_id));

create policy unit_residents_operator_mutate
  on public.unit_residents for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy persons_member_select
  on public.persons for select
  using (public.can_read_incident(incident_id));

create policy persons_operator_mutate
  on public.persons for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy teams_member_select
  on public.teams for select
  using (public.can_read_incident(incident_id));

create policy teams_operator_mutate
  on public.teams for all
  using (public.can_write_incident(incident_id))
  with check (public.can_write_incident(incident_id));

create policy team_site_assignments_member_select
  on public.team_site_assignments for select
  using (public.can_read_incident(incident_id));

create policy team_site_assignments_commander_mutate
  on public.team_site_assignments for all
  using (public.can_command_incident(incident_id))
  with check (public.can_command_incident(incident_id));

create policy person_status_history_member_select
  on public.person_status_history for select
  using (public.can_read_incident(incident_id));

create policy person_status_history_service_insert
  on public.person_status_history for insert
  with check (public.can_write_incident(incident_id));

create policy person_merges_member_select
  on public.person_merges for select
  using (public.can_read_incident(incident_id));

create policy person_merges_commander_insert
  on public.person_merges for insert
  with check (public.can_command_incident(incident_id));

create policy event_logs_member_select
  on public.event_logs for select
  using (public.can_read_incident(incident_id));

create policy event_logs_service_insert
  on public.event_logs for insert
  with check (public.can_write_incident(incident_id));
