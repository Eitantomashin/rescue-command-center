-- Stage 3 integration tests. ONLY a disposable LOCAL Supabase database.
-- Run as postgres after migrations, with psql ON_ERROR_STOP=1.
-- Explicit opt-in: SET rcc.equipment_assignment_test_database='disposable-local';
-- No existing data is changed. All fixtures and fault injection roll back.
begin;
do $$ begin
  if current_setting('rcc.equipment_assignment_test_database',true) is distinct from 'disposable-local' then
    raise exception 'Disposable local database opt-in required';
  end if;
end $$;
create function pg_temp.check_true(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if;
  raise notice 'PASS: %',p_label;
end $$;
create function pg_temp.expect_error(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_sql; exception when others then get stacked diagnostics v_state=returned_sqlstate; end;
  if v_state is distinct from p_state then raise exception 'FAIL: %, expected %, got %',p_label,p_state,coalesce(v_state,'success'); end if;
  raise notice 'PASS: %',p_label;
end $$;
create temporary table equipment_assignment_test_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into equipment_assignment_test_ids(key) values ('admin'),('commander'),('editor'),('viewer'),('search_user'),
  ('inactive'),('deleted'),('outsider'),('readonly_editor'),('incident'),('other'),('paused'),('closed'),('archived'),
  ('team'),('team2'),('other_team'),('adhoc'),('other_adhoc'),('assign_request');
create function pg_temp.test_id(p_key text) returns uuid language sql as $$
  select id from equipment_assignment_test_ids where key=p_key
$$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('rcc.sql_editor_validation_mode','off',true);
insert into auth.users(id,email,raw_user_meta_data)
  select id,id::text || '@equipment-assignment.invalid','{}'::jsonb from equipment_assignment_test_ids
  where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
delete from public.profiles where id in (select id from equipment_assignment_test_ids);
insert into public.profiles(id,role,is_active,deleted_at)
  select id,case when key in ('inactive','deleted') then 'admin' when key in ('outsider','readonly_editor') then 'editor' else key end,
    key <> 'inactive',case when key='deleted' then now() else null end
  from equipment_assignment_test_ids where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
select set_config('request.jwt.claim.sub',pg_temp.test_id('admin')::text,true);
insert into public.incidents(id,name,address,status_id,lifecycle_status,is_closed,ended_at,archived_at)
  select id,'Equipment fixture ' || key,'Test',public.get_status_id('incident','active',null),
    case when key in ('paused','closed') then key else 'active' end,
    key='closed',case when key='closed' then now() else null end,case when key='archived' then now() else null end
  from equipment_assignment_test_ids where key in ('incident','other','paused','closed','archived');
insert into public.teams(id,incident_id,team_number,name) values
  (pg_temp.test_id('team'),pg_temp.test_id('incident'),1,'Team 1'),
  (pg_temp.test_id('team2'),pg_temp.test_id('incident'),2,'Team 2'),
  (pg_temp.test_id('other_team'),pg_temp.test_id('other'),1,'Other team');
insert into public.incident_ad_hoc_teams(id,incident_id,name) values
  (pg_temp.test_id('adhoc'),pg_temp.test_id('incident'),'Equipment ad-hoc'),
  (pg_temp.test_id('other_adhoc'),pg_temp.test_id('other'),'Other ad-hoc');
insert into public.incident_memberships(incident_id,user_id,role)
  select pg_temp.test_id('incident'),id,case when key='editor' then 'command_post_operator' else 'observer' end
  from equipment_assignment_test_ids where key in ('editor','viewer','search_user','readonly_editor');
insert into equipment_assignment_test_ids(key,id) values ('type',public.create_equipment_type('Generator','Power',7200,1800,'Original instructions'));
insert into equipment_assignment_test_ids(key,id) values
  ('item',public.create_equipment_item(pg_temp.test_id('type'),'fixture-1')),
  ('item2',public.create_equipment_item(pg_temp.test_id('type'),'fixture-2')),
  ('free',public.create_equipment_item(pg_temp.test_id('type'),'fixture-3'));
grant select,insert on equipment_assignment_test_ids to authenticated;
set local role authenticated;

insert into equipment_assignment_test_ids(key,id)
select 'assignment',(public.assign_equipment(pg_temp.test_id('incident'),pg_temp.test_id('item'),pg_temp.test_id('assign_request'),
  pg_temp.test_id('team'),null,'Gate','Initial notes')->>'assignment_id')::uuid;
insert into equipment_assignment_test_ids(key,id)
select 'adhoc_assignment',(public.assign_equipment(pg_temp.test_id('incident'),pg_temp.test_id('item2'),gen_random_uuid(),
  null,pg_temp.test_id('adhoc'))->>'assignment_id')::uuid;
select pg_temp.check_true((select count(*)=2 from public.incident_equipment_assignments where incident_id=pg_temp.test_id('incident')),'regular and ad-hoc assignment');
select pg_temp.check_true((select operation_state='off' and cycle_number=1 and accumulated_active_seconds=0
  and running_since is null and first_started_at is null and ended_at is null
  from public.equipment_cycles where assignment_id=pg_temp.test_id('assignment')),'initial full off cycle');
select pg_temp.check_true((select full_runtime_seconds_snapshot=7200 and warning_before_seconds_snapshot=1800
  and allocated_by=auth.uid() from public.incident_equipment_assignments where id=pg_temp.test_id('assignment')),'full runtime snapshot and authenticated actor');

do $$ declare v_sql text; v_key text;
begin
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team'),pg_temp.test_id('adhoc')),'22023','two team sources rejected');
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid()),'22023','missing team rejected');
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('other_team')),'22023','cross incident regular team rejected');
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,null,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('other_adhoc')),'22023','cross incident ad-hoc team rejected');
  foreach v_key in array array['closed','paused','archived'] loop
    v_sql:=format('select public.assign_equipment(%L,%L,%L,%L)',pg_temp.test_id(v_key),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team'));
    perform pg_temp.expect_error(v_sql,case when v_key='archived' then '42501' else '55000' end,v_key || ' event rejected');
  end loop;
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('other'),pg_temp.test_id('item'),gen_random_uuid(),pg_temp.test_id('other_team')),'55000','duplicate item in another incident rejected');
end $$;

