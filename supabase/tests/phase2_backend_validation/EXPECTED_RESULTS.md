# Phase 2.1 Expected Results

Expected results for `RUN_ALL_VALIDATIONS.sql`.

## Notices

The SQL Editor should show notices similar to:

```text
1/9 Test context active for system administrator ...
2/9 Incident created: ...
3/9 Site/floor/unit generation validated: ...
4/9 Floor reduction validated: ...
5/9 Person workflow validated: ...
6/9 Team workflow validated: ...
7/9 Merge workflow validated: 901 -> 101
8/9 Event log workflow validated: ...
9/9 Dashboard views validated: ...
PHASE 2.1 BACKEND VALIDATION PASSED. Incident id: ...
```

## Incident

Expected:

- name: `Phase 2.1 Validation Incident`
- status: active
- `is_closed = false`
- one incident membership for the test user as `incident_commander`

## Site, floors, and units

Expected:

- one site: Site 1
- initial floors: 3
- initial units: 12
- top floor reduced to:
  - 2 active units
  - 2 inactive units
  - 4 total units
- no units deleted

## Potential

Expected:

```text
3 floors * 4 units * 5 people per unit = 60
```

So:

- `initial_potential = 60`
- `updated_potential = 60`

## Person workflow

Expected:

- Person 101 exists.
- Person 101 is assigned to Site 1, Floor 1, Unit 1.
- Person 101 status is `trapped_located_not_yet_rescued`.
- One `person_status_history` row exists for the status change.

## Team workflow

Expected:

- Team 1 exists.
- Team 1 status is `assigned`.
- One active `team_site_assignments` row links Team 1 to Site 1.

## Merge workflow

Expected:

- Person 901 exists.
- Person 901 has `is_merged = true`.
- Person 901 has `merged_into_person_id = Person 101`.
- Person 901 status is `duplicate_cancelled`.
- One `person_merges` row links 901 into 101.

## Event logs

Expected key event types:

- `incident_opened`
- `site_created`
- `floor_unit_count_changed`
- `person_created`
- `person_reassigned`
- `person_status_changed`
- `team_created`
- `team_assigned`
- `person_merged`

There are two `person_created` logs: one for 101 and one for 901.

## Dashboard

Expected incident dashboard:

- `total_sites = 1`
- `total_initial_potential = 60`
- `total_updated_potential = 60`
- `total_teams = 1`
- `active_team_site_assignments = 1`
- `duplicate_cancelled` does not appear in `person_status_counts`

Operational gap:

```text
updated_potential - resolved_persons
```

In this validation flow, Person 101 is trapped/open and Person 901 is merged duplicate/cancelled, so resolved persons should remain `0` unless status configuration was changed.

Expected:

```text
operational_gap = 60
```

## Failure indicators

Any raised exception means validation failed. Common causes:

- placeholder UUID was not replaced
- profile was not bootstrapped as `system_administrator`
- Phase 2.2 SQL Editor validation migration was not deployed
- SQL Editor validation mode was not enabled
- status seed data is missing
- Phase 1.5 migration was not deployed
- direct write guards are blocking an action that should be routed through a function
