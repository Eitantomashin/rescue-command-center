# Phase 2.1 Validation Checklist

Use this checklist to execute backend validation against Supabase.

## First system administrator user

0. Deploy the Phase 2.2 migration:

```text
supabase/migrations/20260610212200_phase2_2_sql_editor_validation_context.sql
```

1. Create a user in Supabase Auth.
2. Open Supabase Dashboard.
3. Go to Authentication > Users.
4. Copy the user UUID.
5. Open `ADMIN_BOOTSTRAP.sql`.
6. Replace `00000000-0000-0000-0000-000000000000` with that UUID.
7. Run `ADMIN_BOOTSTRAP.sql` in Supabase SQL Editor.
8. Confirm the result shows `role = system_administrator`.

## Run all validation

1. Open `RUN_ALL_VALIDATIONS.sql`.
2. Replace `00000000-0000-0000-0000-000000000000` with the same system administrator UUID.
3. Run the full script in Supabase SQL Editor. The script enables SQL Editor validation mode internally.
4. Confirm the final notice says:

```text
PHASE 2.1 BACKEND VALIDATION PASSED
```

## Business logic checks

- Incident creation succeeds.
- Incident opened EventLog is created.
- Site 1 is created through `create_site_with_structure()`.
- 3 floors are generated.
- 12 units are generated.
- Initial potential is 60.
- Updated potential is 60.
- Top floor reduction keeps 4 total units and marks 2 inactive.
- Person 101 is created.
- Person 101 is reassigned to a valid site/floor/unit.
- Person 101 status update creates status history.
- Team 1 is created.
- Team 1 is assigned to Site 1.
- Person 901 is created.
- Person 901 is merged into Person 101.
- Person 901 becomes merged and duplicate/cancelled.
- Dashboard excludes duplicate/cancelled from status counts.
- Dashboard operational gap is calculated.
- All required EventLog entries exist.

## Optional demo setup

After validation passes, run `00_SET_TEST_CONTEXT.sql`, then run `DEMO_INCIDENT_SETUP.sql` to create:

- Demo Rescue Event
- Site 1
- 5 floors
- 4 apartments per floor
- Team 1
- Team 2
- example residents

## Stop criteria

Do not move to UI until:

- `RUN_ALL_VALIDATIONS.sql` passes.
- The event log query returns expected operational events.
- Dashboard views return expected calculated values.
- No direct manual correction was needed during validation.
