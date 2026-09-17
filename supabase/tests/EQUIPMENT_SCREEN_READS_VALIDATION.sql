-- Stage 7. Run as postgres ONLY on a disposable LOCAL Supabase database.
-- Migrations must already be installed there. psql -v ON_ERROR_STOP=1.
-- Opt in: SET rcc.equipment_screen_test_database='disposable-local';
-- All fixtures, timestamp adjustments and injected failures roll back.
begin;
do $$ begin
  if current_setting('rcc.equipment_screen_test_database',true) is distinct from 'disposable-local'
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
create temporary table screen_test_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into screen_test_ids(key) values ('admin'),('commander'),('editor'),('viewer'),('search_user'),
  ('inactive'),('deleted'),('outsider'),('readonly_editor'),('incident'),('other'),('team');
create function pg_temp.id(key_name text) returns uuid language sql as $$ select id from screen_test_ids where key=key_name $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('rcc.sql_editor_validation_mode','off',true);
insert into auth.users(id,email,raw_user_meta_data)
select id,id::text || '@equipment-clock.invalid','{}'::jsonb from screen_test_ids
where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
delete from public.profiles where id in (select id from screen_test_ids);
insert into public.profiles(id,role,is_active,deleted_at)
select id,case when key in ('inactive','deleted') then 'admin' when key in ('outsider','readonly_editor') then 'editor' else key end,
  key<>'inactive',case when key='deleted' then now() else null end
from screen_test_ids where key in ('admin','commander','editor','viewer','search_user','inactive','deleted','outsider','readonly_editor');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
insert into public.incidents(id,name,address,status_id,lifecycle_status)
select id,'Screen fixture ' || key,'Test',public.get_status_id('incident','active',null),'active'
from screen_test_ids where key in ('incident','other');
insert into public.teams(id,incident_id,team_number,name) values(pg_temp.id('team'),pg_temp.id('incident'),1,'Clock team');
insert into public.incident_memberships(incident_id,user_id,role)
select pg_temp.id('incident'),id,case when key='editor' then 'command_post_operator' else 'observer' end
from screen_test_ids where key in ('editor','viewer','search_user','readonly_editor');
insert into screen_test_ids values ('type',public.create_equipment_type('Clock generator','Power',7200,1800));
insert into screen_test_ids values ('item',public.create_equipment_item(pg_temp.id('type'),'clock-' || gen_random_uuid()::text));
grant select,insert on screen_test_ids to authenticated;
-- All test changes below affect our temporary fixtures and roll back.
set local role authenticated;
do $$ declare actor text; reading jsonb;
begin
  foreach actor in array array['admin','commander','editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    reading:=public.get_available_equipment_for_incident(pg_temp.id('incident'));
    perform pg_temp.check_true(exists(select 1 from jsonb_array_elements(reading) e
      where e->>'equipment_item_id'=pg_temp.id('item')::text),actor || ' can select available equipment');
    perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(reading) e
      where not (e ?& array['equipment_item_id','asset_identifier','serial_number','equipment_type_id',
        'equipment_type_name','full_runtime_seconds','warning_before_seconds'])), 'selection contract');
  end loop;
  foreach actor in array array['viewer','search_user','inactive','deleted','outsider','readonly_editor'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
    perform pg_temp.expect_error(format('select public.get_available_equipment_for_incident(%L)',pg_temp.id('incident')),
      '42501',actor || ' cannot select equipment');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error(format('select public.get_available_equipment_for_incident(%L)',pg_temp.id('incident')),
    '42501','missing authenticated identity denied');
  perform set_config('request.jwt.claim.sub',pg_temp.id('editor')::text,true);
  perform pg_temp.expect_error(format('select public.get_available_equipment_for_incident(%L)',pg_temp.id('other')),
    '42501','unrelated incident denied');
  perform pg_temp.check_true((select count(*)=0 from public.equipment_types)
    and (select count(*)=0 from public.equipment_items),'catalog RLS remains admin only');
end $$;
reset role;
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);

create function pg_temp.item_visible() returns boolean language sql as $$
  select exists(select 1 from jsonb_array_elements(public.get_available_equipment_for_incident(pg_temp.id('incident'))) e
    where e->>'equipment_item_id'=pg_temp.id('item')::text)
$$;
-- Exercise catalog changes through the public admin RPCs, never bypass audit.
do $$ declare state text;
begin
  foreach state in array array['restricted','unserviceable'] loop
    perform public.update_equipment_item(pg_temp.id('item'),pg_temp.id('type'),'screen-' || pg_temp.id('item')::text,null,state,null,true);
    set local role authenticated;
    perform pg_temp.check_true(not pg_temp.item_visible(),state || ' excluded');
    reset role;
  end loop;
  perform public.update_equipment_item(pg_temp.id('item'),pg_temp.id('type'),'screen-' || pg_temp.id('item')::text,'serial-test','serviceable',null,false);
  set local role authenticated;
  perform pg_temp.check_true(not pg_temp.item_visible(),'inactive item excluded');
  reset role;
  perform public.update_equipment_item(pg_temp.id('item'),pg_temp.id('type'),'screen-' || pg_temp.id('item')::text,'serial-test','serviceable',null,true);
  perform public.update_equipment_type(pg_temp.id('type'),'Generator','Power',7200,1800,null,false);
  set local role authenticated;
  perform pg_temp.check_true(not pg_temp.item_visible(),'inactive type excluded');
  reset role;
  perform public.update_equipment_type(pg_temp.id('type'),'Generator','Power',7200,1800,null,true);
