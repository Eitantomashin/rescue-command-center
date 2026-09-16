-- TWO connections, DISPOSABLE LOCAL database ONLY; this test commits fixtures.
-- SET rcc.equipment_lifecycle_test_database='disposable-local' in both sessions.
-- Supply identical psql variables:
-- incident_id, assignment_id, expected_version, actor_id (active admin),
-- team_id, free_item_id (different free item), request_id (fresh UUID),
-- operation = start | resume | assign | refuel | release | close | fail_close
-- first = close | operation
-- Use a FRESH active incident with one open assignment for each case. Its state
-- must permit the operation: off for start/fail_close, previously started paused
-- for resume/refuel, off or paused for release/close/assign. Optional live alerts
-- and deliveries exercise cancellation. No existing operational data allowed.
-- Run each of the six ordinary operations in BOTH orders; fail_close only with
-- first=close. fail_close injects failure after equipment releases; B then starts.
-- A: \set side A then \i this_file
-- B: \set side B then \i this_file while A holds locks for 20 seconds.
-- After both commit: \set side VERIFY then \i this_file as owner.
-- lock_timeout/statement_timeout turn deadlocks or unexpected waits into failure.
\set ON_ERROR_STOP on
do $$ begin
  if current_setting('rcc.equipment_lifecycle_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required'; end if;
end $$;
select :'side'='A' as run_a, :'side'='B' as run_b, :'side'='VERIFY' as run_verify \gset
select set_config('equipment.test.incident',:'incident_id',false);
select set_config('equipment.test.assignment',:'assignment_id',false);
select set_config('equipment.test.version',:'expected_version',false);
select set_config('equipment.test.team',:'team_id',false);
select set_config('equipment.test.free_item',:'free_item_id',false);
select set_config('equipment.test.request',:'request_id',false);
select set_config('equipment.test.operation',:'operation',false);
select set_config('equipment.test.first',:'first',false);
select set_config('request.jwt.claim.sub',:'actor_id',false);
select set_config('request.jwt.claims','{}',false);
do $$ begin
  if current_setting('equipment.test.operation') not in ('start','resume','assign','refuel','release','close','fail_close')
    or current_setting('equipment.test.first') not in ('close','operation')
    or (current_setting('equipment.test.operation')='fail_close' and current_setting('equipment.test.first')<>'close') then
    raise exception 'Invalid test mode'; end if;
end $$;
create or replace function pg_temp.run_equipment_race_action(p_action text) returns jsonb language plpgsql as $$
declare i uuid:=current_setting('equipment.test.incident')::uuid;
  a uuid:=current_setting('equipment.test.assignment')::uuid;
  v bigint:=current_setting('equipment.test.version')::bigint;
  r uuid:=current_setting('equipment.test.request')::uuid;
begin
  case p_action
    when 'close' then return to_jsonb(public.close_incident_lifecycle(i));
    when 'start' then return public.start_equipment(i,a,v,r);
    when 'fail_close' then return public.start_equipment(i,a,v,r);
    when 'resume' then return public.resume_equipment(i,a,v,r);
    when 'assign' then return public.assign_equipment(i,current_setting('equipment.test.free_item')::uuid,r,current_setting('equipment.test.team')::uuid);
    when 'refuel' then return public.confirm_equipment_refuel(i,a,v,r);
    when 'release' then return public.release_equipment(i,a,v,r,'Concurrent manual return');
    else raise exception 'Unknown operation';
  end case;
end $$;

\if :run_a
begin;
set local statement_timeout='50s';
do $$ begin
  if not exists(select 1 from public.incidents where id=current_setting('equipment.test.incident')::uuid
    and lifecycle_status='active' and not is_closed and archived_at is null)
    or exists(select 1 from public.closure_reports where incident_id=current_setting('equipment.test.incident')::uuid) then
    raise exception 'Fresh active fixture without closure reports required'; end if;
end $$;
-- Retain this outer event lock even if the deliberately failed close rolls back
-- its subtransaction; B must really wait before starting the restored equipment.
select id from public.incidents where id=:'incident_id'::uuid for update;
create or replace function pg_temp.fail_race_close_log() returns trigger language plpgsql as $$
begin
  if new.incident_id=current_setting('equipment.test.incident')::uuid and new.log_type='incident_closed' then
    raise exception 'Injected close failure' using errcode='P0001'; end if;
  return new;
end $$;
do $$ declare v_error text; v_message text; v_before jsonb; v_after jsonb;
begin
  if current_setting('equipment.test.operation')='fail_close' then
    select jsonb_agg(to_jsonb(a) order by id) into v_before from public.incident_equipment_assignments a where incident_id=current_setting('equipment.test.incident')::uuid;
    begin
      create trigger lifecycle_race_failure before insert on public.event_logs for each row execute function pg_temp.fail_race_close_log();
      set local role authenticated;
      perform pg_temp.run_equipment_race_action('close');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text;
    end;
    reset role;
    if v_error is distinct from 'P0001' or v_message is distinct from 'Injected close failure' then raise exception 'Wrong injected failure: % / %',v_error,v_message; end if;
    select jsonb_agg(to_jsonb(a) order by id) into v_after from public.incident_equipment_assignments a where incident_id=current_setting('equipment.test.incident')::uuid;
    if v_before is distinct from v_after or exists(select 1 from public.event_logs
      where incident_id=current_setting('equipment.test.incident')::uuid and log_type in ('equipment_released','incident_closed')) then
      raise exception 'Failed closure left partial releases'; end if;
  else
    set local role authenticated;
    perform pg_temp.run_equipment_race_action(case when current_setting('equipment.test.first')='close' then 'close' else current_setting('equipment.test.operation') end);
    reset role;
  end if;
end $$;
\echo A holds the event lock for 20 seconds. Run B NOW.
select pg_sleep(20);
commit;
\endif

\if :run_b
begin;
set local role authenticated;
set local lock_timeout='40s';
set local statement_timeout='45s';
do $$ declare started timestamptz:=clock_timestamp(); actual text; expected text;
  op text:=current_setting('equipment.test.operation'); first_op text:=current_setting('equipment.test.first');
begin
  if op='fail_close' then expected:=null;
  elsif first_op='close' and op<>'close' then expected:='55000';
  elsif first_op='operation' and op in ('start','resume') then expected:='55000';
  else expected:=null; end if;
  begin
    perform pg_temp.run_equipment_race_action(case when first_op='close' then op else 'close' end);
  exception when others then get stacked diagnostics actual=returned_sqlstate; end;
  if actual is distinct from expected then raise exception 'Unexpected race outcome: expected %, got %',expected,actual; end if;
  if clock_timestamp()-started<interval '1 second' then raise exception 'No overlap: rerun on a fresh fixture while A holds locks'; end if;
  raise notice 'PASS: overlapping % / % serialized; no deadlock',first_op,op;
end $$;
commit;
\endif

\if :run_verify
begin;
do $$ declare expect_closed boolean;
begin
  expect_closed:=not (current_setting('equipment.test.operation')='fail_close'
    or (current_setting('equipment.test.first')='operation' and current_setting('equipment.test.operation') in ('start','resume')));
  if expect_closed then
    if not exists(select 1 from public.incidents where id=current_setting('equipment.test.incident')::uuid and is_closed and lifecycle_status='closed')
      or exists(select 1 from public.incident_equipment_assignments where incident_id=current_setting('equipment.test.incident')::uuid and released_at is null)
      or exists(select 1 from public.equipment_cycles where incident_id=current_setting('equipment.test.incident')::uuid and ended_at is null)
      or exists(select 1 from public.equipment_cycle_alerts where incident_id=current_setting('equipment.test.incident')::uuid and resolved_at is null)
      or exists(select 1 from public.equipment_alert_deliveries where incident_id=current_setting('equipment.test.incident')::uuid
        and (lease_until is not null or presentation_token is not null or next_due_at is not null or snoozed_until is not null))
      or (select count(*) from public.closure_reports where incident_id=current_setting('equipment.test.incident')::uuid)<>1 then
      raise exception 'Successful closure left open equipment/schedules or duplicate reports'; end if;
  else
    if not exists(select 1 from public.incidents where id=current_setting('equipment.test.incident')::uuid and not is_closed and lifecycle_status='active')
      or not exists(select 1 from public.equipment_cycles where assignment_id=current_setting('equipment.test.assignment')::uuid and ended_at is null and operation_state='running')
      or exists(select 1 from public.event_logs where incident_id=current_setting('equipment.test.incident')::uuid and log_type in ('equipment_released','incident_closed'))
      or exists(select 1 from public.closure_reports where incident_id=current_setting('equipment.test.incident')::uuid) then
      raise exception 'Blocked/failed close left partial state'; end if;
  end if;
  raise notice 'PASS: final lifecycle and equipment invariants';
end $$;
rollback;
\endif
