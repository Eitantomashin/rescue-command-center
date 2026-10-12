-- Stage 10.1C validation. Run only against a verified disposable local database.
-- All fixture data is enclosed in the transaction and is rolled back.

begin;

do $$
begin
  if current_setting('rcc.stage_10_1c_test_database', true) is distinct from 'disposable-local' then
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

create temporary table stage_10_1c_ids(key text primary key, id uuid not null default gen_random_uuid());
grant select, insert on stage_10_1c_ids to authenticated;
insert into stage_10_1c_ids(key) values
  ('admin'), ('commander'), ('editor'), ('incident'),
  ('incident_paused'), ('incident_closed'), ('incident_archived'),
  ('team_1'), ('team_2'), ('team_3'), ('team_4'),
  ('unit_one'), ('unit_two'), ('manual_one'), ('manual_unassigned');
create function pg_temp.id(p_key text) returns uuid language sql as $$
  select id from stage_10_1c_ids where key = p_key
$$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select set_config('rcc.sql_editor_validation_mode', 'on', true);

-- auth.users creation invokes the normal profile trigger; update that profile instead of inserting a duplicate.
insert into auth.users(id, email, raw_user_meta_data)
select id, id::text || '@stage-10-1c.invalid', '{}'::jsonb
from stage_10_1c_ids where key in ('admin', 'commander', 'editor');
update public.profiles p set role = ids.key, is_active = true, deleted_at = null
from stage_10_1c_ids ids where p.id = ids.id and ids.key in ('admin', 'commander', 'editor');

-- Fixture writes invoke the production audit triggers. Keep those triggers in
-- force and establish the existing disposable-validation actor before writing.
select set_config('rcc.test_user_id', pg_temp.id('admin')::text, true);

insert into public.incidents(id, name, address, status_id, lifecycle_status, is_closed)
values (
  pg_temp.id('incident'), 'Stage 10.1C', 'Test',
  public.get_status_id('incident', 'active', null), 'active', false
);
insert into public.incidents(id, name, address, status_id, lifecycle_status, is_closed, ended_at, archived_at)
values
  (pg_temp.id('incident_paused'), 'Stage 10.1C Paused', 'Test', public.get_status_id('incident', 'active', null), 'paused', false, null, null),
  (pg_temp.id('incident_closed'), 'Stage 10.1C Closed', 'Test', public.get_status_id('incident', 'active', null), 'closed', true, now(), null),
  (pg_temp.id('incident_archived'), 'Stage 10.1C Archived', 'Test', public.get_status_id('incident', 'active', null), 'active', false, null, now());
insert into public.teams(id, incident_id, team_number, name, is_active)
values
  (pg_temp.id('team_1'), pg_temp.id('incident'), 1, 'צוות 1', true),
  (pg_temp.id('team_2'), pg_temp.id('incident'), 2, 'צוות 2', true),
  (pg_temp.id('team_3'), pg_temp.id('incident'), 3, 'צוות 3', true),
  (pg_temp.id('team_4'), pg_temp.id('incident'), 4, 'צוות 4', false);
insert into public.unit_personnel(id, first_name, last_name, role, department, is_active)
values
  (pg_temp.id('unit_one'), 'Regular', 'One', 'rescuer', 'team_1', true),
  (pg_temp.id('unit_two'), 'Regular', 'Two', 'rescuer', 'team_1', true);
