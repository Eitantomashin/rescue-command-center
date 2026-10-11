-- Stage 10.1B.2A.1 validation. Run only against a verified disposable local database.
-- Fixture data and temporary permission changes are rolled back unconditionally.
-- Before execution, verify the target is the local Docker PostgreSQL container;
-- the opt-in settings below are a second guard, not evidence of isolation.

begin;

do $$
begin
  if current_setting('rcc.stage_10_1b_2a_1_test_database', true) is distinct from 'disposable-local' then
    raise exception 'Disposable local database opt-in required';
  end if;
end $$;

create function pg_temp.ok(p_value boolean, p_label text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

create function pg_temp.expect_state(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_sql; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from p_state then
    raise exception 'FAIL: %, expected %, got %', p_label, p_state, coalesce(v_state, 'success');
  end if;
  raise notice 'PASS: %', p_label;
end $$;

create temporary table stage_10_1b_2a_1_ids(key text primary key, id uuid not null default gen_random_uuid());
insert into stage_10_1b_2a_1_ids(key) values
  ('admin'), ('commander'), ('editor'), ('incident'), ('other_incident'), ('organic_team'),
  ('unit_one'), ('unit_two'), ('unit_three'), ('manual_one'),
  ('team_one'), ('team_two'), ('team_empty'), ('team_equipment'), ('other_team'),
  ('equipment_type'), ('equipment_item');
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from stage_10_1b_2a_1_ids where key = p_key $$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select set_config('rcc.sql_editor_validation_mode', 'on', true);

insert into auth.users(id, email, raw_user_meta_data)
select id, id::text || '@stage-10-1b-2a-1.invalid', '{}'::jsonb
from stage_10_1b_2a_1_ids where key in ('admin', 'commander', 'editor');
delete from public.profiles where id in (select id from stage_10_1b_2a_1_ids where key in ('admin', 'commander', 'editor'));
insert into public.profiles(id, role, is_active, deleted_at)
select id, key, true, null from stage_10_1b_2a_1_ids where key in ('admin', 'commander', 'editor');
select set_config('rcc.test_user_id', pg_temp.id('admin')::text, true);

insert into public.incidents(id, name, address, status_id, lifecycle_status, is_closed)
values
  (pg_temp.id('incident'), 'Stage 10.1B.2A.1', 'Test', public.get_status_id('incident', 'active', null), 'active', false),
  (pg_temp.id('other_incident'), 'Stage 10.1B.2A.1 other', 'Test', public.get_status_id('incident', 'active', null), 'active', false);
insert into public.incident_memberships(incident_id, user_id, role)
values (pg_temp.id('incident'), pg_temp.id('editor'), 'command_post_operator');
insert into public.teams(id, incident_id, team_number, name)
values (pg_temp.id('organic_team'), pg_temp.id('incident'), 1, 'Organic team');
insert into public.unit_personnel(id, first_name, last_name, role, department, is_active)
values
  (pg_temp.id('unit_one'), 'Unit', 'One', 'rescuer', 'team_1', true),
  (pg_temp.id('unit_two'), 'Unit', 'Two', 'rescuer', 'team_1', true),
  (pg_temp.id('unit_three'), 'Unit', 'Three', 'rescuer', 'team_1', true);
insert into public.event_personnel_status(incident_id, personnel_id, attendance_status)
values
  (pg_temp.id('incident'), pg_temp.id('unit_one'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_two'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_three'), 'present');
insert into public.incident_manual_personnel(
  id, incident_id, first_name, last_name, mobile_phone, normalized_mobile_phone, attendance_status, is_active
) values (pg_temp.id('manual_one'), pg_temp.id('incident'), 'Manual', 'One', '0500000091', '0500000091', 'present', true);

grant select, insert, update on stage_10_1b_2a_1_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);
insert into stage_10_1b_2a_1_ids(key, id) values
  ('team_one', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Team one')),
  ('team_two', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Team two')),
  ('team_empty', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Team empty')),
  ('team_equipment', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Team equipment')),
  ('other_team', public.create_incident_ad_hoc_team(pg_temp.id('other_incident'), 'Other team'))
on conflict (key) do update set id = excluded.id;

-- Teams may remain active without a commander.
select pg_temp.ok(not exists (
  select 1 from public.incident_ad_hoc_team_members
  where ad_hoc_team_id = pg_temp.id('team_empty') and is_active and operational_role = 'commander'
), 'an active team may temporarily have no commander');

create temporary table stage_10_1b_2a_1_members(key text primary key, id uuid not null);
insert into stage_10_1b_2a_1_members(key, id) values
  ('unit_one', public.add_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.id('team_one'), pg_temp.id('unit_one'), null)),
  ('manual_one', public.add_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.id('team_one'), null, pg_temp.id('manual_one'))),
  ('unit_two', public.add_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.id('team_one'), pg_temp.id('unit_two'), null));
create function pg_temp.member_id(p_key text) returns uuid language sql as $$ select id from stage_10_1b_2a_1_members where key = p_key $$;

select public.set_incident_ad_hoc_team_member_role(pg_temp.id('incident'), pg_temp.member_id('unit_one'), 'commander');
select public.set_incident_ad_hoc_team_member_role(pg_temp.id('incident'), pg_temp.member_id('unit_two'), 'deputy');
select pg_temp.ok((select operational_role = 'commander' from public.incident_ad_hoc_team_members where id = pg_temp.member_id('unit_one')), 'commander role is stored on active membership');
select pg_temp.ok((select operational_role = 'deputy' from public.incident_ad_hoc_team_members where id = pg_temp.member_id('unit_two')), 'deputy role is stored on active membership');
select public.set_incident_ad_hoc_team_member_role(pg_temp.id('incident'), pg_temp.member_id('unit_one'), 'commander');

do $$ begin
  perform pg_temp.expect_state(format('select public.set_incident_ad_hoc_team_member_role(%L,%L,''commander'')', pg_temp.id('incident'), pg_temp.member_id('unit_two')), '23505', 'second commander rejected');
  perform pg_temp.expect_state(format('select public.set_event_personnel_status(%L,%L,''unavailable'')', pg_temp.id('incident'), pg_temp.id('unit_one')), '55000', 'attendance change blocked while regular member is assigned');
  perform pg_temp.expect_state(format('select public.set_incident_manual_personnel_status(%L,%L,''unavailable'')', pg_temp.id('incident'), pg_temp.id('manual_one')), '55000', 'attendance change blocked while manual member is assigned');
  perform pg_temp.expect_state(format('update public.event_personnel_status set attendance_status = ''unavailable'' where incident_id = %L and personnel_id = %L', pg_temp.id('incident'), pg_temp.id('unit_one')), '55000', 'direct regular attendance update blocked while assigned');
  perform pg_temp.expect_state(format('update public.incident_manual_personnel set attendance_status = ''unavailable'' where id = %L and incident_id = %L', pg_temp.id('manual_one'), pg_temp.id('incident')), '55000', 'direct manual attendance update blocked while assigned');
  perform pg_temp.expect_state(format('select public.transfer_incident_ad_hoc_team_member(%L,%L,%L,''member'',null)', pg_temp.id('incident'), pg_temp.member_id('unit_one'), pg_temp.id('other_team')), 'P0002', 'cross-incident target rejected');
end $$;

insert into stage_10_1b_2a_1_members(key, id)
values ('unit_one_transferred', public.transfer_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_one'), pg_temp.id('team_two')));
select pg_temp.ok((select not is_active from public.incident_ad_hoc_team_members where id = pg_temp.member_id('unit_one')), 'regular source membership remains historical after transfer');
select pg_temp.ok((select is_active and ad_hoc_team_id = pg_temp.id('team_two') and operational_role = 'member' from public.incident_ad_hoc_team_members where id = pg_temp.member_id('unit_one_transferred')), 'regular member reaches target team as member');
select pg_temp.ok(public.transfer_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_one'), pg_temp.id('team_two')) = pg_temp.member_id('unit_one_transferred'), 'repeated transfer is idempotent');

insert into stage_10_1b_2a_1_members(key, id)
values ('manual_one_transferred', public.transfer_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('manual_one'), pg_temp.id('team_two')));
select pg_temp.ok((select is_active from public.incident_ad_hoc_team_members where id = pg_temp.member_id('manual_one_transferred')), 'manual member transfers atomically');

select public.return_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_one_transferred'));
select pg_temp.ok(not exists (select 1 from public.incident_ad_hoc_team_members where incident_id = pg_temp.id('incident') and unit_personnel_id = pg_temp.id('unit_one') and is_active), 'returned regular personnel has no active ad-hoc assignment');
select pg_temp.ok((select attendance_status = 'present' from public.event_personnel_status where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one')), 'returned regular personnel remains present');
update public.event_personnel_status set attendance_status = 'unavailable'
where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one');
select pg_temp.ok((select attendance_status = 'unavailable' from public.event_personnel_status where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one')), 'authorized direct attendance update succeeds after regular return');
select public.return_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_one_transferred'));

select public.return_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('manual_one_transferred'));
select pg_temp.ok((select attendance_status = 'present' and is_active from public.incident_manual_personnel where id = pg_temp.id('manual_one')), 'returned manual personnel remains present and active');
select pg_temp.ok(not exists (select 1 from public.incident_ad_hoc_team_members where incident_id = pg_temp.id('incident') and manual_personnel_id = pg_temp.id('manual_one') and is_active), 'returned manual personnel is in the unassigned incident pool');
update public.incident_manual_personnel set attendance_status = 'unavailable'
where id = pg_temp.id('manual_one') and incident_id = pg_temp.id('incident');
select pg_temp.ok((select attendance_status = 'unavailable' from public.incident_manual_personnel where id = pg_temp.id('manual_one')), 'manual attendance change succeeds after return');
select public.return_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('manual_one_transferred'));

do $$ begin
  perform pg_temp.expect_state(
    format('select public.archive_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), pg_temp.id('team_one')),
    '55000',
    'archive remains blocked while a team has an active member'
  );
end $$;

insert into stage_10_1b_2a_1_ids(key, id)
values ('equipment_type', public.create_equipment_type('Stage 10.1B.2A.1 fixture', 'Test', 3600, 300))
on conflict (key) do update set id = excluded.id;
insert into stage_10_1b_2a_1_ids(key, id)
values ('equipment_item', public.create_equipment_item(pg_temp.id('equipment_type'), 'stage-10-1b-2a-1-fixture'))
on conflict (key) do update set id = excluded.id;
select pg_temp.ok(
  public.assign_equipment(
    pg_temp.id('incident'), pg_temp.id('equipment_item'), gen_random_uuid(), null,
    pg_temp.id('team_equipment'), null, null
  ) ? 'assignment_id',
  'equipment fixture creates an open ad-hoc-team assignment'
);
do $$ begin
  perform pg_temp.expect_state(
    format('select public.archive_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), pg_temp.id('team_equipment')),
    '55000',
    'equipment archive protection remains active'
  );
end $$;

-- A system commander need not be appointed as this incident's commander to manage ad-hoc assignments.
select set_config('request.jwt.claim.sub', pg_temp.id('commander')::text, true);
select public.set_incident_ad_hoc_team_member_role(pg_temp.id('incident'), pg_temp.member_id('unit_two'), 'member');
select pg_temp.ok((select operational_role = 'member' from public.incident_ad_hoc_team_members where id = pg_temp.member_id('unit_two')), 'authorized commander can manage an ad-hoc role');
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);

-- Fixture an invalid historical state as database owner: role changes must not elevate an absent member.
reset role;
update public.event_personnel_status set attendance_status = 'unavailable'
where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_three');
insert into public.incident_ad_hoc_team_members(incident_id, ad_hoc_team_id, unit_personnel_id, operational_role)
values (pg_temp.id('incident'), pg_temp.id('team_empty'), pg_temp.id('unit_three'), 'member');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);
do $$ begin
  perform pg_temp.expect_state(
    format('select public.set_incident_ad_hoc_team_member_role(%L,(select id from public.incident_ad_hoc_team_members where incident_id = %L and unit_personnel_id = %L and is_active),''commander'')', pg_temp.id('incident'), pg_temp.id('incident'), pg_temp.id('unit_three')),
    '55000',
    'role change rejected for an active membership whose personnel is not present'
  );
end $$;

reset role;
select pg_temp.ok((select count(*) from public.event_logs where incident_id = pg_temp.id('incident') and log_type = 'incident_ad_hoc_member_transferred') = 2, 'one transfer audit event per successful transfer');
select pg_temp.ok((select count(*) from public.event_logs where incident_id = pg_temp.id('incident') and log_type = 'incident_ad_hoc_member_returned') = 2, 'idempotent returns do not duplicate audit events');
select pg_temp.ok((select count(*) from public.event_logs where incident_id = pg_temp.id('incident') and log_type = 'incident_ad_hoc_member_role_changed' and metadata->>'member_id' = pg_temp.member_id('unit_one')::text) = 1, 'repeated identical role assignment does not duplicate audit');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);
select public.remove_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_two'));
select public.remove_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.member_id('unit_two'));
reset role;
select pg_temp.ok((select count(*) from public.event_logs where incident_id = pg_temp.id('incident') and log_type = 'incident_ad_hoc_team_member_removed' and metadata->>'member_id' = pg_temp.member_id('unit_two')::text) = 1, 'legacy remove is idempotent and writes its legacy event type once');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('editor')::text, true);
do $$ begin
  perform pg_temp.expect_state(format('select public.set_incident_ad_hoc_team_member_role(%L,%L,''member'')', pg_temp.id('incident'), pg_temp.member_id('unit_two')), '42501', 'editor cannot manage ad-hoc role');
  perform pg_temp.expect_state(format('select public.transfer_incident_ad_hoc_team_member(%L,%L,%L)', pg_temp.id('incident'), pg_temp.member_id('unit_two'), pg_temp.id('team_two')), '42501', 'editor cannot transfer ad-hoc member');
end $$;

reset role;
rollback;
