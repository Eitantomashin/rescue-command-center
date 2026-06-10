# Local Setup Guide

This guide sets up the Rescue Command Center database locally on Windows. It does not require frontend code.

## 1. Install Node.js LTS

1. Open the Node.js download page: https://nodejs.org/en/download
2. Download the Windows Installer for the current LTS release.
3. Run the installer.
4. Keep the default options unless your team has a different standard.
5. Open a new PowerShell window.
6. Verify the install:

```powershell
node --version
npm --version
```

Both commands should print version numbers.

## 2. Install Git

1. Open the Git for Windows download page: https://git-scm.com/download/win
2. Download and run the installer.
3. Keep the default editor and terminal choices unless you prefer different ones.
4. Open a new PowerShell window.
5. Verify the install:

```powershell
git --version
```

The command should print a Git version.

## 3. Install Docker Desktop

1. Open the Docker Desktop download page: https://www.docker.com/products/docker-desktop/
2. Download Docker Desktop for Windows.
3. Run the installer.
4. Enable WSL 2 integration if prompted.
5. Restart Windows if Docker asks you to.
6. Start Docker Desktop and wait until it says Docker is running.
7. Verify the install:

```powershell
docker --version
docker compose version
```

Both commands should print version information.

## 4. Install Supabase CLI

Install the Supabase CLI with npm:

```powershell
npm install -g supabase
```

Verify the install:

```powershell
supabase --version
```

If PowerShell says the command is not recognized, close and reopen PowerShell. If it still fails, confirm that the global npm folder is on your Windows PATH.

## 5. Open The Project

From PowerShell, move into this repository:

```powershell
cd "C:\Users\eitan\OneDrive\מסמכים\Rescue Command Center"
```

Confirm the Supabase folder exists:

```powershell
dir supabase
```

If `supabase\config.toml` does not exist yet, initialize local Supabase configuration:

```powershell
supabase init
```

When prompted, do not overwrite existing files unless you intentionally want to replace local Supabase configuration.

## 6. Start Local Supabase

Make sure Docker Desktop is running, then start Supabase:

```powershell
supabase start
```

The first run can take several minutes because Docker images need to download.

When startup finishes, Supabase prints local service URLs and credentials. Keep this output available while validating the database.

Helpful local URLs usually include:

- Supabase Studio: `http://127.0.0.1:54323`
- API URL: `http://127.0.0.1:54321`
- Local database URL: shown in the `supabase status` output

To show the local status again:

```powershell
supabase status
```

## 7. Apply Migrations

For a fresh local database, reset the local database and apply all migrations:

```powershell
supabase db reset
```

This applies the migration files in `supabase/migrations` in timestamp order.

Current migrations include:

- `20260610165000_phase1_schema.sql`
- `20260610165100_phase1_seed_statuses.sql`
- `20260610165200_phase1_rls_policies.sql`
- `20260610165300_phase1_dashboard_views.sql`
- `20260610165400_phase1_5_operational_functions.sql`

To confirm migration status:

```powershell
supabase migration list
```

## 8. Run Seed Data

The current seed data for global status types is included in this migration:

```text
supabase/migrations/20260610165100_phase1_seed_statuses.sql
```

Running `supabase db reset` applies that seed data automatically.

There is currently no separate `supabase/seed.sql` file. If one is added later, run another local reset after confirming it is safe to rebuild the local database:

```powershell
supabase db reset
```

## 9. Validate Database Schema

Use Supabase Studio:

1. Start Supabase if it is not already running:

```powershell
supabase start
```

2. Open Studio:

```text
http://127.0.0.1:54323
```

3. Open the SQL Editor.
4. Copy checks from `DATABASE_VALIDATION.md`.
5. Run each section.
6. Confirm the result matches the expected outcome described above each SQL block.

For command-line validation, install PostgreSQL client tools or use a local `psql` binary, then connect with the database URL printed by:

```powershell
supabase status
```

Example:

```powershell
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Then paste validation SQL from `DATABASE_VALIDATION.md`.

## 10. Stop Local Supabase

When finished:

```powershell
supabase stop
```

To stop and remove local database data:

```powershell
supabase stop --no-backup
```

Use `--no-backup` only when you are comfortable deleting the current local database state.
