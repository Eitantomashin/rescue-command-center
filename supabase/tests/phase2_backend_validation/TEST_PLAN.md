# Phase 2 Backend Validation Test Plan

This test plan validates database behavior and business logic only. It does not include UI or application code.

## Prerequisites

- Phase 2.2 SQL Editor validation migration is deployed.
- Phase 1 and Phase 1.5 migrations are deployed.
- Global status seed data exists in `status_types`.
- At least one Supabase Auth user exists.
- That user has a matching `public.profiles` row.
- Preferably the test profile role is `system_administrator`.

## Test context

Before running the validation scripts, edit:

```text
supabase/tests/phase2_backend_validation/00_SET_TEST_CONTEXT.sql
```

Replace:

```text
00000000-0000-0000-0000-000000000000
```

with an existing `auth.users.id`.

Run the scripts in order in one SQL session when possible.

`00_SET_TEST_CONTEXT.sql` explicitly enables SQL Editor validation mode, because SQL Editor does not provide `auth.uid()`.

## Script order

1. `00_SET_TEST_CONTEXT.sql`
2. `01_incident_creation.sql`
3. `02_site_floor_unit_generation.sql`
4. `03_floor_reduction.sql`
5. `04_person_workflow.sql`
6. `05_team_creation_assignment.sql`
7. `06_person_merge_dashboard_event_log_validation.sql`

## Validation coverage

### Incident creation

Script: `01_incident_creation.sql`

Expected:

- incident is created
- current user is added as incident commander
- `incident_opened` EventLog is created

### Site creation and structure generation

Script: `02_site_floor_unit_generation.sql`

Expected:

- `create_site_with_structure()` creates Site 1
- 3 floors are created
- 12 units are created
- `initial_potential = 60`
- `updated_potential = 60`
- `site_created` EventLog is created

### Floor reduction

Script: `03_floor_reduction.sql`

Expected:

- top floor is reduced from 4 active units to 2 active units
- 2 units become inactive
- no units are deleted
- `floor_unit_count_changed` EventLog is created

### Person creation, reassignment, and status update

Script: `04_person_workflow.sql`

Expected:

- person 101 is created
- `person_created` EventLog is created
- person 101 is reassigned to a valid site/floor/unit
- `person_reassigned` EventLog includes old/new location metadata
- status update creates `person_status_history`
- `person_status_changed` EventLog is created

### Team creation and assignment

Script: `05_team_creation_assignment.sql`

Expected:

- Team 1 is created
- Team 1 is assigned to Site 1
- assignment history is preserved
- `team_created` and `team_assigned` EventLogs exist

### Person merge and dashboard

Script: `06_person_merge_dashboard_event_log_validation.sql`

Expected:

- person 901 is created
- person 901 is merged into person 101
- `person_merges` record exists
- person 901 has `is_merged = true`
- person 901 has `merged_into_person_id = person 101`
- person 901 status is duplicate/cancelled
- `person_merged` EventLog exists
- dashboard excludes merged duplicate records
- operational gap follows `updated_potential - resolved_persons`

## Demo data setup

Run:

```text
DEMO_INCIDENT_SETUP.sql
```

Expected demo data:

- Incident: `Demo Rescue Event`
- Site 1
- 5 floors
- 4 apartments per floor
- Team 1
- Team 2
- example residents across several apartments

## Direct write hardening checks

The validation scripts also assume these direct writes should be blocked:

- direct insert into `event_logs`
- direct insert into `person_status_history`
- direct insert into `person_merges`
- direct site/floor/unit structure changes
- direct person location/status/merge updates

Approved functions should be used instead.

## Pass criteria

The phase passes when:

- every script completes without raised exceptions
- expected rows exist
- event logs exist for all significant actions
- dashboard views reflect calculated state
- merged/duplicate persons are excluded from counts
- floor reduction deactivates units instead of deleting them
