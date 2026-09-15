-- Stage 1 equipment catalog integration validation.
-- Run ONLY on an isolated disposable local Supabase database, after migrations.
-- Run as postgres with psql ON_ERROR_STOP=1. Never run against a remote database.
-- Explicit opt-in: SET rcc.equipment_catalog_test_database = 'disposable-local';
-- Fixtures, temporary grants and fault-injection DDL are all rolled back.
begin;
do $$
begin
  if current_setting('rcc.equipment_catalog_test_database', true) is distinct from 'disposable-local' then
    raise exception 'Explicit disposable-local database opt-in required';
  end if;
end;
$$;

create function pg_temp.check_true(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end;
$$;
create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state is distinct from p_state then
    raise exception 'FAIL: %, expected %, got %', p_label, p_state, coalesce(v_state, 'success');
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create temporary table equipment_test_users (
  id uuid primary key default gen_random_uuid(), label text unique,
  role_name text, active boolean default true, deleted boolean default false
);
insert into equipment_test_users(label, role_name, active, deleted) values
  ('admin', 'admin', true, false), ('commander', 'commander', true, false),
  ('editor', 'editor', true, false), ('viewer', 'viewer', true, false),
  ('search_user', 'search_user', true, false), ('inactive', 'admin', false, false),
  ('deleted', 'admin', true, true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select set_config('rcc.sql_editor_validation_mode', 'off', true);
insert into auth.users(id, email, raw_user_meta_data)
select id, id::text || '@equipment-test.invalid', '{}'::jsonb from equipment_test_users;
-- The existing auth trigger creates viewer profiles. Reinsert only our new
-- fixtures with their intended roles; never modify an existing user.
delete from public.profiles where id in (select id from equipment_test_users);
insert into public.profiles(id, display_name, role, is_active, deleted_at)
select id, 'Equipment validation ' || label, role_name, active,
  case when deleted then now() else null end from equipment_test_users;
create temporary table equipment_test_ids(label text primary key, id uuid);
grant select on equipment_test_users to authenticated;
grant select, insert on equipment_test_ids to authenticated;

select set_config('request.jwt.claim.sub', (select id::text from equipment_test_users where label = 'admin'), true);
set local role authenticated;
insert into equipment_test_ids values
  ('type', public.create_equipment_type(' Generator ', ' Power ', 7200));
insert into equipment_test_ids values
  ('item', public.create_equipment_item((select id from equipment_test_ids where label = 'type'), E'  GEN\t  01  '));
select pg_temp.check_true(
  (select warning_before_seconds = 1800 and name = 'Generator' and category = 'Power'
    and created_by = auth.uid() and updated_by = auth.uid()
   from public.equipment_types where id = (select id from equipment_test_ids where label = 'type')),
  'active admin creates type, defaults and authenticated provenance');
select pg_temp.check_true(
  (select asset_identifier = 'gen 01' and serviceability = 'serviceable' and is_active
   from public.equipment_items where id = (select id from equipment_test_ids where label = 'item')),
  'active admin creates item with canonical identity and defaults');
select public.update_equipment_type((select id from equipment_test_ids where label = 'type'),
  'Generator updated', 'Power', 10800, 900, 'Instructions', false);
select public.update_equipment_item((select id from equipment_test_ids where label = 'item'),
  (select id from equipment_test_ids where label = 'type'), 'GEN 01', 'serial', 'restricted', 'Notes', false);
select pg_temp.check_true(
  (select count(*) = 4 from public.equipment_catalog_audit
   where entity_id in (select id from equipment_test_ids)), 'one audit row per create/update');
select pg_temp.check_true(
  (select count(*) = 2 from public.equipment_catalog_audit a
   where entity_id in (select id from equipment_test_ids) and action_type = 'create'
     and before_state is null and after_state->>'id' = entity_id::text and actor_id = auth.uid()),
  'creation audit has NULL before and stored after, authenticated actor');
select pg_temp.check_true(
  (select before_state->>'name' = 'Generator' and after_state->>'name' = 'Generator updated'
     and after_state->>'is_active' = 'false' and actor_id = auth.uid()
   from public.equipment_catalog_audit where entity_id = (select id from equipment_test_ids where label = 'type')
     and action_type = 'update'), 'type update audit before/after includes deactivation');
select pg_temp.check_true(
  (select before_state->>'serviceability' = 'serviceable' and after_state->>'serviceability' = 'restricted'
   from public.equipment_catalog_audit where entity_id = (select id from equipment_test_ids where label = 'item')
     and action_type = 'update'), 'item update audit before/after');

-- Prove canonical uniqueness also applies to updates, not just creation.
do $$
declare v_other uuid;
  v_type uuid := (select id from equipment_test_ids where label = 'type');
begin
  -- Subtransaction rolls this extra successful fixture back after the check.
  begin
    v_other := public.create_equipment_item(v_type, 'other-fixture');
    perform pg_temp.expect_error(format(
      'select public.update_equipment_item(%L, %L, %L, null, ''serviceable'', null, true)',
      v_other, v_type, E' GeN\t01 '), '23505', 'update rejects duplicate canonical identity');
    raise exception 'Rollback temporary item fixture' using errcode = 'Z0001';
  exception when sqlstate 'Z0001' then null;
  end;
end;
$$;

do $$
declare v_type uuid := (select id from equipment_test_ids where label = 'type');
  v_item uuid := (select id from equipment_test_ids where label = 'item');
  v_duration integer;
begin
  foreach v_duration in array array[0, -1] loop
    perform pg_temp.expect_error(format('select public.create_equipment_type(''Bad'', ''Power'', %s, 1)', v_duration),
      '23514', 'reject non-positive runtime');
  end loop;
  foreach v_duration in array array[0, -1, 7201] loop
    perform pg_temp.expect_error(format('select public.create_equipment_type(''Bad'', ''Power'', 7200, %s)', v_duration),
      '23514', 'reject invalid warning duration');
  end loop;
  perform pg_temp.expect_error('select public.create_equipment_type(''Bad'', ''Power'', NULL)', '23502', 'reject NULL runtime');
  perform pg_temp.expect_error('select public.create_equipment_type(''Bad'', ''Power'', 7200, NULL)', '23502', 'reject NULL warning');
  perform pg_temp.expect_error('select public.create_equipment_type('' '', ''Power'', 7200)', '23514', 'reject blank name');
  perform pg_temp.expect_error('select public.create_equipment_type(''Bad'', '''', 7200)', '23514', 'reject blank category');
  perform pg_temp.expect_error(format('select public.create_equipment_item(%L, %L)', v_type, E' GEN\n01 '),
    '23505', 'reject duplicate normalized identifier, including inactive items');
  perform pg_temp.expect_error(format('select public.create_equipment_item(%L, %L)', v_type, E' \t '),
    '23514', 'reject blank identifier');
  perform pg_temp.expect_error(format('select public.create_equipment_item(%L, ''bad'', null, ''invalid'')', v_type),
    '23514', 'reject unknown serviceability');
  perform pg_temp.expect_error(format('select public.create_equipment_item(%L, ''bad'', null, null)', v_type),
    '23502', 'reject NULL serviceability');
  perform pg_temp.expect_error(format('select public.create_equipment_item(%L, ''orphan'')', gen_random_uuid()),
    '23503', 'reject nonexistent type');
  perform pg_temp.expect_error(format('select public.update_equipment_type(%L, ''Bad'', ''Power'', 0, 1, null, true)', v_type),
    '23514', 'update enforces duration constraints');
  perform pg_temp.expect_error(format('select public.update_equipment_item(%L, %L, ''bad'', null, ''invalid'', null, true)', v_item, v_type),
    '23514', 'update enforces serviceability');
  perform pg_temp.expect_error('insert into public.equipment_types(name) values (''Bypass'')', '42501', 'admin cannot insert directly');
  perform pg_temp.expect_error('update public.equipment_items set is_active = true', '42501', 'admin cannot update directly');
  perform pg_temp.expect_error('delete from public.equipment_types', '42501', 'admin cannot delete catalog');
  perform pg_temp.expect_error('insert into public.equipment_catalog_audit(entity_type) values (''equipment_item'')', '42501', 'cannot forge audit');
  perform pg_temp.expect_error('update public.equipment_catalog_audit set actor_id = auth.uid()', '42501', 'cannot edit audit');
  perform pg_temp.expect_error('delete from public.equipment_catalog_audit', '42501', 'cannot delete audit');
  perform pg_temp.expect_error('truncate public.equipment_catalog_audit', '42501', 'cannot truncate audit');
end;
$$;

-- Exercise all four RPCs as every non-admin or disabled/deleted admin.
do $$
declare v_user record; v_type uuid := (select id from equipment_test_ids where label = 'type');
  v_item uuid := (select id from equipment_test_ids where label = 'item');
begin
  for v_user in select * from equipment_test_users where label <> 'admin' loop
    perform set_config('request.jwt.claim.sub', v_user.id::text, true);
    perform pg_temp.expect_error('select public.create_equipment_type(''Forbidden'', ''Power'', 7200)', '42501', v_user.label || ' create type');
    perform pg_temp.expect_error(format('select public.update_equipment_type(%L, ''Forbidden'', ''Power'', 7200, 1800, null, true)', v_type), '42501', v_user.label || ' update type');
    perform pg_temp.expect_error(format('select public.create_equipment_item(%L, ''forbidden'')', v_type), '42501', v_user.label || ' create item');
    perform pg_temp.expect_error(format('select public.update_equipment_item(%L, %L, ''forbidden'', null, ''serviceable'', null, true)', v_item, v_type), '42501', v_user.label || ' update item');
    perform pg_temp.check_true(not exists (select from public.equipment_types), v_user.label || ' RLS hides catalog');
    perform pg_temp.check_true(not exists (select from public.equipment_catalog_audit), v_user.label || ' RLS hides audit');
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('rcc.sql_editor_validation_mode', 'on', true);
  perform set_config('rcc.test_user_id', (select id::text from equipment_test_users where label = 'admin'), true);
  perform pg_temp.expect_error('select public.create_equipment_type(''Forbidden'', ''Power'', 7200)', '42501', 'validation actor cannot replace auth.uid');
  perform set_config('rcc.sql_editor_validation_mode', 'off', true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform pg_temp.expect_error('select public.create_equipment_type(''Forbidden'', ''Power'', 7200)', '42501', 'missing profile denied');
end;
$$;
reset role;

-- Verify RLS independently of revoked DML grants. Temporary grants roll back.
grant insert, update, delete on public.equipment_types, public.equipment_items to authenticated;
select set_config('request.jwt.claim.sub', (select id::text from equipment_test_users where label = 'admin'), true);
set local role authenticated;
select pg_temp.expect_error('insert into public.equipment_types(name, category, full_runtime_seconds) values (''RLS'', ''Power'', 7200)',
  '42501', 'RLS denies direct INSERT even if table grant is restored');
with attempted as (update public.equipment_types set name = 'RLS bypass' returning id)
select pg_temp.check_true((select count(*) = 0 from attempted), 'RLS denies direct UPDATE');
with attempted as (delete from public.equipment_items returning id)
select pg_temp.check_true((select count(*) = 0 from attempted), 'RLS denies direct DELETE');
reset role;
revoke insert, update, delete on public.equipment_types, public.equipment_items from authenticated;

-- Owner-level attempts also exercise immutable/delete triggers themselves.
select pg_temp.expect_error('update public.equipment_catalog_audit set occurred_at = now()', '42501', 'audit immutable trigger');
select pg_temp.expect_error('delete from public.equipment_catalog_audit', '42501', 'audit delete trigger');
select pg_temp.expect_error('delete from public.equipment_items', '42501', 'item deletion trigger');

-- Inject a real audit INSERT failure and verify the catalog statement rolls back.
create function pg_temp.fail_equipment_audit()
returns trigger language plpgsql as $$
begin raise exception 'Injected audit failure' using errcode = 'P0001'; end;
$$;
create trigger equipment_test_audit_failure before insert on public.equipment_catalog_audit
  for each row execute function pg_temp.fail_equipment_audit();
set local role authenticated;
select pg_temp.expect_error('select public.create_equipment_type(''Audit failure fixture'', ''Power'', 7200)', 'P0001', 'failed audit rejects create');
select pg_temp.check_true(not exists (select from public.equipment_types where name = 'Audit failure fixture'), 'failed audit rolls back created type');
select pg_temp.expect_error(format('select public.update_equipment_type(%L, ''Audit failure fixture'', ''Power'', 7200, 1800, null, true)',
  (select id from equipment_test_ids where label = 'type')), 'P0001', 'failed audit rejects update');
select pg_temp.check_true((select name = 'Generator updated' from public.equipment_types
  where id = (select id from equipment_test_ids where label = 'type')), 'failed audit rolls back updated type');
select pg_temp.expect_error(format('select public.create_equipment_item(%L, ''audit-failure-item'')',
  (select id from equipment_test_ids where label = 'type')), 'P0001', 'failed audit rejects item create');
select pg_temp.check_true(not exists (select from public.equipment_items where asset_identifier = 'audit-failure-item'), 'failed audit rolls back created item');
select pg_temp.expect_error(format('select public.update_equipment_item(%L, %L, ''audit-failure-item'', null, ''serviceable'', null, true)',
  (select id from equipment_test_ids where label = 'item'), (select id from equipment_test_ids where label = 'type')),
  'P0001', 'failed audit rejects item update');
select pg_temp.check_true((select asset_identifier = 'gen 01' and serviceability = 'restricted' from public.equipment_items
  where id = (select id from equipment_test_ids where label = 'item')), 'failed audit rolls back updated item');
reset role;
drop trigger equipment_test_audit_failure on public.equipment_catalog_audit;

select pg_temp.check_true(not exists (
  select from information_schema.columns where table_schema = 'public'
    and table_name in ('equipment_types', 'equipment_items', 'equipment_catalog_audit')
    and column_name in ('operational_readiness', 'needs_refuel', 'incident_id')
), 'catalog has no readiness or incident dependency');
set local role authenticated;
select pg_temp.expect_error(format('select public.create_equipment_item(%L, ''bad-ready'', null, ''needs_refuel'')',
  (select id from equipment_test_ids where label = 'type')), '23514', 'needs_refuel is not a serviceability state');
reset role;
select pg_temp.check_true(not has_function_privilege('anon', 'public.create_equipment_type(text,text,integer,integer,text,boolean)', 'EXECUTE'), 'anonymous RPC execution denied');
select pg_temp.check_true(not has_function_privilege('authenticated', 'public.audit_equipment_catalog_write()', 'EXECUTE'), 'internal audit helper not exposed');
do $$
declare v_table text; v_role text; v_operation text; v_function regprocedure;
begin
  foreach v_table in array array['equipment_types', 'equipment_items', 'equipment_catalog_audit'] loop
    perform pg_temp.check_true((select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass), v_table || ' RLS enabled');
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_operation in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        perform pg_temp.check_true(not has_table_privilege(v_role, 'public.' || v_table, v_operation),
          v_role || ' has no ' || v_operation || ' on ' || v_table);
      end loop;
    end loop;
  end loop;
  for v_function in select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('create_equipment_type', 'update_equipment_type', 'create_equipment_item', 'update_equipment_item')
  loop
    perform pg_temp.check_true(has_function_privilege('authenticated', v_function, 'EXECUTE')
      and not has_function_privilege('anon', v_function, 'EXECUTE')
      and not has_function_privilege('service_role', v_function, 'EXECUTE'), v_function::text || ' execution grants');
  end loop;
end;
$$;
select pg_temp.check_true((select count(*) = 4 from public.equipment_catalog_audit
  where entity_id in (select id from equipment_test_ids)), 'rejected operations left no extra audit rows');
rollback;
