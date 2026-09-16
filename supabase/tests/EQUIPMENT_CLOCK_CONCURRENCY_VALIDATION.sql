-- Two psql sessions, ONLY on a disposable LOCAL Supabase database.
-- These contention tests COMMIT fixture changes, unlike the rollback suite.
-- Use separately created disposable fixtures; no operational data or resets.
-- Run each action: start_equipment / pause_equipment / resume_equipment /
-- confirm_equipment_refuel, each with replay=false and replay=true (8 cases).
-- Supply the SAME variables in both sessions:
-- actor_id (active admin), incident_id (active/paused), assignment_id (open),
-- expected_version, action, request_a, request_b, replay (true/false).
-- The fixture's open cycle must allow the action; refuel must have been started.
-- Both request UUIDs must be unused and DISTINCT. One fresh fixture per case.
-- SET rcc.equipment_clock_test_database='disposable-local' in both connections.
-- A: \set side A then \i this_file
-- B: \set side B then \i this_file WHILE A holds the lock.
-- After both finish: \set side VERIFY then \i this_file
-- A commits one transition. B waits, then replays A or rejects stale version.
\set ON_ERROR_STOP on
do $$ begin
  if current_setting('rcc.equipment_clock_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required';
  end if;
end $$;
select :'side'='A' as run_a, :'side'='B' as run_b, :'side'='VERIFY' as run_verify \gset
select set_config('request.jwt.claim.sub',:'actor_id',false);
select set_config('request.jwt.claims','{}',false);
select set_config('equipment.test.incident',:'incident_id',false);
select set_config('equipment.test.assignment',:'assignment_id',false);
select set_config('equipment.test.version',:'expected_version',false);
select set_config('equipment.test.action',:'action',false);
select set_config('equipment.test.request_a',:'request_a',false);
select set_config('equipment.test.request_b',:'request_b',false);
select set_config('equipment.test.replay',:'replay',false);
do $$ begin
  if current_setting('equipment.test.action') not in ('start_equipment','pause_equipment','resume_equipment','confirm_equipment_refuel')
    or current_setting('equipment.test.request_a')::uuid=current_setting('equipment.test.request_b')::uuid then
    raise exception 'Invalid test action or request IDs';
  end if;
end $$;

\if :run_a
begin;
set local role authenticated;
do $$ declare result jsonb;
begin
  if exists(select 1 from public.equipment_operation_requests where actor_id=auth.uid()
    and request_id in (current_setting('equipment.test.request_a')::uuid,current_setting('equipment.test.request_b')::uuid)) then
    raise exception 'Use fresh request IDs';
  end if;
  execute format('select public.%I($1,$2,$3,$4)',current_setting('equipment.test.action')) into result using
    current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.assignment')::uuid,
    current_setting('equipment.test.version')::bigint,current_setting('equipment.test.request_a')::uuid;
end $$;
\echo A holds locks for 20 seconds. Run B NOW.
select pg_sleep(20);
commit;
\endif

\if :run_b
begin;
set local role authenticated;
set local lock_timeout='40s';
do $$ declare started timestamptz:=clock_timestamp(); result jsonb; original jsonb; error_state text;
  replay boolean:=current_setting('equipment.test.replay')::boolean;
begin
  begin
    execute format('select public.%I($1,$2,$3,$4)',current_setting('equipment.test.action')) into result using
      current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.assignment')::uuid,
      current_setting('equipment.test.version')::bigint,
      current_setting(case when replay then 'equipment.test.request_a' else 'equipment.test.request_b' end)::uuid;
  exception when others then get stacked diagnostics error_state=returned_sqlstate;
  end;
  if clock_timestamp()-started<interval '1 second' then raise exception 'No overlap: repeat with a fresh fixture while A holds locks'; end if;
  if replay then
    select r.result into original from public.equipment_operation_requests r where actor_id=auth.uid()
      and request_id=current_setting('equipment.test.request_a')::uuid;
    if error_state is not null or result is null or result is distinct from original then
      raise exception 'FAIL: replay must return original result, got %',error_state;
    end if;
  elsif error_state is distinct from '40001' then raise exception 'FAIL: stale contender must fail 40001, got %',error_state;
  end if;
  raise notice 'PASS: overlapping operation serialized correctly (replay=%)',replay;
end $$;
rollback;
\endif

\if :run_verify
begin;
set local role authenticated;
do $$ declare result jsonb; assignment public.incident_equipment_assignments; cycle public.equipment_cycles; log_row public.event_logs;
begin
  select r.result into result from public.equipment_operation_requests r where actor_id=auth.uid()
    and request_id=current_setting('equipment.test.request_a')::uuid;
  select * into assignment from public.incident_equipment_assignments where id=current_setting('equipment.test.assignment')::uuid;
  select * into cycle from public.equipment_cycles where assignment_id=assignment.id and ended_at is null;
  if result is null or assignment.version<>current_setting('equipment.test.version')::bigint+1
    or cycle.id::text is distinct from result->>'cycle_id' or cycle.operation_state is distinct from result->>'operation_state'
    or cycle.accumulated_active_seconds is distinct from (result->>'accumulated_active_seconds')::numeric
    or cycle.running_since is distinct from (result->>'running_since')::timestamptz then
    raise exception 'FAIL: competing operations changed clock or version more than once';
  end if;
  if exists(select 1 from public.equipment_operation_requests where actor_id=auth.uid()
    and request_id=current_setting('equipment.test.request_b')::uuid) then raise exception 'FAIL: loser request persisted'; end if;
  if (select count(*) from public.event_logs where incident_id=assignment.incident_id
    and metadata->>'request_id'=current_setting('equipment.test.request_a'))<>1 then raise exception 'FAIL: expected one log'; end if;
  select * into log_row from public.event_logs where incident_id=assignment.incident_id
    and metadata->>'request_id'=current_setting('equipment.test.request_a');
  if current_setting('equipment.test.action')='confirm_equipment_refuel' and (
    cycle.cycle_number<>(log_row.before_state->>'cycle_number')::int+1
    or cycle.first_started_at is not null or cycle.accumulated_active_seconds<>0
    or (select count(*) from public.equipment_cycles where assignment_id=assignment.id
      and cycle_number>(log_row.before_state->>'cycle_number')::int)<>1) then
    raise exception 'FAIL: refuel created multiple cycles or started automatically';
  end if;
  raise notice 'PASS: one version increment, one log, one resulting cycle state';
end $$;
rollback;
\endif