do $$ declare v_state text;
begin
  foreach v_state in array array['restricted','unserviceable'] loop
    perform public.update_equipment_item(pg_temp.test_id('free'),pg_temp.test_id('type'),'fixture-3',null,v_state,null,true);
    perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
      pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'55000',v_state || ' rejected');
  end loop;
  perform public.update_equipment_item(pg_temp.test_id('free'),pg_temp.test_id('type'),'fixture-3',null,'serviceable',null,false);
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'55000','inactive item rejected');
  perform public.update_equipment_item(pg_temp.test_id('free'),pg_temp.test_id('type'),'fixture-3',null,'serviceable',null,true);
  perform public.update_equipment_type(pg_temp.test_id('type'),'Changed','Power changed',10800,900,'Changed instructions',false);
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'55000','inactive type rejected');
  perform public.update_equipment_type(pg_temp.test_id('type'),'Changed','Power changed',10800,900,'Changed instructions',true);
  perform public.update_equipment_item(pg_temp.test_id('item'),pg_temp.test_id('type'),'fixture-1-renamed',null,'serviceable',null,true);
end $$;
select pg_temp.check_true((select equipment_type_name_snapshot='Generator' and category_snapshot='Power'
  and instructions_snapshot='Original instructions' and asset_identifier_snapshot='fixture-1'
  and full_runtime_seconds_snapshot=7200 and warning_before_seconds_snapshot=1800
  from public.incident_equipment_assignments where id=pg_temp.test_id('assignment')),'catalog updates do not mutate snapshot');

select pg_temp.check_true((public.assign_equipment(pg_temp.test_id('incident'),pg_temp.test_id('item'),pg_temp.test_id('assign_request'),
  pg_temp.test_id('team'),null,'Gate','Initial notes')->>'assignment_id')::uuid=pg_temp.test_id('assignment'),'same request returns original result');
select pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L,null,''different'')',
  pg_temp.test_id('incident'),pg_temp.test_id('item'),pg_temp.test_id('assign_request'),pg_temp.test_id('team')),'22023','same request different payload rejected');

do $$ declare v_before jsonb; v_after jsonb; v_request uuid:=gen_random_uuid(); v_result jsonb;
begin
  select to_jsonb(c) into v_before from public.equipment_cycles c where assignment_id=pg_temp.test_id('assignment');
  v_result:=public.transfer_equipment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),1,v_request,null,pg_temp.test_id('adhoc'));
  perform pg_temp.check_true(public.transfer_equipment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),1,v_request,null,pg_temp.test_id('adhoc'))=v_result,'transfer replay ignores already consumed version');
  perform public.transfer_equipment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),2,gen_random_uuid(),pg_temp.test_id('team2'));
  select to_jsonb(c) into v_after from public.equipment_cycles c where assignment_id=pg_temp.test_id('assignment');
  perform pg_temp.check_true(v_before=v_after,'transfer changes neither cycle nor clock fields');
  perform pg_temp.expect_error(format('select public.update_equipment_assignment(%L,%L,1,%L,''Stale'')',
    pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'40001','stale expected version rejected');
  perform public.update_equipment_assignment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),3,gen_random_uuid(),'Roof','Updated');
end $$;
select pg_temp.check_true((select before_state->>'location'='Gate' and after_state->>'location'='Roof'
  and entity_type='equipment_assignment' and created_by=auth.uid() and metadata ? 'request_id'
  from public.event_logs where entity_id=pg_temp.test_id('assignment') and log_type='equipment_assignment_updated'),'event log before/after and authenticated identity');
select pg_temp.expect_error(format('select public.archive_incident_ad_hoc_team(%L,%L)',
  pg_temp.test_id('incident'),pg_temp.test_id('adhoc')),'55000','archive RPC blocks assigned ad-hoc team');
select pg_temp.expect_error(format('update public.incident_ad_hoc_teams set status=''archived'' where id=%L',
  pg_temp.test_id('adhoc')),'55000','archive direct write also blocked');

