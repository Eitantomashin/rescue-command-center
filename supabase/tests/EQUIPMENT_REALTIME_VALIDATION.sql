-- Run as postgres, with ON_ERROR_STOP=1, on a DISPOSABLE LOCAL database only.
-- SET rcc.equipment_realtime_test_database='disposable-local';
-- All fixtures, timestamp changes, grants and fault injection roll back.
begin;
do $$ begin
  if current_setting('rcc.equipment_realtime_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required';
  end if;
end $$;

create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.fails(command text,expected text,label text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute command; exception when others then get stacked diagnostics actual=returned_sqlstate; end;
  perform pg_temp.ok(actual is not distinct from expected,label || ' SQLSTATE=' || coalesce(actual,'success'));
end $$;
create temporary table alert_test_ids(key text primary key,id uuid not null default gen_random_uuid());
create temporary table alert_test_results(key text primary key,value jsonb);
insert into alert_test_ids(key) values ('admin'),('commander'),('editor'),('viewer'),('search_user'),
  ('inactive'),('deleted'),('outsider'),('readonly_editor'),('incident'),('other'),('team'),('token1'),('token2'),('token3'),('token4');
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from alert_test_ids where key=p_key $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('rcc.sql_editor_validation_mode','off',true);
insert into auth.users(id,email,raw_user_meta_data)
select id,id::text || '@equipment-alert.invalid','{}'::jsonb from alert_test_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
delete from public.profiles where id in (select id from alert_test_ids);
insert into public.profiles(id,role,is_active,deleted_at)
select id,case when key in ('inactive','deleted') then 'admin' when key in ('outsider','readonly_editor') then 'editor' else key end,
  key<>'inactive',case when key='deleted' then now() else null end from alert_test_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
insert into public.incidents(id,name,address,status_id,lifecycle_status)
select id,'Alert fixture ' || key,'Test',public.get_status_id('incident','active',null),'active'
from alert_test_ids where key in ('incident','other');
insert into public.teams(id,incident_id,team_number,name) values(pg_temp.id('team'),pg_temp.id('incident'),1,'Alert team');
insert into public.incident_memberships(incident_id,user_id,role)
select pg_temp.id('incident'),id,case when key='editor' then 'command_post_operator' else 'observer' end
from alert_test_ids where key in ('editor','viewer','search_user','readonly_editor');
insert into alert_test_ids values('type',public.create_equipment_type('Alert generator','Power',600,120));
grant select,insert,update on alert_test_ids,alert_test_results to authenticated;

create function pg_temp.fixture(p_key text) returns void language plpgsql as $$
declare v_item uuid; v_result jsonb;
begin
  v_item:=public.create_equipment_item(pg_temp.id('type'),'alert-' || gen_random_uuid()::text);
  v_result:=public.assign_equipment(pg_temp.id('incident'),v_item,gen_random_uuid(),pg_temp.id('team'),null,'Gate');
  insert into alert_test_ids values(p_key,(v_result->>'assignment_id')::uuid),(p_key || '_cycle',(v_result->>'cycle_id')::uuid);
end $$;
-- Invoker-only fixture timestamps: never exposed by a production RPC.
create function pg_temp.backdate(p_key text,p_seconds numeric) returns void language plpgsql as $$
begin
  update public.equipment_cycles set running_since=clock_timestamp()-make_interval(secs=>p_seconds::double precision),
    first_started_at=least(first_started_at,clock_timestamp()-make_interval(secs=>p_seconds::double precision)-interval '1 second')
    where assignment_id=pg_temp.id(p_key) and ended_at is null and operation_state='running';
  if not found then raise exception 'Running test fixture required'; end if;
end $$;

-- Publication is intentionally narrow; the existing operational publication is retained.
select pg_temp.ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='equipment_incident_signals'),'scoped signal publication');
select pg_temp.ok(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename in ('equipment_items','equipment_types','equipment_alert_deliveries',
    'incident_equipment_assignments','equipment_cycles','equipment_cycle_alerts')),'no broad equipment publication');
select pg_temp.ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='event_logs'),'existing publication preserved');

select pg_temp.fixture('realtime');
select pg_temp.ok((select count(*)=2 from public.equipment_incident_signals
  where assignment_id=pg_temp.id('realtime')),'assignment emits bounded assignment and initial-cycle signals');
select pg_temp.ok(not exists(select 1 from public.equipment_incident_signals where incident_id=pg_temp.id('other')),
  'allocation does not notify another event');
