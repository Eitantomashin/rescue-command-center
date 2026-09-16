-- DISPOSABLE LOCAL database only, postgres, psql ON_ERROR_STOP=1.
-- SET rcc.equipment_lifecycle_test_database='disposable-local';
-- Purge is exercised ONLY against newly generated fixtures. Everything rolls back.
begin;
do $$ begin
  if current_setting('rcc.equipment_lifecycle_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required'; end if;
end $$;
create function pg_temp.ok(p_value boolean,p_label text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAIL: %',p_label; end if; raise notice 'PASS: %',p_label; end $$;
create function pg_temp.fails(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_sql; exception when others then get stacked diagnostics v_state=returned_sqlstate; end;
  perform pg_temp.ok(v_state is not null and (p_state is null or v_state=p_state),p_label || ': ' || coalesce(v_state,'success'));
end $$;
create temporary table lifecycle_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into lifecycle_ids(key) values('admin'),('commander'),('editor'),('viewer'),('search_user'),('inactive'),('deleted'),('outsider'),
  ('manual'),('closing'),('empty'),('other'),('fault'),('team_manual'),('team_closing'),('team_empty'),('team_other'),('team_fault'),('adhoc'),('request');
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from lifecycle_ids where key=p_key $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('rcc.sql_editor_validation_mode','off',true);
insert into auth.users(id,email,raw_user_meta_data) select id,id::text || '@equipment-lifecycle.invalid','{}'::jsonb from lifecycle_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider');
delete from public.profiles where id in (select id from lifecycle_ids);
insert into public.profiles(id,role,is_active,deleted_at)
select id,case when key in ('inactive','deleted') then 'admin' when key='outsider' then 'editor' else key end,
  key<>'inactive',case when key='deleted' then now() else null end from lifecycle_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
insert into public.incidents(id,name,address,status_id,lifecycle_status)
select id,'Equipment lifecycle ' || key,'Test',public.get_status_id('incident','active',null),'active' from lifecycle_ids
where key in ('manual','closing','empty','other','fault');
insert into public.teams(id,incident_id,team_number,name)
select pg_temp.id('team_' || key),id,1,'Lifecycle team' from lifecycle_ids where key in ('manual','closing','empty','other','fault');
insert into public.incident_ad_hoc_teams(id,incident_id,name) values(pg_temp.id('adhoc'),pg_temp.id('closing'),'Ad-hoc blockers');
insert into public.incident_memberships(incident_id,user_id,role)
select i.id,u.id,case when u.key='editor' then 'command_post_operator' else 'observer' end from lifecycle_ids i cross join lifecycle_ids u
where i.key in ('manual','closing','fault') and u.key in ('editor','viewer','search_user');
insert into lifecycle_ids values('type',public.create_equipment_type('Lifecycle generator','Power',600,120));
grant select,insert on lifecycle_ids to authenticated;

create function pg_temp.fixture(p_key text,p_incident text,p_state text,p_adhoc boolean default false)
returns void language plpgsql as $$
declare v_item uuid; v_result jsonb; v_assignment uuid; v_cycle uuid;
begin
  v_item:=public.create_equipment_item(pg_temp.id('type'),p_key || '-' || gen_random_uuid()::text);
  v_result:=public.assign_equipment(pg_temp.id(p_incident),v_item,gen_random_uuid(),
    case when p_adhoc then null else pg_temp.id('team_' || p_incident) end,case when p_adhoc then pg_temp.id('adhoc') else null end,'Test location');
  v_assignment:=(v_result->>'assignment_id')::uuid; v_cycle:=(v_result->>'cycle_id')::uuid;
  insert into lifecycle_ids values(p_key,v_assignment),(p_key || '_cycle',v_cycle),(p_key || '_item',v_item);
  if p_state<>'off' then
    perform public.start_equipment(pg_temp.id(p_incident),v_assignment,1,gen_random_uuid());
    update public.equipment_cycles set running_since=clock_timestamp()-interval '500 seconds',
      first_started_at=clock_timestamp()-interval '501 seconds' where id=v_cycle;
    if p_state='paused' then perform public.pause_equipment(pg_temp.id(p_incident),v_assignment,2,gen_random_uuid()); end if;
  end if;
end $$;
-- Owner-only snapshot includes personal delivery rows to catch partial writes.
create function pg_temp.snapshot(p_incident uuid) returns jsonb language sql as $$
  select jsonb_build_object('incident',(select to_jsonb(i) from public.incidents i where id=p_incident),
    'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.incident_equipment_assignments a where incident_id=p_incident),
    'cycles',(select jsonb_agg(to_jsonb(c) order by id) from public.equipment_cycles c where incident_id=p_incident),
    'alerts',(select jsonb_agg(to_jsonb(a) order by id) from public.equipment_cycle_alerts a where incident_id=p_incident),
    'deliveries',(select jsonb_agg(to_jsonb(d) order by alert_id,user_id) from public.equipment_alert_deliveries d where incident_id=p_incident),
    'requests',(select jsonb_agg(to_jsonb(r) order by actor_id,request_id) from public.equipment_operation_requests r where incident_id=p_incident),
    'logs',(select jsonb_agg(to_jsonb(l) order by id) from public.event_logs l where incident_id=p_incident),
    'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.closure_reports r where incident_id=p_incident))
$$;
select pg_temp.fixture('manual_off','manual','off');
select pg_temp.fixture('manual_paused','manual','paused');
select pg_temp.fixture('manual_running','manual','running');
set local role authenticated;
select public.claim_equipment_alerts(pg_temp.id('manual'),gen_random_uuid());
do $$ declare v_result jsonb;
begin
  v_result:=public.release_equipment(pg_temp.id('manual'),pg_temp.id('manual_off'),1,pg_temp.id('request'),'Return');
  perform pg_temp.ok(public.release_equipment(pg_temp.id('manual'),pg_temp.id('manual_off'),1,pg_temp.id('request'),'Return')=v_result,'off release replays original result');
  perform pg_temp.fails(format('select public.release_equipment(%L,%L,1,%L,''Changed'')',pg_temp.id('manual'),pg_temp.id('manual_off'),pg_temp.id('request')),'22023','request payload mismatch rejected');
end $$;
select pg_temp.fails(format('select public.release_equipment(%L,%L,1,%L,''Return'')',pg_temp.id('manual'),pg_temp.id('manual_paused'),gen_random_uuid()),'40001','stale version rejected');
select public.release_equipment(pg_temp.id('manual'),pg_temp.id('manual_paused'),3,gen_random_uuid(),'Return paused');
select pg_temp.fails(format('select public.release_equipment(%L,%L,2,%L,''Return'')',pg_temp.id('manual'),pg_temp.id('manual_running'),gen_random_uuid()),'55000','running cannot release');
reset role;
select pg_temp.ok((select count(*)=1 from public.equipment_cycles where assignment_id=pg_temp.id('manual_paused'))
  and (select end_reason='released' and accumulated_active_seconds>=500 and running_since is null from public.equipment_cycles where id=pg_temp.id('manual_paused_cycle')),'release keeps history and creates no new cycle');
select pg_temp.ok((select resolution_reason='released' from public.equipment_cycle_alerts where cycle_id=pg_temp.id('manual_paused_cycle'))
  and not exists(select 1 from public.equipment_alert_deliveries d join public.equipment_cycle_alerts a on a.id=d.alert_id
    where a.cycle_id=pg_temp.id('manual_paused_cycle') and (d.presentation_token is not null or d.lease_until is not null or d.next_due_at is not null or d.snoozed_until is not null)),'manual release clears alert and deliveries');
select pg_temp.ok((select count(*)=1 from public.event_logs where entity_id=pg_temp.id('manual_off') and log_type='equipment_released')
  and not exists(select 1 from public.event_logs where incident_id=pg_temp.id('manual') and log_type='equipment_refueled'),'one release log, no refuel logs');
select pg_temp.ok((select serviceability='serviceable' and is_active from public.equipment_items where id=pg_temp.id('manual_paused_item')),'release leaves catalog state unchanged');
do $$ declare v_new jsonb;
begin
  v_new:=public.assign_equipment(pg_temp.id('other'),pg_temp.id('manual_paused_item'),gen_random_uuid(),pg_temp.id('team_other'));
  perform pg_temp.ok((select operation_state='off' and accumulated_active_seconds=0 and running_since is null and first_started_at is null
    from public.equipment_cycles where id=(v_new->>'cycle_id')::uuid),'next assignment starts full and off');
end $$;

-- Permissions and paused incidents use the existing operational editor gate.
update public.incidents set lifecycle_status='paused' where id=pg_temp.id('manual');
set local role authenticated;
do $$ declare v_actor text;
begin
  foreach v_actor in array array['viewer','search_user','inactive','deleted','outsider'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(v_actor)::text,true);
    perform pg_temp.fails(format('select public.release_equipment(%L,%L,2,%L,''Return'')',pg_temp.id('manual'),pg_temp.id('manual_running'),gen_random_uuid()),'42501',v_actor || ' cannot release');
    perform pg_temp.fails(format('select public.close_incident_lifecycle(%L)',pg_temp.id('closing')),'42501',v_actor || ' cannot close');
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.id('editor')::text,true);
  perform pg_temp.fails(format('select public.close_incident_lifecycle(%L)',pg_temp.id('closing')),null,'editor cannot gain lifecycle authority');
  perform public.pause_equipment(pg_temp.id('manual'),pg_temp.id('manual_running'),2,gen_random_uuid());
  perform public.release_equipment(pg_temp.id('manual'),pg_temp.id('manual_running'),3,gen_random_uuid(),'Paused event return');
  perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
end $$;
reset role;

select pg_temp.fixture('close_off','closing','off');
select pg_temp.fixture('close_paused','closing','paused');
select pg_temp.fixture('close_running1','closing','running');
create function pg_temp.blocked_close(p_count integer) returns void language plpgsql as $$
declare v_before jsonb; v_details text; v_code text; v_blockers jsonb;
begin
  v_before:=pg_temp.snapshot(pg_temp.id('closing'));
  set local role authenticated;
  begin perform public.close_incident_lifecycle(pg_temp.id('closing'));
  exception when others then get stacked diagnostics v_details=pg_exception_detail,v_code=returned_sqlstate; end;
  reset role;
  v_blockers:=v_details::jsonb->'blocking_equipment';
  perform pg_temp.ok(v_code='55000' and jsonb_array_length(v_blockers)=p_count,'all running blockers returned');
  perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(v_blockers) x where
    not (x ?& array['assignment_id','equipment_item_id','asset_identifier','equipment_type_name','team_id','ad_hoc_team_id','team_name','location'])),'blocker payload complete');
  perform pg_temp.ok(pg_temp.snapshot(pg_temp.id('closing'))=v_before,'blocked closure leaves incident/equipment/alerts/logs unchanged');
end $$;
select public.claim_equipment_alerts(pg_temp.id('closing'),gen_random_uuid());
select pg_temp.blocked_close(1);
select pg_temp.fixture('close_running2','closing','running',true);
select public.claim_equipment_alerts(pg_temp.id('closing'),gen_random_uuid());
select pg_temp.blocked_close(2);
select pg_temp.fails(format('select public.close_incident(%L,''Legacy close'')',pg_temp.id('closing')),'55000','legacy close also blocks running equipment');
select pg_temp.fails(format('update public.incidents set is_closed=true where id=%L',pg_temp.id('closing')),'55000','direct close cannot bypass equipment guard');
select pg_temp.fails(format('update public.incidents set lifecycle_status=''closed'' where id=%L',pg_temp.id('closing')),'55000','direct lifecycle status close denied');
select pg_temp.fails(format('update public.incidents set status_id=public.get_status_id(''incident'',''closed'',%L) where id=%L',pg_temp.id('closing'),pg_temp.id('closing')),'55000','direct status_id close denied');
select public.pause_incident_lifecycle(pg_temp.id('closing'));
select pg_temp.ok((select lifecycle_status='paused' from public.incidents where id=pg_temp.id('closing'))
  and (select operation_state='running' from public.equipment_cycles where id=pg_temp.id('close_running1_cycle')),'legal incident pause preserves running equipment');
select public.reopen_incident_lifecycle(pg_temp.id('closing'));
select pg_temp.ok((select lifecycle_status='active' from public.incidents where id=pg_temp.id('closing')),'legal incident resume remains available');
select pg_temp.fails(format('update public.incidents set archived_at=now() where id=%L',pg_temp.id('closing')),'55000','direct archive cannot bypass equipment guard');
select pg_temp.fails(format('select public.archive_incident(%L,%L)',pg_temp.id('closing'),'Equipment lifecycle closing'),'55000','archive rejects open allocations');
select public.pause_equipment(pg_temp.id('closing'),pg_temp.id('close_running1'),2,gen_random_uuid());
select public.pause_equipment(pg_temp.id('closing'),pg_temp.id('close_running2'),2,gen_random_uuid());

-- Fail the SECOND release log after the first release has already succeeded.
create function pg_temp.fail_release_log() returns trigger language plpgsql as $$
begin
  if new.incident_id=pg_temp.id('closing') and new.log_type='equipment_released'
    and current_setting('equipment.test.fail_close',true)='on'
    and exists(select 1 from public.event_logs where incident_id=new.incident_id and log_type='equipment_released') then
    raise exception 'Injected second release failure' using errcode='P0001'; end if;
  return new;
end $$;
create trigger lifecycle_test_failure before insert on public.event_logs for each row execute function pg_temp.fail_release_log();
do $$ declare v_before jsonb;
begin
  v_before:=pg_temp.snapshot(pg_temp.id('closing'));
  perform set_config('equipment.test.fail_close','on',true);
  set local role authenticated;
  perform pg_temp.fails(format('select public.close_incident_lifecycle(%L)',pg_temp.id('closing')),'P0001','second release log failure aborts closure');
  reset role;
  perform set_config('equipment.test.fail_close','off',true);
  perform pg_temp.ok(pg_temp.snapshot(pg_temp.id('closing'))=v_before,'all releases, cycles, alerts, deliveries, event and report roll back');
end $$;
drop trigger lifecycle_test_failure on public.event_logs;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('commander')::text,true);
insert into lifecycle_ids values('report',public.close_incident_lifecycle(pg_temp.id('closing')));
select pg_temp.ok(public.close_incident_lifecycle(pg_temp.id('closing'))=pg_temp.id('report'),'repeated close returns existing report');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
reset role;
select pg_temp.ok((select is_closed and lifecycle_status='closed' from public.incidents where id=pg_temp.id('closing'))
  and not exists(select 1 from public.incident_equipment_assignments where incident_id=pg_temp.id('closing') and released_at is null)
  and not exists(select 1 from public.equipment_cycles where incident_id=pg_temp.id('closing') and ended_at is null),'mixed off/paused closure releases all equipment');