-- Successful commander and assigned editor actions, without any admin role.
select set_config('request.jwt.claim.sub',pg_temp.test_id('commander')::text,true);
select public.update_equipment_assignment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),4,gen_random_uuid(),'Commander','Updated');
select set_config('request.jwt.claim.sub',pg_temp.test_id('editor')::text,true);
select public.update_equipment_assignment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),5,gen_random_uuid(),'Editor','Updated');
do $$ declare v_key text;
begin
  foreach v_key in array array['viewer','search_user','inactive','deleted','outsider','readonly_editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.test_id(v_key)::text,true);
    perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'42501',v_key || ' assign denied');
    perform pg_temp.expect_error(format('select public.update_equipment_assignment(%L,%L,6,%L)',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'42501',v_key || ' update denied');
    perform pg_temp.expect_error(format('select public.transfer_equipment(%L,%L,6,%L,%L)',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid(),pg_temp.test_id('team')),'42501',v_key || ' transfer denied');
    perform pg_temp.expect_error(format('select public.release_equipment(%L,%L,6,%L,''Return'')',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'42501',v_key || ' release denied');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('rcc.sql_editor_validation_mode','on',true);
  perform set_config('rcc.test_user_id',pg_temp.test_id('admin')::text,true);
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'42501','test actor cannot replace authentication');
  perform set_config('rcc.sql_editor_validation_mode','off',true);
end $$;
select set_config('request.jwt.claim.sub',pg_temp.test_id('viewer')::text,true);
select pg_temp.check_true((select count(*)=2 from public.incident_equipment_assignments),'assigned viewer can read');
select set_config('request.jwt.claim.sub',pg_temp.test_id('outsider')::text,true);
select pg_temp.check_true(not exists(select from public.incident_equipment_assignments),'outsider cannot read');
select set_config('request.jwt.claim.sub',pg_temp.test_id('admin')::text,true);
select pg_temp.expect_error('update public.equipment_cycles set operation_state=''running''','42501','direct cycle state write blocked');
select pg_temp.expect_error('update public.incident_equipment_assignments set location=''Bypass''','42501','direct assignment write blocked');
select pg_temp.expect_error('delete from public.equipment_operation_requests','42501','request removal blocked');
reset role;

-- Prove RLS independently of ACL revocations. These grants roll back with tests.
grant update on public.incident_equipment_assignments,public.equipment_cycles,public.equipment_operation_requests to authenticated;
set local role authenticated;
with attempted as (update public.incident_equipment_assignments set location='Bypass' returning id)
select pg_temp.check_true((select count(*)=0 from attempted),'RLS blocks assignment update even with restored grant');
with attempted as (update public.equipment_cycles set accumulated_active_seconds=1 returning id)
select pg_temp.check_true((select count(*)=0 from attempted),'RLS blocks cycle update even with restored grant');
with attempted as (update public.equipment_operation_requests set result='{}'::jsonb returning request_id)
select pg_temp.check_true((select count(*)=0 from attempted),'RLS blocks request update even with restored grant');
reset role;
revoke update on public.incident_equipment_assignments,public.equipment_cycles,public.equipment_operation_requests from authenticated;

-- Owner-only fixture state simulates a future running cycle; no start RPC added.
update public.equipment_cycles set operation_state='running',running_since=clock_timestamp(),first_started_at=opened_at
  where assignment_id=pg_temp.test_id('assignment');
set local role authenticated;
select pg_temp.expect_error(format('select public.release_equipment(%L,%L,6,%L,''Return'')',
  pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'55000','running release blocked by RPC');
reset role;
select pg_temp.expect_error(format('update public.incident_equipment_assignments set released_at=clock_timestamp(),released_by=%L,release_reason=''Bypass'',version=version+1 where id=%L',
  pg_temp.test_id('admin'),pg_temp.test_id('assignment')),'23514','running release also blocked by table guard');
select pg_temp.expect_error(format('update public.incident_equipment_assignments set full_runtime_seconds_snapshot=9999,version=version+1 where id=%L',
  pg_temp.test_id('assignment')),'23514','snapshot protected from privileged updates');
update public.equipment_cycles set operation_state='off',running_since=null,first_started_at=null where assignment_id=pg_temp.test_id('assignment');

-- Inject event_logs failure; require assignment/cycle/request rollback together.
create function pg_temp.fail_equipment_event_log() returns trigger language plpgsql as $$
begin
  if new.log_type like 'equipment_%' then raise exception 'Injected equipment log failure' using errcode='P0001'; end if;
  return new;
end $$;
create trigger equipment_test_log_failure before insert on public.event_logs for each row execute function pg_temp.fail_equipment_event_log();
set local role authenticated;
do $$ declare v_request uuid:=gen_random_uuid(); v_before jsonb; v_cycle jsonb;
begin
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),v_request,pg_temp.test_id('team')),'P0001','log failure rejects assignment');
  perform pg_temp.check_true(not exists(select from public.incident_equipment_assignments where equipment_item_id=pg_temp.test_id('free')),'assignment rollback');
  perform pg_temp.check_true(not exists(select from public.equipment_operation_requests where request_id=v_request),'idempotency reservation rollback');
  select to_jsonb(a) into v_before from public.incident_equipment_assignments a where id=pg_temp.test_id('assignment');
  select to_jsonb(c) into v_cycle from public.equipment_cycles c where assignment_id=pg_temp.test_id('assignment');
  perform pg_temp.expect_error(format('select public.update_equipment_assignment(%L,%L,6,%L,''Failed'')',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'P0001','log failure rejects update');
  perform pg_temp.expect_error(format('select public.transfer_equipment(%L,%L,6,%L,%L)',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid(),pg_temp.test_id('team')),'P0001','log failure rejects transfer');
  perform pg_temp.expect_error(format('select public.release_equipment(%L,%L,6,%L,''Return'')',pg_temp.test_id('incident'),pg_temp.test_id('assignment'),gen_random_uuid()),'P0001','log failure rejects release');
  perform pg_temp.check_true(v_before=(select to_jsonb(a) from public.incident_equipment_assignments a where id=pg_temp.test_id('assignment')),'all failed updates rolled back');
  perform pg_temp.check_true(v_cycle=(select to_jsonb(c) from public.equipment_cycles c where assignment_id=pg_temp.test_id('assignment')),'failed release preserves open cycle');
end $$;
reset role;
drop trigger equipment_test_log_failure on public.event_logs;
set local role authenticated;
do $$ declare v_request uuid:=gen_random_uuid(); v_result jsonb; v_new jsonb;
begin
  v_result:=public.release_equipment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),6,v_request,'Returned to unit storage');
  perform pg_temp.check_true(public.release_equipment(pg_temp.test_id('incident'),pg_temp.test_id('assignment'),6,v_request,'Returned to unit storage')=v_result,'release retry returns original result');
  perform pg_temp.check_true((select ended_at is not null from public.equipment_cycles where assignment_id=pg_temp.test_id('assignment')),'off release closes cycle');
  v_new:=public.assign_equipment(pg_temp.test_id('other'),pg_temp.test_id('item'),gen_random_uuid(),pg_temp.test_id('other_team'));
  perform pg_temp.check_true((v_new->>'assignment_id')::uuid<>pg_temp.test_id('assignment'),'released item gets new assignment');
  perform pg_temp.check_true((select cycle_number=1 and operation_state='off' and accumulated_active_seconds=0 and running_since is null
    from public.equipment_cycles where id=(v_new->>'cycle_id')::uuid),'new assignment starts fresh and full');
  perform pg_temp.check_true((select full_runtime_seconds_snapshot=10800 from public.incident_equipment_assignments
    where id=(v_new->>'assignment_id')::uuid),'new assignment uses latest catalog duration');
  perform pg_temp.check_true((select full_runtime_seconds_snapshot=7200 from public.incident_equipment_assignments
    where id=pg_temp.test_id('assignment')),'released history retains old snapshot');