insert into public.event_personnel_status(incident_id, personnel_id, attendance_status)
values
  (pg_temp.id('incident'), pg_temp.id('unit_one'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_two'), 'unavailable');
insert into public.incident_manual_personnel(
  id, incident_id, first_name, last_name, mobile_phone, normalized_mobile_phone,
  organic_team_id, attendance_status, is_active
) values (
  pg_temp.id('manual_one'), pg_temp.id('incident'), 'Manual', 'One', '0500000101', '0500000101',
  pg_temp.id('team_1'), 'present', true
);
insert into public.incident_manual_personnel(
  id, incident_id, first_name, last_name, mobile_phone, normalized_mobile_phone,
  organic_team_id, attendance_status, is_active
) values (
  pg_temp.id('manual_unassigned'), pg_temp.id('incident'), 'Manual', 'Unassigned', '0500000102', '0500000102',
  null, 'present', true
);

-- The snapshot guard is database-level integrity, independent of RPC-only
-- client permissions. This attempted privileged fixture write must fail.
do $$ begin
  perform pg_temp.expect_state(
    format($sql$insert into public.incident_organic_team_reinforcements(
      incident_id, unit_personnel_id, source_team_id, source_team_number,
      destination_team_id, destination_team_number
    ) values (%L, %L, %L, 2, %L, 2)$sql$,
      pg_temp.id('incident'), pg_temp.id('unit_two'), pg_temp.id('team_1'), pg_temp.id('team_2')),
    '23514', 'team-number snapshot must match the referenced source team'
  );
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);

insert into stage_10_1c_ids(key, id)
values ('reinforcement_one', public.assign_incident_organic_team_reinforcement(
  pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_one'), null, 'תגבור ראשוני'
));
select pg_temp.ok((
  select is_active and source_team_id = pg_temp.id('team_1') and source_team_number = 1
    and destination_team_id = pg_temp.id('team_2') and destination_team_number = 2
  from public.incident_organic_team_reinforcements where id = pg_temp.id('reinforcement_one')
), 'regular rescuer is reinforced from team 1 to team 2 without changing organic affiliation');
select pg_temp.ok((select department = 'team_1' from public.unit_personnel where id = pg_temp.id('unit_one')),
  'regular organic department remains team_1');

do $$
declare v_log_count integer;
begin
  select count(*) into v_log_count from public.event_logs
  where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_assigned';
  perform pg_temp.ok(
    public.assign_incident_organic_team_reinforcement(pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_one')) = pg_temp.id('reinforcement_one'),
    'same reinforcement assignment is idempotent'
  );
  perform pg_temp.ok((select count(*) from public.event_logs
    where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_assigned') = v_log_count,
    'idempotent reinforcement assignment does not create a duplicate log');
end $$;
do $$ begin
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('team_3'), pg_temp.id('unit_one')),
    '23505', 'second active organic reinforcement is rejected'
  );
  perform pg_temp.expect_state(
    format('select public.set_event_personnel_status(%L,%L,''unavailable'')', pg_temp.id('incident'), pg_temp.id('unit_one')),
    '55000', 'attendance change is rejected while regular reinforcement is active'
  );
  perform pg_temp.expect_state(
    format('update public.event_personnel_status set attendance_status=''unavailable'' where incident_id=%L and personnel_id=%L', pg_temp.id('incident'), pg_temp.id('unit_one')),
    '55000', 'direct regular attendance update is rejected while reinforcement is active'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_two')),
    '55000', 'non-present regular rescuer cannot be reinforced'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,null,%L)', pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('manual_unassigned')),
    'P0002', 'manual personnel without an organic rescue team cannot be reinforced'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('team_4'), pg_temp.id('unit_one')),
    'P0002', 'inactive target team is rejected'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident_paused'), pg_temp.id('team_2'), pg_temp.id('unit_one')),
    '55000', 'paused incident is rejected'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident_closed'), pg_temp.id('team_2'), pg_temp.id('unit_one')),
    '55000', 'closed incident is rejected'
  );
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident_archived'), pg_temp.id('team_2'), pg_temp.id('unit_one')),
    '42501', 'archived incident is rejected'
  );
end $$;

