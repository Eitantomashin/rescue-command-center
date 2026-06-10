# RCC Phase 1.5 Database Hardening

This phase adds operational database functions and consistency guards. It does not include UI or application code.

## Migration

`supabase/migrations/20260610165400_phase1_5_operational_functions.sql`

## Added operational functions

### `create_site_with_structure(...)`

Creates a site, automatically creates floors, automatically creates units, calculates `initial_potential` and `updated_potential`, and writes a `site_created` EventLog entry.

### `reassign_person(...)`

Moves a person to a new site/floor/unit. It validates:

- target site belongs to the same incident
- target floor belongs to the target site
- target unit belongs to the target floor and site
- inactive floors/units/sites cannot be assigned

It writes old and new location data to EventLog metadata.

### `merge_persons(...)`

Merges a duplicate operational card into a primary person. It:

- creates a `person_merges` record
- writes status history for the merged person
- marks the duplicate person as merged
- sets `merged_into_person_id`
- sets duplicate/cancelled status
- creates a `person_merged` EventLog entry

Dashboard views already exclude merged persons and duplicate/cancelled statuses.

## Added consistency validation

Triggers now validate:

- floor incident matches parent site incident
- unit site/floor/incident relationship is consistent
- person site/floor/unit relationship is consistent
- resident unit/person incident relationship is consistent
- team assignment team/site/incident relationship is consistent

## Strengthened write path

The migration adds internal write guards using local transaction settings. Dangerous writes are rejected unless performed inside approved database functions.

Function-only actions:

- site creation with generated structure
- floor structure changes
- unit creation from structure
- unit clearance changes
- person reassignment
- person status changes
- person merge
- EventLog insertion
- PersonStatusHistory insertion
- PersonMerge insertion

Direct writes that can remain allowed in MVP:

- profile self-update
- incident membership management by authorized commanders/admins
- incident creation and basic incident edits until a dedicated incident function is added
- incident-specific status configuration by commanders/admins
- person creation and basic identity/notes/source edits
- unit family name, known people count, and notes
- resident creation/basic edits
- team creation/basic edits

Recommended future hardening:

- add `create_incident(...)`
- add `create_person(...)`
- add `update_person_identity(...)`
- add `create_team(...)`
- add `assign_team_to_site(...)` and `release_team_from_site(...)`
- replace remaining broad table mutations with function-only workflows

## Test checklist

1. Create an auth user and profile with `system_administrator`.
2. Create an active incident using the global `incident.active` status.
3. Add incident membership for the testing user if not using system administrator.
4. Call `create_site_with_structure` with 3 floors and 4 units per floor.
5. Verify:
   - 1 site exists
   - 3 floors exist
   - 12 units exist
   - `initial_potential = 3 * 4 * default_people_per_unit + additional_potential`
   - `updated_potential = initial_potential`
   - `site_created` EventLog exists
6. Reduce the top floor to 2 units with `set_floor_unit_count`.
7. Verify:
   - top floor `units_count = 2`
   - 2 units on that floor are inactive
   - no units were deleted
   - `floor_unit_count_changed` EventLog exists
8. Create person 101 with status `missing`.
9. Call `reassign_person` to assign 101 to a valid floor/unit.
10. Verify:
    - person location changed
    - old/new location metadata exists in `person_reassigned` EventLog
11. Call `update_person_status` to change 101 status.
12. Verify:
    - `persons.current_status_id` changed
    - `person_status_history` row exists
    - `person_status_changed` EventLog exists
13. Create person 901 with status `missing`.
14. Call `merge_persons(101, 901, reason)`.
15. Verify:
    - `person_merges` row exists
    - person 901 has `is_merged = true`
    - person 901 has `merged_into_person_id = 101`
    - person 901 has duplicate/cancelled status
    - `person_merged` EventLog exists
16. Verify dashboard views:
    - merged person is not counted as active
    - duplicate/cancelled is not counted
    - resolved count follows status flags
    - operational gap remains `updated_potential - resolved_persons`
17. Attempt blocked direct writes:
    - direct insert into `event_logs`
    - direct update of `persons.current_status_id`
    - direct update of `persons.site_id`
    - direct insert into `person_merges`
    - direct site insert
18. Confirm each blocked direct write raises an exception.
