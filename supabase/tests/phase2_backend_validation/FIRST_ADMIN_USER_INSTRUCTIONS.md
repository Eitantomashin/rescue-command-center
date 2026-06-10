# Creating the First System Administrator

The database uses Supabase Auth user IDs as profile IDs. The first administrator must start as a real Supabase Auth user.

## Steps

1. Deploy the Phase 2.2 migration:

```text
supabase/migrations/20260610212200_phase2_2_sql_editor_validation_context.sql
```

2. Open your Supabase project.
3. Go to Authentication.
4. Create a user manually, or sign up normally through Supabase Auth.
5. Copy the user's UUID from the Users table.
6. Open:

```text
supabase/tests/phase2_backend_validation/ADMIN_BOOTSTRAP.sql
```

7. Replace:

```text
00000000-0000-0000-0000-000000000000
```

with the copied Auth user UUID.

8. Run the script in Supabase SQL Editor.
9. Confirm the output includes:

```text
role = system_administrator
```

## Why this is required

Most operational database functions use:

```sql
auth.uid()
```

and then check `public.profiles.role` or incident membership. Without a profile row, the user has no operational permissions.

## Recommended first validation

After bootstrapping the administrator:

1. Open `RUN_ALL_VALIDATIONS.sql`.
2. Use the same UUID as `v_test_user_id`.
3. Run the script.
4. Confirm the final pass notice appears.