select pg_temp.ok((select count(*)=4 from public.event_logs where incident_id=pg_temp.id('closing') and log_type='equipment_released'
    and metadata->>'release_origin'='incident_closure' and metadata->>'automatic_release'='true' and created_by=pg_temp.id('commander'))
  and not exists(select 1 from public.event_logs where incident_id=pg_temp.id('closing') and log_type='equipment_refueled'),'one automatic release log per item attributed to closing user, no refuel');
select pg_temp.ok(not exists(select 1 from public.equipment_cycle_alerts where incident_id=pg_temp.id('closing') and resolved_at is null)
  and not exists(select 1 from public.equipment_alert_deliveries where incident_id=pg_temp.id('closing') and
    (presentation_token is not null or lease_until is not null or next_due_at is not null or snoozed_until is not null)),'closure cancels all alerts and presentation schedules');
select pg_temp.ok((select count(*)=1 from public.closure_reports where incident_id=pg_temp.id('closing')),'one closure report');
set local role authenticated;
select pg_temp.fails(format('select public.release_equipment(%L,%L,4,%L,''Closed'')',pg_temp.id('closing'),pg_temp.id('close_paused'),gen_random_uuid()),'55000','closed incident release denied');
select pg_temp.ok(public.close_incident_lifecycle(pg_temp.id('empty')) is not null,'empty event closes normally');
select public.archive_incident(pg_temp.id('closing'),'Equipment lifecycle closing');
select pg_temp.fails(format('select public.start_equipment(%L,%L,4,%L)',pg_temp.id('closing'),pg_temp.id('close_paused'),gen_random_uuid()),'42501','archived event operations denied');
reset role;