end $$;
select public.release_equipment(pg_temp.test_id('incident'),pg_temp.test_id('adhoc_assignment'),1,gen_random_uuid(),'Returned');
select public.archive_incident_ad_hoc_team(pg_temp.test_id('incident'),pg_temp.test_id('adhoc'));
select pg_temp.check_true((select status='archived' from public.incident_ad_hoc_teams where id=pg_temp.test_id('adhoc')),'archive allowed after release');
select pg_temp.check_true((select count(*)=1 from public.event_logs where entity_id=pg_temp.test_id('assignment') and log_type='equipment_released'),'release retry creates one log');
select pg_temp.check_true(not exists(select from public.equipment_operation_requests where result is null),'no incomplete committed requests');
reset role;
do $$ declare v_table text; v_role text; v_op text;
begin
  foreach v_table in array array['incident_equipment_assignments','equipment_cycles','equipment_operation_requests'] loop
    perform pg_temp.check_true((select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass),v_table || ' RLS');
    foreach v_role in array array['authenticated','anon','service_role'] loop
      foreach v_op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
        perform pg_temp.check_true(not has_table_privilege(v_role,'public.'||v_table,v_op),v_table || ' ' || v_role || ' no ' || v_op);
      end loop;
    end loop;
  end loop;
  perform pg_temp.check_true(not has_function_privilege('authenticated',
    'public.equipment_assignment_command(text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,bigint)','EXECUTE'),'internal command is private');
end $$;

-- Lifecycle regression: allocate while active, then operate the SAME assignment
-- while paused. Closed/archived must reject all four commands before mutation.
do $$
declare v_result jsonb; v_assignment uuid; v_cycle uuid; v_state text; v_sqlstate text;
  v_cycle_before jsonb; v_request uuid:=gen_random_uuid();
