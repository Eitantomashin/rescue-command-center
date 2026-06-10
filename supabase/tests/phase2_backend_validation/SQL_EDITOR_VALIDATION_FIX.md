# Phase 2.2 SQL Editor Validation Fix

Supabase SQL Editor does not run with a normal request JWT. That means:

```sql
auth.uid()
```

and:

```sql
current_setting('request.jwt.claim.sub', true)
```

can both return `null`.

The production business functions were correct to rely on the authenticated actor, but SQL Editor validation needs an explicit test actor.

## Migration

Deploy:

```text
supabase/migrations/20260610212200_phase2_2_sql_editor_validation_context.sql
```

This adds:

- `public.sql_editor_validation_mode_enabled()`
- `public.current_actor_id()`

`current_actor_id()` works like this:

- In production/API calls, it returns `auth.uid()`.
- In SQL Editor validation, when explicitly enabled, it returns `rcc.test_user_id`.
- If neither exists, it returns `null`.

Production behavior remains anchored to `auth.uid()`. The validation actor is only used when the SQL session explicitly sets:

```sql
select set_config('rcc.sql_editor_validation_mode', 'on', false);
select set_config('rcc.test_user_id', '<auth-user-id>', false);
```

## How To Run In Supabase SQL Editor

1. Deploy the Phase 2.2 migration.
2. Create a Supabase Auth user.
3. Run `ADMIN_BOOTSTRAP.sql` after replacing the placeholder UUID.
4. Run `RUN_ALL_VALIDATIONS.sql` after replacing the placeholder UUID.

For the numbered validation scripts:

1. Run `00_SET_TEST_CONTEXT.sql` first.
2. Run `01_...` through `06_...` in order.

## Security Notes

- Production requests still use `auth.uid()` first.
- The validation setting does not bypass role checks.
- The explicit test user must still exist in `public.profiles`.
- `RUN_ALL_VALIDATIONS.sql` requires that test profile to be `system_administrator`.
- No UI or API code is involved.