insert into stage_10_1c_ids(key, id)
values ('reinforcement_two', public.transfer_incident_organic_team_reinforcement(
  pg_temp.id('incident'), pg_temp.id('reinforcement_one'), pg_temp.id('team_3'), 'העברה ישירה'
));
select pg_temp.ok((
  select not is_active from public.incident_organic_team_reinforcements where id = pg_temp.id('reinforcement_one')
), 'source reinforcement remains historical after direct transfer');
select pg_temp.ok((
  select is_active and source_team_id = pg_temp.id('team_1') and source_team_number = 1
    and destination_team_id = pg_temp.id('team_3') and destination_team_number = 3
  from public.incident_organic_team_reinforcements where id = pg_temp.id('reinforcement_two')
), 'direct transfer reaches team 3 while preserving team 1 as origin');
do $$
declare v_log_count integer;
begin
  select count(*) into v_log_count from public.event_logs
  where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_transferred';
  perform pg_temp.ok(
    public.transfer_incident_organic_team_reinforcement(
      pg_temp.id('incident'), pg_temp.id('reinforcement_two'), pg_temp.id('team_3'), 'ניסיון חוזר'
    ) = pg_temp.id('reinforcement_two'),
    'same reinforcement transfer target is idempotent'
  );
  perform pg_temp.ok((select count(*) from public.event_logs
    where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_transferred') = v_log_count,
    'idempotent reinforcement transfer does not create a duplicate log');
end $$;

select public.return_incident_organic_team_reinforcement(pg_temp.id('incident'), pg_temp.id('reinforcement_two'), 'סיום תגבור');
select pg_temp.ok(not exists (
  select 1 from public.incident_organic_team_reinforcements
  where incident_id = pg_temp.id('incident') and unit_personnel_id = pg_temp.id('unit_one') and is_active
), 'return closes the active reinforcement without changing attendance or organic affiliation');
select pg_temp.ok((select attendance_status = 'present' from public.event_personnel_status
  where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one')),
  'returned regular rescuer remains present');
do $$
declare v_log_count integer;
begin
  select count(*) into v_log_count from public.event_logs
  where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_returned';
  perform public.return_incident_organic_team_reinforcement(pg_temp.id('incident'), pg_temp.id('reinforcement_two'), 'חזרה חוזרת');
  perform pg_temp.ok((select count(*) from public.event_logs
    where incident_id = pg_temp.id('incident') and log_type = 'incident_organic_team_reinforcement_returned') = v_log_count,
    'repeated reinforcement return is idempotent and does not create a duplicate log');
  update public.event_personnel_status set attendance_status = 'unavailable'
  where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one');
  perform pg_temp.ok((select attendance_status = 'unavailable' from public.event_personnel_status
    where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one')),
    'direct regular attendance update succeeds after return');
  update public.event_personnel_status set attendance_status = 'present'
  where incident_id = pg_temp.id('incident') and personnel_id = pg_temp.id('unit_one');
end $$;

insert into stage_10_1c_ids(key, id)
values ('manual_reinforcement', public.assign_incident_organic_team_reinforcement(
  pg_temp.id('incident'), pg_temp.id('team_2'), null, pg_temp.id('manual_one'), null
));
select pg_temp.ok((
  select is_active and source_team_id = pg_temp.id('team_1') and destination_team_id = pg_temp.id('team_2')
  from public.incident_organic_team_reinforcements where id = pg_temp.id('manual_reinforcement')
), 'manual personnel with organic_team_id is supported');
select pg_temp.ok((select organic_team_id = pg_temp.id('team_1') from public.incident_manual_personnel where id = pg_temp.id('manual_one')),
  'manual organic_team_id remains unchanged');
do $$ begin
  perform pg_temp.expect_state(
    format('select public.set_incident_manual_personnel_status(%L,%L,''unavailable'')', pg_temp.id('incident'), pg_temp.id('manual_one')),
    '55000', 'attendance change is rejected while manual reinforcement is active'
  );
  perform pg_temp.expect_state(
    format('update public.incident_manual_personnel set attendance_status=''unavailable'' where id=%L and incident_id=%L', pg_temp.id('manual_one'), pg_temp.id('incident')),
    '55000', 'direct manual attendance update is rejected while reinforcement is active'
  );
end $$;
select public.return_incident_organic_team_reinforcement(pg_temp.id('incident'), pg_temp.id('manual_reinforcement'));
update public.incident_manual_personnel set attendance_status = 'unavailable'
where id = pg_temp.id('manual_one') and incident_id = pg_temp.id('incident');
select pg_temp.ok((select attendance_status = 'unavailable' from public.incident_manual_personnel
  where id = pg_temp.id('manual_one')),
  'direct manual attendance update succeeds after return');
update public.incident_manual_personnel set attendance_status = 'present'
where id = pg_temp.id('manual_one') and incident_id = pg_temp.id('incident');

insert into stage_10_1c_ids(key, id)
values ('ad_hoc_team', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'בדיקת התנגשות'));
insert into stage_10_1c_ids(key, id)
values ('ad_hoc_member', public.add_incident_ad_hoc_team_member(
  pg_temp.id('incident'), pg_temp.id('ad_hoc_team'), pg_temp.id('unit_one'), null
));
do $$ begin
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_one')),
    '23505', 'active ad-hoc membership blocks organic reinforcement'
  );
end $$;
select public.return_incident_ad_hoc_team_member(pg_temp.id('incident'), pg_temp.id('ad_hoc_member'));
insert into stage_10_1c_ids(key, id)
values ('reinforcement_for_reverse_conflict', public.assign_incident_organic_team_reinforcement(
  pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_one')
));
do $$ begin
  perform pg_temp.expect_state(
    format('select public.add_incident_ad_hoc_team_member(%L,%L,%L,null)', pg_temp.id('incident'), pg_temp.id('ad_hoc_team'), pg_temp.id('unit_one')),
    '23505', 'active organic reinforcement blocks ad-hoc membership'
  );
end $$;

-- Direct client writes remain unavailable even for an authorized manager; mutations are RPC-only.
do $$ begin
  perform pg_temp.expect_state(
    format($sql$insert into public.incident_organic_team_reinforcements(
      incident_id,unit_personnel_id,source_team_id,source_team_number,destination_team_id,destination_team_number
    ) values (%L,%L,%L,1,%L,2)$sql$, pg_temp.id('incident'), pg_temp.id('unit_two'), pg_temp.id('team_1'), pg_temp.id('team_2')),
    '42501', 'direct reinforcement write is blocked by privileges and RLS'
  );
end $$;

select set_config('request.jwt.claim.sub', pg_temp.id('editor')::text, true);
do $$ begin
  perform pg_temp.expect_state(
    format('select public.assign_incident_organic_team_reinforcement(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('team_2'), pg_temp.id('unit_two')),
    '42501', 'operator/editor cannot manage organic reinforcements'
  );
end $$;

select set_config('request.jwt.claim.sub', pg_temp.id('commander')::text, true);
select public.return_incident_organic_team_reinforcement(
  pg_temp.id('incident'), pg_temp.id('reinforcement_for_reverse_conflict')
);
select pg_temp.ok(true, 'system commander can return a reinforcement with incident access');

reset role;
select pg_temp.ok((select count(*) from public.event_logs where incident_id = pg_temp.id('incident')
  and log_type in ('incident_organic_team_reinforcement_assigned', 'incident_organic_team_reinforcement_transferred', 'incident_organic_team_reinforcement_returned')) >= 5,
  'assignment transfer and return are recorded in the incident log');

rollback;