begin
  v_result:=public.assign_equipment(pg_temp.test_id('incident'),pg_temp.test_id('free'),v_request,pg_temp.test_id('team'));
  v_assignment:=(v_result->>'assignment_id')::uuid;
  v_cycle:=(v_result->>'cycle_id')::uuid;
  select to_jsonb(c) into v_cycle_before from public.equipment_cycles c where id=v_cycle;
  foreach v_state in array array['closed','archived'] loop
    update public.incidents set lifecycle_status=case when v_state='closed' then 'closed' else 'active' end,
      is_closed=(v_state='closed'),ended_at=case when v_state='closed' then now() else null end,
      archived_at=case when v_state='archived' then now() else null end
      where id=pg_temp.test_id('incident');
    v_sqlstate:=case when v_state='archived' then '42501' else '55000' end;
    perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
      pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),v_sqlstate,v_state || ' denies assign');
    perform pg_temp.expect_error(format('select public.update_equipment_assignment(%L,%L,1,%L,''Blocked'')',
      pg_temp.test_id('incident'),v_assignment,gen_random_uuid()),v_sqlstate,v_state || ' denies update');
    perform pg_temp.expect_error(format('select public.transfer_equipment(%L,%L,1,%L,%L)',
      pg_temp.test_id('incident'),v_assignment,gen_random_uuid(),pg_temp.test_id('team2')),v_sqlstate,v_state || ' denies transfer');
    perform pg_temp.expect_error(format('select public.release_equipment(%L,%L,1,%L,''Blocked'')',
      pg_temp.test_id('incident'),v_assignment,gen_random_uuid()),v_sqlstate,v_state || ' denies release');
    perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
      pg_temp.test_id('incident'),pg_temp.test_id('free'),v_request,pg_temp.test_id('team')),v_sqlstate,v_state || ' also denies replay');
  end loop;
  update public.incidents set lifecycle_status='paused',is_closed=false,ended_at=null,archived_at=null
    where id=pg_temp.test_id('incident');
  perform pg_temp.check_true(v_cycle_before=(select to_jsonb(c) from public.equipment_cycles c where id=v_cycle),
    'event lifecycle changes do not change the equipment cycle');
  perform set_config('request.jwt.claim.sub',pg_temp.test_id('editor')::text,true);
  perform pg_temp.expect_error(format('select public.assign_equipment(%L,%L,%L,%L)',
    pg_temp.test_id('incident'),pg_temp.test_id('free'),gen_random_uuid(),pg_temp.test_id('team')),'55000','paused denies new assignment');
  perform public.update_equipment_assignment(pg_temp.test_id('incident'),v_assignment,1,gen_random_uuid(),'Paused location','Paused notes');
  perform pg_temp.check_true((select location='Paused location' and notes='Paused notes' and updated_by=auth.uid()
    from public.incident_equipment_assignments where id=v_assignment),'authorized editor updates existing equipment while paused');
  perform public.transfer_equipment(pg_temp.test_id('incident'),v_assignment,2,gen_random_uuid(),pg_temp.test_id('team2'));
  perform pg_temp.check_true((select team_id=pg_temp.test_id('team2') from public.incident_equipment_assignments where id=v_assignment),
    'authorized editor transfers while paused');
  perform pg_temp.check_true(v_cycle_before=(select to_jsonb(c) from public.equipment_cycles c where id=v_cycle),'paused update and transfer preserve cycle');
  perform public.release_equipment(pg_temp.test_id('incident'),v_assignment,3,gen_random_uuid(),'Return while event paused');
  perform pg_temp.check_true((select released_at is not null and released_by=auth.uid() from public.incident_equipment_assignments where id=v_assignment)
    and (select operation_state='off' and ended_at is not null from public.equipment_cycles where id=v_cycle),'authorized editor releases off equipment while paused');
  perform set_config('request.jwt.claim.sub',pg_temp.test_id('admin')::text,true);
end $$;
rollback;
