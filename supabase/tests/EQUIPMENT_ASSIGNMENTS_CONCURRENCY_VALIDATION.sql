-- Two-connection contention test for a DISPOSABLE LOCAL database ONLY.
-- Unlike the rollback-only suite, this test must commit the winning assignment
-- to prove the waiting request is rejected. Use dedicated disposable fixtures.
-- Never point this script at an existing operational/remote database.
--
-- Prerequisites (create separately in the disposable database):
-- * installed migrations, an active admin, two active incidents with active
--   regular teams, one active serviceable item of an active type, initially free.
-- * all connections: SET rcc.equipment_assignment_test_database='disposable-local';
--
-- Open two psql sessions, using ON_ERROR_STOP=1 and the SAME variables:
-- actor_id, incident_a, incident_b, team_a, team_b, item_id.
-- Session A: \set side A, then \i this file.
-- Session B: \set side B, then \i this file WHILE A prints its held-lock message.
-- After both finish, run side VERIFY in either session.
-- B must block on the item row, then fail with 55000 (no other-incident details).
-- A's assignment is released by VERIFY; the audit history remains in the
-- disposable database. This script does not reset or destroy any database.
\set ON_ERROR_STOP on
do $$ begin
  if current_setting('rcc.equipment_assignment_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required';
  end if;
end $$;
select :'side'='A' as run_a, :'side'='B' as run_b, :'side'='VERIFY' as run_verify \gset
select set_config('request.jwt.claim.sub',:'actor_id',false);
select set_config('request.jwt.claims','{}',false);
select set_config('equipment.test.incident_a',:'incident_a',false);
select set_config('equipment.test.incident_b',:'incident_b',false);
select set_config('equipment.test.item_id',:'item_id',false);
select set_config('equipment.test.team_b',:'team_b',false);

\if :run_a
begin;
set local role authenticated;
select public.assign_equipment(:'incident_a'::uuid,:'item_id'::uuid,gen_random_uuid(),:'team_a'::uuid);
\echo A holds the item lock for 20 seconds. Run session B NOW.
select pg_sleep(20);
commit;
\endif

\if :run_b
begin;
set local role authenticated;
set local lock_timeout='40s';
do $$
declare v_started timestamptz:=clock_timestamp(); v_state text; v_message text;
begin
  begin
    perform public.assign_equipment(current_setting('equipment.test.incident_b')::uuid,
      current_setting('equipment.test.item_id')::uuid,gen_random_uuid(),current_setting('equipment.test.team_b')::uuid);
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  end;
  if v_state is distinct from '55000' or v_message is distinct from 'פריט הציוד אינו פנוי להקצאה' then
    raise exception 'FAIL: waiting allocation must fail generically, got % / %',v_state,v_message;
  end if;
  if clock_timestamp()-v_started < interval '1 second' then
    raise exception 'Test did not overlap. Use a fresh free fixture and run B while A holds the lock';
  end if;
  raise notice 'PASS: overlapping request waited, then rejected without incident disclosure';
end $$;
rollback;
\endif

\if :run_verify
begin;
set local role authenticated;
do $$
declare v_assignment public.incident_equipment_assignments%rowtype; v_count integer;
begin
  select count(*) into v_count from public.incident_equipment_assignments
    where equipment_item_id=current_setting('equipment.test.item_id')::uuid and released_at is null;
  if v_count<>1 then raise exception 'FAIL: expected exactly one open assignment, got %',v_count; end if;
  select * into v_assignment from public.incident_equipment_assignments
    where equipment_item_id=current_setting('equipment.test.item_id')::uuid and released_at is null;
  if v_assignment.incident_id<>current_setting('equipment.test.incident_a')::uuid then
    raise exception 'FAIL: unexpected winning incident';
  end if;
  select count(*) into v_count from public.equipment_cycles where assignment_id=v_assignment.id;
  if v_count<>1 then raise exception 'FAIL: expected one cycle'; end if;
  select count(*) into v_count from public.event_logs where entity_id=v_assignment.id and log_type='equipment_assigned';
  if v_count<>1 then raise exception 'FAIL: expected one assignment log'; end if;
  perform public.release_equipment(v_assignment.incident_id,v_assignment.id,v_assignment.version,gen_random_uuid(),'Concurrency validation finished');
  raise notice 'PASS: exactly one assignment, cycle and log; disposable fixture released';
end $$;
commit;
\endif