-- Existing purge order and FKs must actually remove every operational row,
-- while retaining exact catalog/audit contents and another incident's data.
do $$ declare v_before jsonb; v_types jsonb; v_items jsonb; v_audit jsonb; v_other jsonb; v_actor text;
begin
  v_before:=pg_temp.snapshot(pg_temp.id('closing')); v_other:=pg_temp.snapshot(pg_temp.id('other'));
  select jsonb_agg(to_jsonb(t) order by id) into v_types from public.equipment_types t;
  select jsonb_agg(to_jsonb(t) order by id) into v_items from public.equipment_items t;
  select jsonb_agg(to_jsonb(t) order by id) into v_audit from public.equipment_catalog_audit t;
  set local role authenticated;
  foreach v_actor in array array['commander','editor','viewer','search_user','inactive','deleted','outsider'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(v_actor)::text,true);
    perform pg_temp.fails(format('select public.permanently_delete_archived_incident(%L,%L)',pg_temp.id('closing'),'Equipment lifecycle closing'),'42501',v_actor || ' purge denied');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.fails(format('select public.permanently_delete_archived_incident(%L,%L)',pg_temp.id('closing'),'Equipment lifecycle closing'),'42501','missing identity purge denied');
  perform set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
  perform pg_temp.fails(format('select public.permanently_delete_archived_incident(%L,''Wrong name'')',pg_temp.id('closing')),null,'purge confirmation still required');
  perform pg_temp.fails(format('select public.permanently_delete_archived_incident(%L,%L)',pg_temp.id('other'),'Equipment lifecycle other'),null,'unarchived purge denied');
  reset role;
  perform pg_temp.ok(pg_temp.snapshot(pg_temp.id('closing'))=v_before,'denied purge changes nothing');
  set local role authenticated;
  perform public.permanently_delete_archived_incident(pg_temp.id('closing'),'Equipment lifecycle closing');
  reset role;
  perform pg_temp.ok(not exists(select 1 from public.incidents where id=pg_temp.id('closing'))
    and not exists(select 1 from public.incident_equipment_assignments where incident_id=pg_temp.id('closing'))
    and not exists(select 1 from public.equipment_cycles where incident_id=pg_temp.id('closing'))
    and not exists(select 1 from public.equipment_operation_requests where incident_id=pg_temp.id('closing'))
    and not exists(select 1 from public.equipment_cycle_alerts where incident_id=pg_temp.id('closing'))
    and not exists(select 1 from public.equipment_alert_deliveries where incident_id=pg_temp.id('closing'))
    and not exists(select 1 from public.event_logs where incident_id=pg_temp.id('closing')),'purge removes all incident equipment data and logs');
  perform pg_temp.ok(v_types=(select jsonb_agg(to_jsonb(t) order by id) from public.equipment_types t)
    and v_items=(select jsonb_agg(to_jsonb(t) order by id) from public.equipment_items t)
    and v_audit=(select jsonb_agg(to_jsonb(t) order by id) from public.equipment_catalog_audit t),'purge preserves catalog and audit exactly');
  perform pg_temp.ok(pg_temp.snapshot(pg_temp.id('other'))=v_other,'purge isolates other events');
end $$;
-- Force deferred FK validation now, before rollback can conceal a bad purge.
set constraints all immediate;
select pg_temp.ok(not has_function_privilege('authenticated','public.release_incident_equipment_for_closure(uuid)','execute')
  and not has_function_privilege('anon','public.close_incident_lifecycle(uuid)','execute'),'internal helper and anonymous execution denied');
rollback;
