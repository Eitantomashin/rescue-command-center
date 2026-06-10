# RCC Role Model and RLS Proposal

## Roles

Global role, stored on `profiles.role`:

- `system_administrator`
- `incident_commander`
- `command_post_operator`
- `observer`

Incident-specific role, stored on `incident_memberships.role`:

- `incident_commander`
- `command_post_operator`
- `observer`

System Administrators have global operational authority. Other users receive access through incident membership.

## Access rules

Observers:

- Can read incident data where they are members.
- Cannot create, update, merge, close, or correct operational records.

Command Post Operators:

- Can create and update routine operational records for active incidents.
- Can create persons, residents, units updates, and event logs through shared functions.
- Cannot merge persons or close incidents unless separately elevated.

Incident Commanders:

- Can perform operator actions.
- Can assign and release teams.
- Can merge persons.
- Can close incidents.
- Can perform authorized correction actions on closed incidents when a reason is captured.

System Administrators:

- Can manage users, global statuses, and system configuration.
- Can correct closed incident data.
- Should be the only role allowed to bypass normal closed-incident restrictions.

## RLS strategy

The migration enables RLS on all core tables.

Read access:

- Requires incident membership or System Administrator role.
- Global statuses are readable by authenticated users.

Write access:

- Requires write-level incident role.
- Closed incident enforcement should be centralized in shared database functions.
- Critical operations should not be performed by direct table writes from UI components.

Immutable tables:

- `event_logs`
- `person_status_history`
- `person_merges`

These tables have database triggers that reject updates and deletes.

## Important follow-up

For production hardening, direct table writes for operational tables should be further narrowed after service/RPC functions are implemented for each workflow. The current Phase 1 policies are a practical foundation, but the long-term goal is function-first mutation.

## Shared database functions created in Phase 1

- `create_event_log(...)`
- `create_authorized_correction_event_log(...)`
- `close_incident(incident_id, reason)`
- `next_operational_number(incident_id)`
- `can_write_incident(incident_id)`
- `can_correct_closed_incident(incident_id)`
- `update_person_status(...)`
- `set_unit_clearance(unit_id, is_fully_cleared, override_reason)`
- `set_floor_unit_count(floor_id, units_count, reason)`
- `has_open_persons_in_unit(unit_id)`

These functions establish the mutation pattern for later phases: operational actions should happen through shared service/database functions that create the required audit trail.

Closed incidents are read-only under normal write policies. System Administrators may still write. Incident Commander correction workflows should use dedicated correction functions that validate the mandatory reason, call `assert_incident_writable(..., p_is_authorized_correction => true)`, and create a correction EventLog entry with `create_authorized_correction_event_log(...)`.
