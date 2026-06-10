# Supabase Local Development Checklist

Use this checklist before starting database work, before handing off a migration, and before accepting a local validation pass.

## Machine Setup

- [ ] Node.js LTS is installed.
- [ ] Git for Windows is installed.
- [ ] Docker Desktop is installed.
- [ ] Docker Desktop is running.
- [ ] Supabase CLI is installed.
- [ ] PowerShell can run `node`, `npm`, `git`, `docker`, and `supabase`.

## Project Setup

- [ ] PowerShell is opened in the repository root.
- [ ] The `supabase` folder exists.
- [ ] `supabase/config.toml` exists, or `supabase init` has been run.
- [ ] The `supabase/migrations` folder exists.
- [ ] Local Supabase starts with `supabase start`.
- [ ] `supabase status` prints local URLs and credentials.

## Migration Workflow

- [ ] No frontend code is required for the database validation workflow.
- [ ] Migrations are reviewed before running them locally.
- [ ] Existing migrations are not edited after they have been shared or applied elsewhere.
- [ ] New database changes are added as a new timestamped migration.
- [ ] `supabase db reset` completes successfully.
- [ ] `supabase migration list` shows the expected migration history.

## Seed Data

- [ ] Global status seed data is present in `20260610165100_phase1_seed_statuses.sql`.
- [ ] Local reset applies the seed statuses.
- [ ] Status validation in `DATABASE_VALIDATION.md` returns no missing statuses.

## Schema Validation

- [ ] All expected tables exist.
- [ ] All expected functions exist.
- [ ] All expected triggers exist.
- [ ] All expected dashboard views exist.
- [ ] RLS is enabled on all operational tables.
- [ ] Policies exist for the RLS-protected tables.

## Operational Guardrails

- [ ] `event_logs` cannot be inserted directly.
- [ ] `event_logs` cannot be updated.
- [ ] `event_logs` cannot be deleted.
- [ ] `person_status_history` cannot be inserted directly.
- [ ] `person_merges` cannot be inserted directly.
- [ ] Site, floor, and unit structure writes are blocked unless routed through approved database functions.
- [ ] Person operational updates are blocked unless routed through approved database functions.

## Dashboard Validation

- [ ] `person_status_counts` can be queried.
- [ ] `incident_dashboard_summary` can be queried.
- [ ] `site_dashboard_summary` can be queried.
- [ ] `recent_event_logs` can be queried.
- [ ] Empty dashboard results are treated as acceptable when no incident test data exists.

## Before Handoff

- [ ] `SETUP_LOCAL.md` instructions still match the repository layout.
- [ ] `DATABASE_VALIDATION.md` checks still match the current migrations.
- [ ] Local Supabase can be stopped cleanly with `supabase stop`.
- [ ] Any intentionally local data is documented before using `supabase stop --no-backup`.
