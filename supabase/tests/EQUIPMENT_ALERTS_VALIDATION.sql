-- Run as postgres, with ON_ERROR_STOP=1, on a DISPOSABLE LOCAL database only.
-- SET rcc.equipment_alert_test_database='disposable-local';
-- All fixtures, timestamp changes, grants and fault injection roll back.
begin;
do $$ begin
  if current_setting('rcc.equipment_alert_test_database',true) is distinct from 'disposable-local'
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
select pg_temp.fixture('normal');
set local role authenticated;
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts'='[]'::jsonb,'off cycle silent');
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('normal'),1,gen_random_uuid());
reset role;
select pg_temp.backdate('normal',100);
set local role authenticated;
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts'='[]'::jsonb,'running before threshold silent');
select public.pause_equipment(pg_temp.id('incident'),pg_temp.id('normal'),2,gen_random_uuid());
reset role;
update public.equipment_cycles set updated_at=clock_timestamp()-interval '1 day' where id=pg_temp.id('normal_cycle');
set local role authenticated;
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts'='[]'::jsonb,'paused before threshold does not count wall time');
select public.resume_equipment(pg_temp.id('incident'),pg_temp.id('normal'),3,gen_random_uuid());
reset role;
select pg_temp.backdate('normal',400);
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts')=1,'resume continues toward threshold');
select public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('normal'),4,gen_random_uuid());
select pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts'='[]'::jsonb,'refueled unstarted cycle silent');
reset role;