end $$;

-- Lifecycle checks on an empty event so the Stage 6 direct-close guard is respected.
do $$ declare state text;
begin
  foreach state in array array['paused','closed','archived'] loop
    update public.incidents set lifecycle_status=case when state='archived' then 'active' else state end,
      is_closed=state='closed',ended_at=case when state='closed' then clock_timestamp() else null end,
      archived_at=case when state='archived' then clock_timestamp() else null end where id=pg_temp.id('incident');
    set local role authenticated;
    perform pg_temp.expect_error(format('select public.get_available_equipment_for_incident(%L)',pg_temp.id('incident')),
      case when state='archived' then '42501' else '55000' end,state || ' forbids allocation selection');
    reset role;
  end loop;
  update public.incidents set lifecycle_status='active',is_closed=false,ended_at=null,archived_at=null where id=pg_temp.id('incident');
end $$;
set local role authenticated;
insert into screen_test_ids values ('assignment',(public.assign_equipment(pg_temp.id('incident'),pg_temp.id('item'),gen_random_uuid(),pg_temp.id('team'))->>'assignment_id')::uuid);
select pg_temp.check_true(not pg_temp.item_visible(),'open assignment excluded from availability');
reset role;
create temporary table screen_before_read as select public.get_incident_equipment_state(pg_temp.id('incident')) as state;
grant select on screen_before_read to authenticated;
select public.update_equipment_item(pg_temp.id('item'),pg_temp.id('type'),'screen-' || pg_temp.id('item')::text,'serial-new','restricted',null,false);
select public.update_equipment_type(pg_temp.id('type'),'Changed generator','Power',14400,3600,null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('viewer')::text,true);
do $$ declare reading jsonb; row_data jsonb; old_row jsonb;
begin
  reading:=public.get_incident_equipment_state(pg_temp.id('incident'));
  row_data:=reading#>'{equipment,0}';
  select state#>'{equipment,0}' into old_row from screen_before_read;
  perform pg_temp.check_true(reading ?& array['server_now','equipment'] and row_data->>'serial_number'='serial-new',
    'viewer can read additive serial field');
  perform pg_temp.check_true(row_data ?& array['assignment_id','incident_id','cycle_id','cycle_number','operation_state',
    'accumulated_active_seconds','running_since','first_started_at','full_runtime_seconds_snapshot',
    'warning_before_seconds_snapshot','elapsed_seconds','remaining_seconds','calculated_time_state','server_now','version',
    'equipment_item_id','equipment_type_id_snapshot','equipment_type_name_snapshot','category_snapshot','instructions_snapshot',
    'asset_identifier_snapshot','team_id','ad_hoc_team_id','location','notes','ended_at','end_reason','refueled_at','refueled_by',
    'team_name','team_number','team_kind','equipment_item_is_active','equipment_type_is_active','serviceability'],
    'all previous state keys retained');
  perform pg_temp.check_true(row_data->>'serviceability'='restricted' and row_data->>'equipment_item_is_active'='false'
    and row_data->>'equipment_type_is_active'='false','current catalog warning fields');
  perform pg_temp.check_true(row_data->'full_runtime_seconds_snapshot'=old_row->'full_runtime_seconds_snapshot'
    and row_data->'warning_before_seconds_snapshot'=old_row->'warning_before_seconds_snapshot'
    and row_data->'equipment_type_name_snapshot'=old_row->'equipment_type_name_snapshot'
    and row_data->'cycle_id'=old_row->'cycle_id' and row_data->'operation_state'=old_row->'operation_state'
    and row_data->'accumulated_active_seconds'=old_row->'accumulated_active_seconds','catalog change preserves snapshot and clock');
end $$;
reset role;
select pg_temp.check_true(not has_function_privilege('anon','public.get_available_equipment_for_incident(uuid)','execute')
  and not has_function_privilege('service_role','public.get_available_equipment_for_incident(uuid)','execute')
  and has_function_privilege('authenticated','public.get_available_equipment_for_incident(uuid)','execute'),'availability execute privileges');
select pg_temp.check_true((select bool_and(prosecdef and 'search_path=pg_catalog, public'=any(proconfig))
  from pg_proc where oid in ('public.get_available_equipment_for_incident(uuid)'::regprocedure,
    'public.get_incident_equipment_state(uuid)'::regprocedure)),'fixed search_path and SECURITY DEFINER');
set constraints all immediate;
rollback;
