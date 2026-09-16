-- Stage 4. Run as postgres ONLY on a disposable LOCAL Supabase database.
-- Migrations must already be installed there. psql -v ON_ERROR_STOP=1.
-- Opt in: SET rcc.equipment_clock_test_database='disposable-local';
-- All fixtures, timestamp adjustments and injected failures roll back.
begin;
do $$ begin
  if current_setting('rcc.equipment_clock_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required';
  end if;
end $$;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create function pg_temp.expect_error(command text,expected text,label text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute command; exception when others then get stacked diagnostics actual=returned_sqlstate; end;
  perform pg_temp.check_true(actual is not distinct from expected,label || ' SQLSTATE=' || coalesce(actual,'success'));
end $$;
create temporary table clock_test_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into clock_test_ids(key) values ('admin'),('commander'),('editor'),('viewer'),('search_user'),
  ('inactive'),('deleted'),('outsider'),('readonly_editor'),('incident'),('other'),('team');
create function pg_temp.id(key_name text) returns uuid language sql as $$ select id from clock_test_ids where key=key_name $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('rcc.sql_editor_validation_mode','off',true);
insert into auth.users(id,email,raw_user_meta_data)
select id,id::text || '@equipment-clock.invalid','{}'::jsonb from clock_test_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
delete from public.profiles where id in (select id from clock_test_ids);
insert into public.profiles(id,role,is_active,deleted_at)
select id,case when key in ('inactive','deleted') then 'admin' when key in ('outsider','readonly_editor') then 'editor' else key end,
  key<>'inactive',case when key='deleted' then now() else null end
from clock_test_ids where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
insert into public.incidents(id,name,address,status_id,lifecycle_status)
select id,'Clock fixture ' || key,'Test',public.get_status_id('incident','active',null),'active'
from clock_test_ids where key in ('incident','other');
insert into public.teams(id,incident_id,team_number,name) values(pg_temp.id('team'),pg_temp.id('incident'),1,'Clock team');
insert into public.incident_memberships(incident_id,user_id,role)
select pg_temp.id('incident'),id,case when key='editor' then 'command_post_operator' else 'observer' end
from clock_test_ids where key in ('editor','viewer','search_user','readonly_editor');
insert into clock_test_ids values ('type',public.create_equipment_type('Clock generator','Power',7200,1800));
insert into clock_test_ids values ('item',public.create_equipment_item(pg_temp.id('type'),'clock-' || gen_random_uuid()::text));
grant select,insert on clock_test_ids to authenticated;
set local role authenticated;
insert into clock_test_ids values ('assignment',(public.assign_equipment(pg_temp.id('incident'),pg_temp.id('item'),gen_random_uuid(),pg_temp.id('team'))->>'assignment_id')::uuid);

-- Test-only convenience wrappers still execute public RPCs with caller privileges.
create function pg_temp.act(action text,request uuid default gen_random_uuid(),expected bigint default null)
returns jsonb language plpgsql as $$
declare result jsonb; current_version bigint;
begin
  select version into current_version from public.incident_equipment_assignments where id=pg_temp.id('assignment');
  execute format('select public.%I($1,$2,$3,$4)',action)
    into result using pg_temp.id('incident'),pg_temp.id('assignment'),coalesce(expected,current_version),request;
  return result;
end $$;
select pg_temp.expect_error('select pg_temp.act(''confirm_equipment_refuel'')','55000','off refuel rejected');
select pg_temp.expect_error('select pg_temp.act(''resume_equipment'')','55000','off resume rejected');
select pg_temp.expect_error('select pg_temp.act(''pause_equipment'')','55000','off pause rejected');
select pg_temp.check_true(pg_temp.act('start_equipment')->>'operation_state'='running','off starts');
select pg_temp.expect_error('select pg_temp.act(''start_equipment'')','55000','double start rejected');
select pg_temp.expect_error('select pg_temp.act(''resume_equipment'')','55000','running resume rejected');
select pg_temp.expect_error('select pg_temp.act(''pause_equipment'',gen_random_uuid(),1)','40001','stale version rejected');
reset role;

-- Backdate ONLY our running cycle; no server clock change, no sleeps.
create function pg_temp.backdate_segment(seconds numeric) returns void language plpgsql as $$
begin
  update public.equipment_cycles set running_since=clock_timestamp()-make_interval(secs=>seconds::double precision),
    first_started_at=least(first_started_at,clock_timestamp()-make_interval(secs=>seconds::double precision)-interval '1 second')
  where assignment_id=pg_temp.id('assignment') and ended_at is null and operation_state='running';
  if not found then raise exception 'Test requires a running fixture'; end if;
end $$;
select pg_temp.backdate_segment(120);
set local role authenticated;
do $$ declare before_row public.equipment_cycles; result jsonb; expected numeric;
begin
  select * into before_row from public.equipment_cycles where assignment_id=pg_temp.id('assignment') and ended_at is null;
  result:=pg_temp.act('pause_equipment');
  expected:=before_row.accumulated_active_seconds+extract(epoch from ((result->>'server_now')::timestamptz-before_row.running_since));
  perform pg_temp.check_true((result->>'elapsed_seconds')::numeric=expected and (result->>'accumulated_active_seconds')::numeric=expected
    and result->>'running_since' is null and result->>'cycle_id'=before_row.id::text,'pause accumulates exact server-time segment');
end $$;
select pg_temp.expect_error('select pg_temp.act(''pause_equipment'')','55000','double pause rejected');
do $$ declare first_read jsonb; second_read jsonb; result jsonb;
begin
  first_read:=public.get_incident_equipment_state(pg_temp.id('incident'));
  second_read:=public.get_incident_equipment_state(pg_temp.id('incident'));
  perform pg_temp.check_true(first_read#>'{equipment,0,remaining_seconds}'=second_read#>'{equipment,0,remaining_seconds}'
    and first_read->>'server_now' is not null,'paused read remains constant and includes server time');
  result:=pg_temp.act('resume_equipment');
  perform pg_temp.check_true(result->>'operation_state'='running'
    and result->'accumulated_active_seconds'=first_read#>'{equipment,0,accumulated_active_seconds}','resume preserves accumulation');
end $$;
reset role;
select pg_temp.backdate_segment(240);
set local role authenticated;
do $$ declare before_row public.equipment_cycles; result jsonb;
begin
  select * into before_row from public.equipment_cycles where assignment_id=pg_temp.id('assignment') and ended_at is null;
  result:=pg_temp.act('pause_equipment');
  perform pg_temp.check_true((result->>'accumulated_active_seconds')::numeric=before_row.accumulated_active_seconds+
    extract(epoch from ((result->>'server_now')::timestamptz-before_row.running_since))
    and (result->>'elapsed_seconds')::numeric>=360,'successive segments add without reset');
end $$;
reset role;
-- Pure calculation tested with explicit fixture times, without modifying rows.
do $$ declare a public.incident_equipment_assignments; c public.equipment_cycles; t timestamptz:=clock_timestamp(); x jsonb; y jsonb;
begin
  select * into a from public.incident_equipment_assignments where id=pg_temp.id('assignment');
  select * into c from public.equipment_cycles where assignment_id=a.id and ended_at is null;
  c.accumulated_active_seconds:=5400;
  x:=public.equipment_clock_snapshot(a,c,t); y:=public.equipment_clock_snapshot(a,c,t+interval '10 seconds');
  perform pg_temp.check_true(x->>'calculated_time_state'='warning' and x->'remaining_seconds'=y->'remaining_seconds','warning boundary and paused passage of time');
  c.operation_state:='running'; c.running_since:=t; c.first_started_at:=t;
  x:=public.equipment_clock_snapshot(a,c,t+interval '1800 seconds');
  y:=public.equipment_clock_snapshot(a,c,t+interval '1810 seconds');
  perform pg_temp.check_true(x->>'calculated_time_state'='overdue' and (x->>'remaining_seconds')::numeric=0
    and (y->>'remaining_seconds')::numeric=-10,'running decreases through zero into negative');
  c.accumulated_active_seconds:=5399;
  perform pg_temp.check_true(public.equipment_clock_snapshot(a,c,t)->>'calculated_time_state'='normal','above warning boundary is normal');
end $$;
set local role authenticated;
-- Refuel from paused, replay and invalid new-cycle operations.
do $$ declare request uuid:=gen_random_uuid(); version bigint; result jsonb; old_cycle uuid;
begin
  select a.version,c.id into version,old_cycle from public.incident_equipment_assignments a
    join public.equipment_cycles c on c.assignment_id=a.id and c.ended_at is null where a.id=pg_temp.id('assignment');
  result:=pg_temp.act('confirm_equipment_refuel',request,version);
  perform pg_temp.check_true(result->>'operation_state'='paused' and (result->>'remaining_seconds')::numeric=7200
    and (result->>'accumulated_active_seconds')::numeric=0 and result->>'running_since' is null
    and result->>'first_started_at' is null and (result->>'cycle_number')::int=2,'refuel creates full unstarted paused cycle');
  perform pg_temp.check_true(pg_temp.act('confirm_equipment_refuel',request,version)=result,'identical refuel replay returns original result');
  perform pg_temp.check_true((select count(*)=2 from public.equipment_cycles where assignment_id=pg_temp.id('assignment')),'replay creates no extra cycle');
  perform pg_temp.check_true((select end_reason='refueled' and refueled_by=auth.uid() and refueled_at=ended_at
    from public.equipment_cycles where id=old_cycle),'ended cycle retains authenticated refuel provenance');
  perform pg_temp.expect_error(format('select pg_temp.act(''confirm_equipment_refuel'',%L,%s)',request,version+1),'22023','same request different payload rejected');
  perform pg_temp.expect_error(format('select pg_temp.act(''confirm_equipment_refuel'',gen_random_uuid(),%s)',version),'40001','competing stale refuel rejected');
end $$;
select pg_temp.expect_error('select pg_temp.act(''confirm_equipment_refuel'')','55000','unstarted refueled cycle rejects another refuel');
select pg_temp.expect_error('select pg_temp.act(''start_equipment'')','55000','new cycle requires resume');
select pg_temp.check_true(pg_temp.act('resume_equipment')->>'first_started_at' is not null,'resume starts new cycle explicitly');
reset role;
select pg_temp.backdate_segment(7300);
set local role authenticated;
select pg_temp.check_true((public.get_incident_equipment_state(pg_temp.id('incident'))#>>'{equipment,0,remaining_seconds}')::numeric<0,'read RPC returns negative running time');
do $$ declare c public.equipment_cycles; result jsonb;
begin
  select * into c from public.equipment_cycles where assignment_id=pg_temp.id('assignment') and ended_at is null;
  result:=pg_temp.act('confirm_equipment_refuel');
  perform pg_temp.check_true((select accumulated_active_seconds=c.accumulated_active_seconds+
    extract(epoch from ((result->>'server_now')::timestamptz-c.running_since)) and operation_state='paused'
    and running_since is null and end_reason='refueled' from public.equipment_cycles where id=c.id),'running refuel preserves final segment history');
end $$;

-- Role matrix: call the actual public entry points as authenticated, not owner.
do $$ declare actor text; action text;
begin
  foreach actor in array array['viewer','search_user','inactive','deleted','outsider','readonly_editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    foreach action in array array['start_equipment','pause_equipment','resume_equipment','confirm_equipment_refuel'] loop
      perform pg_temp.expect_error(format('select public.%I(%L,%L,1,%L)',action,pg_temp.id('incident'),pg_temp.id('assignment'),gen_random_uuid()),'42501',actor || ' cannot ' || action);
    end loop;
  end loop;
  foreach actor in array array['viewer','editor','readonly_editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    perform pg_temp.check_true(jsonb_array_length(public.get_incident_equipment_state(pg_temp.id('incident'))->'equipment')=1,actor || ' permitted read');
    perform pg_temp.expect_error(format('select public.get_incident_equipment_state(%L)',pg_temp.id('other')),'42501',actor || ' cannot read other incident');
  end loop;
  foreach actor in array array['search_user','inactive','deleted','outsider'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    perform pg_temp.expect_error(format('select public.get_incident_equipment_state(%L)',pg_temp.id('incident')),'42501',actor || ' read denied');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error(format('select public.get_incident_equipment_state(%L)',pg_temp.id('incident')),'42501','anonymous identity denied');
  perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
end $$;
reset role;

-- Fresh assignments per role/lifecycle permit testing all four valid operations.
do $$ declare actor text; lifecycle text; item uuid; assignment uuid; result jsonb;
begin
  foreach lifecycle in array array['active','paused'] loop
    foreach actor in array array['admin','commander','editor'] loop
      update public.incidents set lifecycle_status='active' where id=pg_temp.id('incident');
      perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
      item:=public.create_equipment_item(pg_temp.id('type'),'clock-' || gen_random_uuid()::text);
      result:=public.assign_equipment(pg_temp.id('incident'),item,gen_random_uuid(),pg_temp.id('team'));
      assignment:=(result->>'assignment_id')::uuid;
      update public.incidents set lifecycle_status=lifecycle where id=pg_temp.id('incident');
      perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
      set local role authenticated;
      result:=public.start_equipment(pg_temp.id('incident'),assignment,1,gen_random_uuid());
      result:=public.pause_equipment(pg_temp.id('incident'),assignment,2,gen_random_uuid());
      result:=public.resume_equipment(pg_temp.id('incident'),assignment,3,gen_random_uuid());
      result:=public.confirm_equipment_refuel(pg_temp.id('incident'),assignment,4,gen_random_uuid());
      perform pg_temp.check_true(result->>'operation_state'='paused' and (result->>'version')::bigint=5,actor || ' all operations in ' || lifecycle);
      reset role;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
end $$;

-- Denial must precede state/version handling even for an administrator.
do $$ declare lifecycle text; action text;
begin
  foreach lifecycle in array array['closed','archived'] loop
    update public.incidents set lifecycle_status=case when lifecycle='closed' then 'closed' else 'active' end,
      is_closed=lifecycle='closed',ended_at=case when lifecycle='closed' then clock_timestamp() else null end,
      archived_at=case when lifecycle='archived' then clock_timestamp() else null end where id=pg_temp.id('incident');
    set local role authenticated;
    foreach action in array array['start_equipment','pause_equipment','resume_equipment','confirm_equipment_refuel'] loop
      perform pg_temp.expect_error(format('select public.%I(%L,%L,1,%L)',action,pg_temp.id('incident'),pg_temp.id('assignment'),gen_random_uuid()),
        case when lifecycle='archived' then '42501' else '55000' end,lifecycle || ' blocks ' || action);
    end loop;
    reset role;
  end loop;
  update public.incidents set lifecycle_status='active',is_closed=false,ended_at=null,archived_at=null where id=pg_temp.id('incident');
end $$;

-- Inject log failure only for this fixture; verify ALL writes roll back.
create function pg_temp.fail_clock_log() returns trigger language plpgsql as $$
begin
  if new.incident_id=pg_temp.id('incident') and new.log_type in ('equipment_started','equipment_paused','equipment_resumed','equipment_refueled')
    and current_setting('equipment.test.fail_log',true)='on' then
    raise exception 'Injected clock log failure' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger test_fail_clock_log before insert on public.event_logs for each row execute function pg_temp.fail_clock_log();
do $$ declare action text; item uuid; assignment uuid; result jsonb; a_before jsonb; c_before jsonb; request uuid;
begin
  foreach action in array array['start_equipment','pause_equipment','resume_equipment','confirm_equipment_refuel'] loop
    item:=public.create_equipment_item(pg_temp.id('type'),'clock-failure-' || gen_random_uuid()::text);
    result:=public.assign_equipment(pg_temp.id('incident'),item,gen_random_uuid(),pg_temp.id('team'));
    assignment:=(result->>'assignment_id')::uuid;
    if action<>'start_equipment' then result:=public.start_equipment(pg_temp.id('incident'),assignment,1,gen_random_uuid()); end if;
    if action='resume_equipment' then result:=public.pause_equipment(pg_temp.id('incident'),assignment,2,gen_random_uuid()); end if;
    select to_jsonb(a) into a_before from public.incident_equipment_assignments a where id=assignment;
    select jsonb_agg(to_jsonb(c) order by cycle_number) into c_before from public.equipment_cycles c where assignment_id=assignment;
    request:=gen_random_uuid();
    perform set_config('equipment.test.fail_log','on',true);
    set local role authenticated;
    perform pg_temp.expect_error(format('select public.%I(%L,%L,%s,%L)',action,pg_temp.id('incident'),assignment,a_before->>'version',request),'P0001',action || ' log failure raised');
    reset role;
    perform set_config('equipment.test.fail_log','off',true);
    perform pg_temp.check_true((select to_jsonb(a)=a_before from public.incident_equipment_assignments a where id=assignment)
      and (select jsonb_agg(to_jsonb(c) order by cycle_number)=c_before from public.equipment_cycles c where assignment_id=assignment)
      and not exists(select 1 from public.equipment_operation_requests where request_id=request),action || ' clock/version/request/new-cycle rollback');
  end loop;
end $$;

select pg_temp.check_true(not exists(select 1 from public.event_logs where incident_id=pg_temp.id('incident')
  and log_type in ('equipment_started','equipment_paused','equipment_resumed','equipment_refueled') and (
    not (before_state ?& array['cycle_id','cycle_number','operation_state','accumulated_active_seconds','running_since','elapsed_seconds','remaining_seconds','server_now'])
    or not (after_state ?& array['cycle_id','cycle_number','operation_state','accumulated_active_seconds','running_since','elapsed_seconds','remaining_seconds','server_now'])
    or (after_state->>'server_now')::timestamptz is distinct from reported_at
    or reported_at is distinct from created_at or before_state->>'server_now' is distinct from after_state->>'server_now'
    or created_by is null)), 'clock logs include before/after and one server timestamp');
select pg_temp.check_true(not exists(select 1 from public.event_logs where incident_id=pg_temp.id('incident') and log_type='equipment_refueled'
  and (not (metadata ?& array['ended_cycle','new_cycle','confirmed_by','refueled_at'])
    or (metadata->>'confirmed_by')::uuid is distinct from created_by)), 'refuel log preserves both cycles and actor');

-- Repeated state reads never persist elapsed time or generate log/request rows.
do $$ declare before_rows jsonb; after_rows jsonb; logs bigint; requests bigint; reading jsonb;
begin
  select jsonb_agg(to_jsonb(c) order by id) into before_rows from public.equipment_cycles c where incident_id=pg_temp.id('incident');
  select count(*) into logs from public.event_logs where incident_id=pg_temp.id('incident');
  select count(*) into requests from public.equipment_operation_requests where incident_id=pg_temp.id('incident');
  set local role authenticated;
  for counter in 1..10 loop reading:=public.get_incident_equipment_state(pg_temp.id('incident')); end loop;
  reset role;
  select jsonb_agg(to_jsonb(c) order by id) into after_rows from public.equipment_cycles c where incident_id=pg_temp.id('incident');
  perform pg_temp.check_true(before_rows=after_rows and logs=(select count(*) from public.event_logs where incident_id=pg_temp.id('incident'))
    and requests=(select count(*) from public.equipment_operation_requests where incident_id=pg_temp.id('incident')),'state reads do not write');
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(reading->'equipment') e
    where (e->>'incident_id')::uuid<>pg_temp.id('incident') or e->>'server_now'<>reading->>'server_now'),'read scoped to incident and common timestamp');
end $$;
set local role authenticated;
select pg_temp.expect_error('update public.equipment_cycles set accumulated_active_seconds=0','42501','direct clock writes denied');
select pg_temp.expect_error('select public.equipment_clock_command(''start'',null,null,1,gen_random_uuid())','42501','private command inaccessible');
reset role;
select pg_temp.check_true(not has_function_privilege('anon','public.get_incident_equipment_state(uuid)','execute')
  and not has_function_privilege('service_role','public.start_equipment(uuid,uuid,bigint,uuid)','execute'),'public RPC grants restricted');
-- Released assignments are absent from reads and reject every clock operation.
do $$ declare item uuid; assignment uuid; result jsonb; action text;
begin
  item:=public.create_equipment_item(pg_temp.id('type'),'clock-release-' || gen_random_uuid()::text);
  result:=public.assign_equipment(pg_temp.id('incident'),item,gen_random_uuid(),pg_temp.id('team'));
  assignment:=(result->>'assignment_id')::uuid;
  result:=public.release_equipment(pg_temp.id('incident'),assignment,1,gen_random_uuid(),'Test release');
  set local role authenticated;
  foreach action in array array['start_equipment','pause_equipment','resume_equipment','confirm_equipment_refuel'] loop
    perform pg_temp.expect_error(format('select public.%I(%L,%L,2,%L)',action,pg_temp.id('incident'),assignment,gen_random_uuid()),'55000','released rejects ' || action);
  end loop;
  result:=public.get_incident_equipment_state(pg_temp.id('incident'));
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(result->'equipment') e
    where (e->>'assignment_id')::uuid=assignment),'released omitted from state');
  perform pg_temp.check_true(public.get_incident_equipment_state(pg_temp.id('other'))->'equipment'='[]'::jsonb,'authorized empty incident returns empty array');
  reset role;
end $$;
rollback;