select pg_temp.fixture('main');
set local role authenticated;
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('main'),1,gen_random_uuid());
reset role;
select pg_temp.backdate('main',500);
insert into alert_test_results values('segment',(select to_jsonb(c) from public.equipment_cycles c where id=pg_temp.id('main_cycle')));
set local role authenticated;
-- Deliberately detect AFTER pause: crossing must be reconstructed from its log.
select public.pause_equipment(pg_temp.id('incident'),pg_temp.id('main'),2,gen_random_uuid());
insert into alert_test_results values('sync',public.sync_equipment_alerts(pg_temp.id('incident')));
insert into alert_test_ids values('alert',((select value#>>'{alerts,0,alert_id}' from alert_test_results where key='sync'))::uuid);
select pg_temp.ok((select value#>>'{alerts,0,severity}'='warning' from alert_test_results where key='sync'),'warning severity');
select pg_temp.ok((select warning_reached_at=((select value->>'running_since' from alert_test_results where key='segment'))::timestamptz+interval '480 seconds'
  and warning_reached_at<detected_at and exhausted_at is null and resolved_at is null
  from public.equipment_cycle_alerts where id=pg_temp.id('alert')),'paused crossing uses actual segment, not detection time');
insert into alert_test_results values('alert_before',(select to_jsonb(a) from public.equipment_cycle_alerts a where id=pg_temp.id('alert')));
select public.sync_equipment_alerts(pg_temp.id('incident'));
select public.sync_equipment_alerts(pg_temp.id('incident'));
select pg_temp.ok((select to_jsonb(a)=(select value from alert_test_results where key='alert_before') from public.equipment_cycle_alerts a
  where id=pg_temp.id('alert')) and (select count(*)=1 from public.equipment_cycle_alerts where cycle_id=pg_temp.id('main_cycle')),'repeated sync has no duplicate or timestamp write');
insert into alert_test_results values('claim',public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token1')));
select pg_temp.ok((select jsonb_array_length(value->'alerts')=1 and value#>>'{alerts,0,team_name}'='Alert team'
  and value#>>'{alerts,0,location}'='Gate' from alert_test_results where key='claim'),'claim returns equipment/team/location');
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'))->'alerts'='[]'::jsonb,'second tab denied live lease');
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token1'))#>>'{alerts,0,lease_until}'=
  (select value#>>'{alerts,0,lease_until}' from alert_test_results where key='claim'),'claim retry does not extend lease');
select pg_temp.fails(format('select public.ack_equipment_alert_presented(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token2')),'42501','wrong token denied');
insert into alert_test_results values('ack',public.ack_equipment_alert_presented(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1')));
select pg_temp.ok((select (value->>'next_due_at')::timestamptz-(value->>'last_presented_at')::timestamptz=interval '5 minutes'
  and value->>'lease_until' is null and value->>'last_presented_severity'='warning' from alert_test_results where key='ack'),'ack schedules five minutes and releases lease');
select pg_temp.ok(public.ack_equipment_alert_presented(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1'))=
  (select value from alert_test_results where key='ack'),'ack replay unchanged');
insert into alert_test_results values('dismiss',public.dismiss_equipment_alert(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1')));
select pg_temp.ok((select (value->>'snoozed_until')::timestamptz-(value->>'dismissed_at')::timestamptz=interval '5 minutes'
  from alert_test_results where key='dismiss'),'dismiss five minutes');
select pg_temp.ok(public.dismiss_equipment_alert(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token1'))=
  (select value from alert_test_results where key='dismiss'),'dismiss replay does not extend snooze');
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'))->'alerts'='[]'::jsonb,'warning snooze respected');
select set_config('request.jwt.claim.sub',pg_temp.id('commander')::text,true);
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),gen_random_uuid())->'alerts')=1,'commander delivery independent');
select set_config('request.jwt.claim.sub',pg_temp.id('editor')::text,true);
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),gen_random_uuid())->'alerts')=1,'authorized editor can claim');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
select pg_temp.ok((select count(*)=1 from public.event_logs where entity_id=pg_temp.id('main_cycle')),'no logs for presentations, retries or dismissals');
select public.resume_equipment(pg_temp.id('incident'),pg_temp.id('main'),3,gen_random_uuid());
reset role;
select pg_temp.backdate('main',200);
set local role authenticated;
insert into alert_test_results values('critical',public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2')));
select pg_temp.ok((select jsonb_array_length(value->'alerts')=1 and value#>>'{alerts,0,severity}'='critical'
  and (value#>>'{alerts,0,remaining_seconds}')::numeric<0 from alert_test_results where key='critical'),'critical bypasses warning snooze immediately');
insert into alert_test_results values('exhausted',(select to_jsonb(a) from public.equipment_cycle_alerts a where id=pg_temp.id('alert')));
select public.sync_equipment_alerts(pg_temp.id('incident'));
select pg_temp.ok((select to_jsonb(a)=(select value from alert_test_results where key='exhausted')
  from public.equipment_cycle_alerts a where id=pg_temp.id('alert')),'exhausted_at written once');
reset role;
update public.equipment_alert_deliveries set lease_until=clock_timestamp()-interval '1 second'
where alert_id=pg_temp.id('alert') and user_id=pg_temp.id('admin');
set local role authenticated;
select pg_temp.fails(format('select public.ack_equipment_alert_presented(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token2')),'55000','expired unacknowledged lease denied');
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token3'))->'alerts')=1,'expired lease reclaimed with fresh token');
select pg_temp.fails(format('select public.dismiss_equipment_alert(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token2')),'42501','old token fenced out');
-- Dismiss can precede ack; a reordered ack must preserve the dismissal.
insert into alert_test_results values('critical_dismiss',public.dismiss_equipment_alert(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token3')));
select pg_temp.ok(public.ack_equipment_alert_presented(pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token3'))=
  (select value from alert_test_results where key='critical_dismiss'),'dismiss before ack is safe');
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token4'))->'alerts'='[]'::jsonb,'critical repetition respects its five-minute snooze');
reset role;
update public.equipment_alert_deliveries set next_due_at=clock_timestamp()-interval '1 second',snoozed_until=clock_timestamp()-interval '1 second'
where alert_id=pg_temp.id('alert') and user_id=pg_temp.id('admin');
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token4'))->'alerts')=1,'repeat due after five minutes');

do $$ declare actor text;
begin
  foreach actor in array array['viewer','search_user','inactive','deleted','outsider','readonly_editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    perform pg_temp.fails(format('select public.claim_equipment_alerts(%L,%L)',pg_temp.id('incident'),gen_random_uuid()),'42501',actor || ' claim denied');
    perform pg_temp.fails(format('select public.sync_equipment_alerts(%L)',pg_temp.id('incident')),'42501',actor || ' sync denied');
    perform pg_temp.fails(format('select public.ack_equipment_alert_presented(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token4')),'42501',actor || ' ack denied');
    perform pg_temp.fails(format('select public.dismiss_equipment_alert(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token4')),'42501',actor || ' dismiss denied');
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.id('viewer')::text,true);
  perform pg_temp.ok(exists(select 1 from public.equipment_cycle_alerts where id=pg_temp.id('alert')),'viewer may read incident alert history');
  perform set_config('request.jwt.claim.sub',pg_temp.id('outsider')::text,true);
  perform pg_temp.ok(not exists(select 1 from public.equipment_cycle_alerts),'outsider RLS hides alerts');
  perform set_config('request.jwt.claim.sub',pg_temp.id('editor')::text,true);
  perform pg_temp.fails(format('select public.claim_equipment_alerts(%L,%L)',pg_temp.id('other'),gen_random_uuid()),'42501','other incident inaccessible');
  perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
  perform pg_temp.ok(public.sync_equipment_alerts(pg_temp.id('other'))->'alerts'='[]'::jsonb,'sync scopes to requested incident');
  perform pg_temp.fails(format('select public.dismiss_equipment_alert(%L,%L,%L)',pg_temp.id('other'),pg_temp.id('alert'),pg_temp.id('token4')),'42501','alert ID cannot cross incident');
end $$;
select pg_temp.fails('select * from public.equipment_alert_deliveries','42501','delivery SELECT is RPC-only');
select pg_temp.fails('update public.equipment_cycle_alerts set resolved_at=now()','42501','direct alert write denied');
select pg_temp.fails('delete from public.equipment_alert_deliveries','42501','direct delivery write denied');
reset role;
grant update on public.equipment_cycle_alerts,public.equipment_alert_deliveries to authenticated;
set local role authenticated;
with changed as (update public.equipment_cycle_alerts set updated_at=now() returning id)
select pg_temp.ok(not exists(select 1 from changed),'alert RLS independently blocks writes');
-- No SELECT privilege required when no columns are referenced or returned.
with changed as (update public.equipment_alert_deliveries set updated_at=now() returning 1)
select pg_temp.ok(not exists(select 1 from changed),'delivery RLS independently blocks writes');
reset role;
revoke update on public.equipment_cycle_alerts,public.equipment_alert_deliveries from authenticated;

-- Resolver failure must roll back the ENTIRE stage-4 refuel, including its log.
create function pg_temp.fail_delivery() returns trigger language plpgsql as $$
begin
  if new.alert_id=pg_temp.id('alert') and current_setting('equipment.test.fail_delivery',true)='on' then
    raise exception 'Injected delivery failure' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger alert_test_delivery_failure before update on public.equipment_alert_deliveries for each row execute function pg_temp.fail_delivery();
do $$ declare before_a jsonb; before_c jsonb; before_alert jsonb; logs bigint; request uuid:=gen_random_uuid(); result jsonb; after_alert jsonb;
begin
  select to_jsonb(a) into before_a from public.incident_equipment_assignments a where id=pg_temp.id('main');
  select jsonb_agg(to_jsonb(c) order by cycle_number) into before_c from public.equipment_cycles c where assignment_id=pg_temp.id('main');
  select to_jsonb(a) into before_alert from public.equipment_cycle_alerts a where id=pg_temp.id('alert');
  select count(*) into logs from public.event_logs where incident_id=pg_temp.id('incident');
  perform set_config('equipment.test.fail_delivery','on',true);
  set local role authenticated;
  perform pg_temp.fails(format('select public.confirm_equipment_refuel(%L,%L,4,%L)',pg_temp.id('incident'),pg_temp.id('main'),request),'P0001','resolver failure rejects refuel');
  reset role;
  perform set_config('equipment.test.fail_delivery','off',true);
  perform pg_temp.ok(before_a=(select to_jsonb(a) from public.incident_equipment_assignments a where id=pg_temp.id('main'))
    and before_c=(select jsonb_agg(to_jsonb(c) order by cycle_number) from public.equipment_cycles c where assignment_id=pg_temp.id('main'))
    and before_alert=(select to_jsonb(a) from public.equipment_cycle_alerts a where id=pg_temp.id('alert'))
    and logs=(select count(*) from public.event_logs where incident_id=pg_temp.id('incident'))
    and not exists(select 1 from public.equipment_operation_requests where request_id=request),'refuel/cycles/alert/log/request rolled back');
  set local role authenticated;
  result:=public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('main'),4,request);
  select to_jsonb(a) into after_alert from public.equipment_cycle_alerts a where id=pg_temp.id('alert');
  perform pg_temp.ok(after_alert->>'resolution_reason'='refueled' and after_alert->>'resolved_at'=result->>'server_now'
    and (after_alert->>'resolved_by')::uuid=auth.uid(),'refuel resolves at exact clock engine timestamp with authenticated actor');
  perform pg_temp.ok(public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('main'),4,request)=result
    and after_alert=(select to_jsonb(a) from public.equipment_cycle_alerts a where id=pg_temp.id('alert')),'refuel replay preserves original alert resolution');
  perform pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),gen_random_uuid())->'alerts'='[]'::jsonb,'resolved and unstarted refueled cycles not claimed');
  perform pg_temp.fails(format('select public.ack_equipment_alert_presented(%L,%L,%L)',pg_temp.id('incident'),pg_temp.id('alert'),pg_temp.id('token4')),'55000','refuel invalidates late ack');
  reset role;
  perform pg_temp.ok(not exists(select 1 from public.equipment_alert_deliveries where alert_id=pg_temp.id('alert')
    and (lease_until is not null or presentation_token is not null or next_due_at is not null or snoozed_until is not null)),'refuel clears every user lease and schedule');
end $$;

-- A batch can contain multiple alerts. Ack of a warning claimed BEFORE zero
-- must not record critical merely because time advanced before the ack.
select pg_temp.fixture('inflight1');
select pg_temp.fixture('inflight2');
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('inflight1'),1,gen_random_uuid());
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('inflight2'),1,gen_random_uuid());
select pg_temp.backdate('inflight1',500);
select pg_temp.backdate('inflight2',500);
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token1'))->'alerts')=2,'multiple alerts returned in one batch');
reset role;
select pg_temp.backdate('inflight1',700);
insert into alert_test_ids select 'inflight_alert',id from public.equipment_cycle_alerts where cycle_id=pg_temp.id('inflight1_cycle');
set local role authenticated;
select pg_temp.ok(public.ack_equipment_alert_presented(pg_temp.id('incident'),pg_temp.id('inflight_alert'),pg_temp.id('token1'))->>'last_presented_severity'='warning','late warning ack does not swallow critical');
select pg_temp.ok(public.claim_equipment_alerts(pg_temp.id('incident'),pg_temp.id('token2'))#>>'{alerts,0,severity}'='critical','critical immediately claimable after late warning ack');
select public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('inflight1'),2,gen_random_uuid());
select public.confirm_equipment_refuel(pg_temp.id('incident'),pg_temp.id('inflight2'),2,gen_random_uuid());
reset role;

-- Automatic log failure rolls back newly detected alerts as well.
select pg_temp.fixture('fault');
select public.start_equipment(pg_temp.id('incident'),pg_temp.id('fault'),1,gen_random_uuid());
select pg_temp.backdate('fault',700);
create function pg_temp.fail_threshold_log() returns trigger language plpgsql as $$
begin
  if new.entity_id=pg_temp.id('fault_cycle') and new.log_type='equipment_runtime_exhausted' then
    raise exception 'Injected threshold log failure' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger alert_test_log_failure before insert on public.event_logs for each row execute function pg_temp.fail_threshold_log();
set local role authenticated;
select pg_temp.fails(format('select public.sync_equipment_alerts(%L)',pg_temp.id('incident')),'P0001','automatic log failure propagated');
select pg_temp.ok(not exists(select 1 from public.equipment_cycle_alerts where cycle_id=pg_temp.id('fault_cycle'))
  and not exists(select 1 from public.event_logs where entity_id=pg_temp.id('fault_cycle')),'both threshold records and logs roll back together');
reset role;
drop trigger alert_test_log_failure on public.event_logs;
select public.sync_equipment_alerts(pg_temp.id('incident'));
select public.sync_equipment_alerts(pg_temp.id('incident'));
select pg_temp.ok((select count(*)=2 from public.event_logs where entity_id=pg_temp.id('main_cycle'))
  and (select count(*)=2 from public.event_logs where entity_id=pg_temp.id('fault_cycle')),'one warning and one exhaustion log per cycle');
select pg_temp.ok(not exists(select 1 from public.event_logs where entity_id in (pg_temp.id('main_cycle'),pg_temp.id('fault_cycle'))
  and (created_by is not null or metadata->>'detected_at' is null or metadata->>'crossing_time_source' is null
    or reported_at>created_at)),'automatic logs have NULL actor, calculated time and detection metadata');
select pg_temp.fixture('release');
select public.release_equipment(pg_temp.id('incident'),pg_temp.id('release'),1,gen_random_uuid(),'Test off return');
select pg_temp.ok(not exists(select 1 from public.equipment_cycle_alerts where cycle_id=pg_temp.id('release_cycle')),'off release has no active alert');

do $$ declare lifecycle text;
begin
  update public.incidents set lifecycle_status='paused' where id=pg_temp.id('incident');
  set local role authenticated;
  perform pg_temp.ok(jsonb_array_length(public.sync_equipment_alerts(pg_temp.id('incident'))->'alerts')=1,'paused incident continues equipment alerts');
  reset role;
  foreach lifecycle in array array['closed','archived'] loop
    update public.incidents set lifecycle_status=case when lifecycle='closed' then 'closed' else 'active' end,
      is_closed=lifecycle='closed',ended_at=case when lifecycle='closed' then now() else null end,
      archived_at=case when lifecycle='archived' then now() else null end where id=pg_temp.id('incident');
    set local role authenticated;
    perform pg_temp.fails(format('select public.claim_equipment_alerts(%L,%L)',pg_temp.id('incident'),gen_random_uuid()),
      case when lifecycle='closed' then '55000' else '42501' end,lifecycle || ' claim blocked');
    reset role;
  end loop;
end $$;
rollback;
