# RCC Phase 1 Database Foundation

This phase defines the database and platform foundation only. It does not include UI code or application code.

## Generated migrations

1. `supabase/migrations/20260610165000_phase1_schema.sql`
   - Core schema
   - Constraints and indexes
   - Immutable log/history triggers
   - Shared helper functions

2. `supabase/migrations/20260610165100_phase1_seed_statuses.sql`
   - Global default statuses
   - English internal `status_key`
   - Hebrew display labels

3. `supabase/migrations/20260610165200_phase1_rls_policies.sql`
   - Role baseline
   - Incident membership access model
   - Conservative row-level security policies

4. `supabase/migrations/20260610165300_phase1_dashboard_views.sql`
   - Dashboard calculation views
   - No stored dashboard state

## Key decisions incorporated

- `status_types` includes stable English `status_key`, English `name`, and Hebrew `hebrew_label`.
- Default statuses are global with `incident_id = null`.
- Incident-specific custom statuses are supported through `status_types.incident_id`.
- Reduced floor unit counts should make extra units inactive; units are never deleted.
- Closed incidents are read-only except for System Administrators and authorized correction actions.
- Event logs are immutable and created through shared database functions.
- Incident closure is handled by `close_incident(incident_id, reason)`, which writes an EventLog record.
- `next_operational_number(incident_id)` suggests the next operational number while the unique constraint still allows authorized manual override.
- Operational Gap is calculated as `Updated Potential - Resolved Persons`.
- Duplicate/cancelled persons are not counted.
- General status dashboard behavior is configurable through `is_dashboard_counted` and `is_open`.
- Unit clearance is enforced by `set_unit_clearance(unit_id, is_fully_cleared, override_reason)`.
- Floor count reductions are handled by `set_floor_unit_count(floor_id, units_count, reason)`, which marks extra units inactive instead of deleting them.
- Person status changes are handled by `update_person_status(...)`, which creates both status history and EventLog records.
- Closed-incident correction logging is handled by `create_authorized_correction_event_log(...)`, which requires a correction reason.
- Dashboard views use `security_invoker = true` so Supabase RLS still applies.
- Operational tables have delete-prevention triggers; records must be deactivated, cancelled, merged, or archived.

## Recommended next Phase 1 validation

- Run migrations on a fresh Supabase project.
- Verify Supabase Auth schema availability before migration execution.
- Add a first System Administrator profile after the first auth user is created.
- Smoke-test RLS with one user in each role.
- Test Hebrew labels render correctly after migration.
