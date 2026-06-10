# Creating the First System Administrator

The database uses Supabase Auth user IDs as profile IDs. The first administrator must start as a real Supabase Auth user.

## Steps

1. Open your Supabase project.
2. Go to Authentication.
3. Create a user manually, or sign up normally through Supabase Auth.
4. Copy the user's UUID from the Users table.
5. Open:

```text
supabase/tests/phase2_backend_validation/ADMIN_BOOTSTRAP.sql
```

6. Replace:

```text
00000000-0000-0000-0000-000000000000
```

with the copied Auth user UUID.

7. Run the script in Supabase SQL Editor.
8. Confirm the output includes:

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
