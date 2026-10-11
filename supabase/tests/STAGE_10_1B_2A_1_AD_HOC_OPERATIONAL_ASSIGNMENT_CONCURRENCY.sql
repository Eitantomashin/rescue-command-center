-- Stage 10.1B.2A.1 two-session concurrency procedure.
-- DO NOT run against a linked, remote, shared, or production database.
-- Before starting, verify the target is the isolated local Docker PostgreSQL container.
-- This file is a psql procedure: create disposable fixtures first, then substitute
-- the identifiers below in BOTH independent sessions. Every scenario ends with ROLLBACK.
--
-- Required fixture state (created only in the disposable local DB):
--   * an active incident and an authenticated admin/commander actor with access;
--   * source_team and target_team active in that incident;
--   * member_id is an active present membership in source_team;
--   * add_person_id is a distinct present person without an active membership;
--   * archive_team is active and initially has no members or equipment assignment;
--   * attendance_person_id is a distinct present person without active membership.
--
-- In each session set the following local values before executing the scenario SQL:
--   SET rcc.stage_10_1b_2a_1_concurrency_test_database = 'disposable-local';
--   SET request.jwt.claim.sub = '<authorized-user-uuid>';
--   \set incident_id '<incident uuid>'
--   \set source_member_id '<active membership uuid>'
--   \set source_team_id '<source team uuid>'
--   \set target_team_id '<target team uuid>'
--   \set add_person_id '<unassigned present unit_personnel uuid>'
--   \set archive_team_id '<empty team uuid>'
--   \set attendance_person_id '<unassigned present unit_personnel uuid>'
--
-- Shared safety preflight, run in each session.
begin;
do $$
begin
  if current_setting('rcc.stage_10_1b_2a_1_concurrency_test_database', true) is distinct from 'disposable-local' then
    raise exception 'Disposable local database opt-in required';
  end if;
end $$;
set local lock_timeout = '15s';
set local statement_timeout = '30s';
rollback;

-- Scenario A: add versus transfer.
-- Session A: BEGIN; set local lock_timeout='15s';
--   select public.transfer_incident_ad_hoc_team_member(:'incident_id'::uuid, :'source_member_id'::uuid, :'target_team_id'::uuid);
--   select pg_sleep(3); COMMIT;
-- Session B, while A sleeps: BEGIN; set local lock_timeout='15s';
--   select public.add_incident_ad_hoc_team_member(:'incident_id'::uuid, :'target_team_id'::uuid, :'add_person_id'::uuid, null);
--   COMMIT;
-- Expected: both independent people complete successfully after serialization. No 40P01,
-- 55P03, or 57014. Verify one active membership per person and source history is inactive.

-- Scenario B: transfer versus return of the original member id.
-- Session A: BEGIN; set local lock_timeout='15s';
--   select public.transfer_incident_ad_hoc_team_member(:'incident_id'::uuid, :'source_member_id'::uuid, :'target_team_id'::uuid);
--   select pg_sleep(3); COMMIT;
-- Session B, while A sleeps: BEGIN; set local lock_timeout='15s';
--   select public.return_incident_ad_hoc_team_member(:'incident_id'::uuid, :'source_member_id'::uuid);
--   COMMIT;
-- Expected: transfer creates exactly one target membership; the delayed return is an
-- idempotent return of the now-inactive original membership and writes no return event.
-- No deadlock or timeout; final state has one active target membership.

-- Scenario C: add versus archive of one initially empty team.
-- Session A: BEGIN; set local lock_timeout='15s';
--   select public.archive_incident_ad_hoc_team(:'incident_id'::uuid, :'archive_team_id'::uuid);
--   select pg_sleep(3); COMMIT;
-- Session B, while A sleeps: BEGIN; set local lock_timeout='15s';
--   select public.add_incident_ad_hoc_team_member(:'incident_id'::uuid, :'archive_team_id'::uuid, :'add_person_id'::uuid, null);
--   COMMIT;
-- Expected: serialization permits exactly one valid outcome: archive succeeds and add
-- returns P0002 because the team is no longer active, OR add succeeds and archive returns
-- 55000 because an active member exists. Neither session may deadlock or time out.

-- Scenario D: direct attendance update versus add.
-- Session A: BEGIN; set local lock_timeout='15s';
--   update public.event_personnel_status set attendance_status='unavailable'
--   where incident_id=:'incident_id'::uuid and personnel_id=:'attendance_person_id'::uuid;
--   select pg_sleep(3); COMMIT;
-- Session B, while A sleeps: BEGIN; set local lock_timeout='15s';
--   select public.add_incident_ad_hoc_team_member(:'incident_id'::uuid, :'target_team_id'::uuid, :'attendance_person_id'::uuid, null);
--   COMMIT;
-- Expected: if the direct update wins, add returns 55000 after it observes unavailable;
-- if add wins, the attendance trigger returns 55000 after it observes active membership.
-- Final state must never contain an active membership with non-present attendance.
-- Repeat with transfer_incident_ad_hoc_team_member for a present source member and a direct
-- attendance UPDATE in the other session; the same invariant and SQLSTATE expectations apply.

-- Record all session SQLSTATEs. A result of 40P01, 55P03, or 57014 is a failure.
-- Inspect active memberships, attendance, and event_logs before discarding the disposable fixture.