set local role authenticated;
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('realtime'),1,gen_random_uuid());
select public.pause_equipment(pg_temp.id('incident'),pg_temp.id('realtime'),2,gen_random_uuid());
select public.resume_equipment(pg_temp.id('incident'),pg_temp.id('realtime'),3,gen_random_uuid());
reset role;
select pg_temp.ok((select count(*)=8 from public.equipment_incident_signals
  where assignment_id=pg_temp.id('realtime')),'start pause resume each emit two bounded signals');
select pg_temp.backdate('realtime',500);
set local role authenticated;
insert into alert_test_results values('sync',public.sync_equipment_alerts(pg_temp.id('incident')));
insert into alert_test_results values('claim',public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token1')));
select pg_temp.ok((select jsonb_array_length(value->'alerts')=1 from alert_test_results where key='claim'),'warning claimed');
select pg_temp.ok((public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'))->'alerts')='[]'::jsonb,
  'second device does not steal live lease');
insert into alert_test_ids values('alert',(select (value#>>'{alerts,0,alert_id}')::uuid from alert_test_results where key='claim'));
select public.ack_equipment_alert_presented(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1'));
select public.dismiss_equipment_alert(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1'));
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident')) ?& array['server_now','alerts','presentations'],
  'sync preserves old response fields and adds presentations');
reset role;
create temporary table delivery_before_poll as select * from public.equipment_alert_deliveries
  where alert_id=pg_temp.id('alert') and user_id=pg_temp.id('admin');
select pg_temp.ok((select count(*)>=1 from public.equipment_incident_signals
  where incident_id=pg_temp.id('incident') and event_type='alert'),'alert signal emitted');
do $$ declare signals_before bigint;
begin
  select count(*) into signals_before from public.equipment_incident_signals where incident_id=pg_temp.id('incident');
  set local role authenticated;
  perform public.sync_equipment_alerts(pg_temp.id('incident'));
  perform public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'));
  reset role;
  perform pg_temp.ok(signals_before=(select count(*) from public.equipment_incident_signals where incident_id=pg_temp.id('incident')),
    'polling without a transition creates no new signals');
  perform pg_temp.ok((select to_jsonb(d)=to_jsonb(b) from public.equipment_alert_deliveries d
    join delivery_before_poll b using(alert_id,user_id)),'polling does not extend snooze or next due');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('editor')::text,true);
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'presentations'='[]'::jsonb,
  'editor cannot read administrator delivery token or schedule');
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'))->'alerts')=1,
  'second user independent delivery');
select set_config('request.jwt.claim.sub',pg_temp.id('viewer')::text,true);
select pg_temp.ok((select count(*)>0 from public.equipment_incident_signals where incident_id=pg_temp.id('incident')),
  'viewer may receive scoped invalidations');
select pg_temp.fails(format('select public.claim_equipment_alerts(%L,%L)',pg_temp.id('incident'),pg_temp.id('token3')),'42501','viewer cannot claim');
select pg_temp.fails(format('select public.sync_equipment_alerts(%L)',pg_temp.id('incident')),'42501','viewer cannot sync operational alerts');
select pg_temp.fails(format('insert into public.equipment_incident_signals(incident_id,event_type) values(%L,''catalog'')',pg_temp.id('incident')),
  '42501','client insertion denied');
select pg_temp.fails('update public.equipment_incident_signals set event_type=''catalog''','42501','client update denied');
select pg_temp.fails('delete from public.equipment_incident_signals','42501','client delete denied');
select pg_temp.fails('select public.emit_equipment_incident_signal()','42501','internal trigger function private');
select set_config('request.jwt.claim.sub',pg_temp.id('outsider')::text,true);
select pg_temp.ok((select count(*)=0 from public.equipment_incident_signals),'outsider sees no payload');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);

-- Escalation overrides warning snooze, but does not steal another active lease.
select pg_temp.backdate('realtime',700);
set local role authenticated;
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token3'))#>>'{alerts,0,severity}'='critical',
  'critical bypasses administrator warning snooze');
select pg_temp.fails(format('select public.ack_equipment_alert_presented(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1')),
  '42501','stale warning token cannot ack critical claim');
select pg_temp.fails(format('select public.dismiss_equipment_alert(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1')),
  '42501','stale token cannot dismiss critical');
reset role;

-- Catalog changes notify only open assignments and do not mutate their clocks.
create temporary table realtime_clock_before as select to_jsonb(c) as state from public.equipment_cycles c
  where assignment_id=pg_temp.id('realtime') and ended_at is null;
create temporary table realtime_assignment_before as select to_jsonb(a) as state from public.incident_equipment_assignments a where id=pg_temp.id('realtime');
create temporary table realtime_alert_before as select to_jsonb(a) as state from public.equipment_cycle_alerts a where id=pg_temp.id('alert');
do $$ declare item uuid; count_before bigint; catalog_count bigint;
begin
  select equipment_item_id into item from public.incident_equipment_assignments where id=pg_temp.id('realtime');
  select count(*) into count_before from public.equipment_incident_signals where incident_id=pg_temp.id('incident') and event_type='catalog';
  perform public.update_equipment_item(item,pg_temp.id('type'),'rt-' || item::text,'serial-live','restricted',null,false);
  select count(*) into catalog_count from public.equipment_incident_signals where incident_id=pg_temp.id('incident') and event_type='catalog';
  perform pg_temp.ok(catalog_count=count_before+1,'one scoped catalog invalidation for open item');
  perform pg_temp.ok(not exists(select 1 from public.equipment_incident_signals where incident_id=pg_temp.id('other')),'catalog does not notify unrelated event');
  perform pg_temp.ok((select to_jsonb(c)=b.state from public.equipment_cycles c cross join realtime_clock_before b
    where c.assignment_id=pg_temp.id('realtime') and c.ended_at is null),'catalog leaves full cycle unchanged');
  perform pg_temp.ok((select to_jsonb(a)=b.state from public.incident_equipment_assignments a cross join realtime_assignment_before b
    where a.id=pg_temp.id('realtime')),'catalog leaves assignment snapshots and version unchanged');
  perform pg_temp.ok((select to_jsonb(a)=b.state from public.equipment_cycle_alerts a cross join realtime_alert_before b
    where a.id=pg_temp.id('alert')),'catalog does not resolve alert');
  perform public.update_equipment_item(item,pg_temp.id('type'),'rt-' || item::text,'serial-live','serviceable',null,true);
end $$;
set local role authenticated;
select public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('realtime'),4,gen_random_uuid());
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts'='[]'::jsonb,'refuel removes alert; new paused cycle silent');
select public.release_equipment(pg_temp.id('incident'),pg_temp.id('realtime'),5,gen_random_uuid(),'Returned');
reset role;
do $$ declare item uuid; count_before bigint;
begin
  select equipment_item_id into item from public.incident_equipment_assignments where id=pg_temp.id('realtime');
  select count(*) into count_before from public.equipment_incident_signals;
  perform public.update_equipment_item(item,pg_temp.id('type'),'rt-' || item::text,'serial-live','unserviceable',null,false);
  perform pg_temp.ok(count_before=(select count(*) from public.equipment_incident_signals),'released item sends no incident catalog signal');
end $$;
select pg_temp.fixture('close_off');
select pg_temp.fixture('close_paused');
set local role authenticated;
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('close_paused'),1,gen_random_uuid());
select public.pause_equipment(pg_temp.id('incident'),pg_temp.id('close_paused'),2,gen_random_uuid());
select public.close_incident_lifecycle(pg_temp.id('incident'));
reset role;
select pg_temp.ok(not exists(select 1 from public.incident_equipment_assignments
  where incident_id=pg_temp.id('incident') and released_at is null),'closure atomically releases allocations');
select pg_temp.ok(exists(select 1 from public.equipment_incident_signals where incident_id=pg_temp.id('incident') and event_type='lifecycle'),
  'closure emits lifecycle signal');
select pg_temp.ok((select count(*)>=2 from public.equipment_incident_signals where assignment_id=pg_temp.id('close_off') and event_type='assignment'),
  'automatic release emits assignment signal');
select public.archive_incident(pg_temp.id('incident'),(select name from public.incidents where id=pg_temp.id('incident')));
select public.permanently_delete_archived_incident(pg_temp.id('incident'),(select name from public.incidents where id=pg_temp.id('incident')));
select pg_temp.ok(not exists(select 1 from public.equipment_incident_signals where incident_id=pg_temp.id('incident')),
  'purge cascades all signal rows despite disabled incident user triggers');
select pg_temp.ok(exists(select 1 from public.equipment_types where id=pg_temp.id('type')),'purge preserves catalog');
select pg_temp.ok((select bool_and(prosecdef and 'search_path=pg_catalog, public'=any(proconfig)) from pg_proc
  where oid in ('public.emit_equipment_incident_signal()'::regprocedure,'public.equipment_active_alert_state(uuid,timestamptz)'::regprocedure,
    'public.sync_equipment_alerts(uuid)'::regprocedure)),'fixed security definer paths');
select pg_temp.ok(not has_function_privilege('authenticated','public.emit_equipment_incident_signal()','execute')
  and not has_function_privilege('anon','public.sync_equipment_alerts(uuid)','execute'),'execute privileges');
set constraints all immediate;
rollback;
