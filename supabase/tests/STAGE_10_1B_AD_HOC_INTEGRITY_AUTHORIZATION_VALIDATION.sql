-- Stage 10.1B.1 regression tests. Run only on a disposable local Supabase DB.
-- All fixtures, temporary grants, and writes are rolled back at the end.

begin;

do $$
begin
  if current_setting('rcc.stage_10_1b_test_database', true) is distinct from 'disposable-local' then
    raise exception 'Disposable local database opt-in required';
  end if;
end $$;

create function pg_temp.check_true(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void
language plpgsql
as $$
declare
  v_state text;
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

create function pg_temp.expect_error_contains(
  p_sql text,
  p_state text,
  p_message_fragment text,
  p_label text
)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text;
  end;

  if v_state is distinct from p_state
    or position(p_message_fragment in coalesce(v_message, '')) = 0
  then
    raise exception 'FAIL: %, expected % containing "%", got % / "%"',
      p_label,
      p_state,
      p_message_fragment,
      coalesce(v_state, 'success'),
      coalesce(v_message, '');
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create temporary table stage_10_1b_ids (
  key text primary key,
  id uuid not null default gen_random_uuid()
);

insert into stage_10_1b_ids(key) values
  ('admin'), ('commander'), ('editor'), ('viewer'), ('outsider'),
  ('incident'), ('other_incident'), ('organic_team'), ('ad_hoc_other'),
  ('unit_present'), ('unit_absent'), ('unit_commander_1'), ('unit_commander_2'),
  ('unit_deputy_1'), ('unit_deputy_2'), ('unit_historical'),
  ('manual_present'), ('manual_absent'), ('manual_other_incident');

create function pg_temp.id(p_key text)
returns uuid
language sql
as $$
  select id from stage_10_1b_ids where key = p_key
$$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
-- Fixture writes can invoke production audit triggers. Use the existing
-- disposable-validation actor path rather than weakening those triggers.
select set_config('rcc.sql_editor_validation_mode', 'on', true);

insert into auth.users(id, email, raw_user_meta_data)
select id, id::text || '@stage-10-1b.invalid', '{}'::jsonb
from stage_10_1b_ids
where key in ('admin', 'commander', 'editor', 'viewer', 'outsider');

delete from public.profiles where id in (
  select id from stage_10_1b_ids where key in ('admin', 'commander', 'editor', 'viewer', 'outsider')
);

insert into public.profiles(id, role, is_active, deleted_at)
select
  id,
  case when key = 'outsider' then 'viewer' else key end,
  true,
  null
from stage_10_1b_ids
where key in ('admin', 'commander', 'editor', 'viewer', 'outsider');

-- All fixture writes before an authenticated-role scenario run as postgres,
-- but audit/event-log authorization must still resolve to this active admin.
select set_config('rcc.test_user_id', pg_temp.id('admin')::text, true);

insert into public.incidents(id, name, address, status_id, lifecycle_status, is_closed)
values
  (pg_temp.id('incident'), 'Stage 10.1B incident', 'Test', public.get_status_id('incident', 'active', null), 'active', false),
  (pg_temp.id('other_incident'), 'Stage 10.1B other incident', 'Test', public.get_status_id('incident', 'active', null), 'active', false);

insert into public.incident_memberships(incident_id, user_id, role)
values
  (pg_temp.id('incident'), pg_temp.id('editor'), 'command_post_operator'),
  (pg_temp.id('incident'), pg_temp.id('viewer'), 'observer');

insert into public.teams(id, incident_id, team_number, name)
values (pg_temp.id('organic_team'), pg_temp.id('incident'), 1, 'Organic team');

insert into public.incident_ad_hoc_teams(id, incident_id, name)
values (pg_temp.id('ad_hoc_other'), pg_temp.id('other_incident'), 'Other incident ad hoc');

insert into public.unit_personnel(id, first_name, last_name, role, department, is_active)
values
  (pg_temp.id('unit_present'), 'Present', 'Member', 'rescuer', 'team_1', true),
  (pg_temp.id('unit_absent'), 'Absent', 'Member', 'rescuer', 'team_1', true),
  (pg_temp.id('unit_commander_1'), 'Commander', 'One', 'team_commander', 'team_1', true),
  (pg_temp.id('unit_commander_2'), 'Commander', 'Two', 'team_commander', 'team_1', true),
  (pg_temp.id('unit_deputy_1'), 'Deputy', 'One', 'deputy_team_commander', 'team_1', true),
  (pg_temp.id('unit_deputy_2'), 'Deputy', 'Two', 'deputy_team_commander', 'team_1', true),
  (pg_temp.id('unit_historical'), 'Historical', 'Member', 'rescuer', 'team_1', true);

insert into public.event_personnel_status(incident_id, personnel_id, attendance_status)
values
  (pg_temp.id('incident'), pg_temp.id('unit_present'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_absent'), 'unavailable'),
  (pg_temp.id('incident'), pg_temp.id('unit_commander_1'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_commander_2'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_deputy_1'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_deputy_2'), 'present'),
  (pg_temp.id('incident'), pg_temp.id('unit_historical'), 'present');

insert into public.incident_manual_personnel(
  id, incident_id, first_name, last_name, mobile_phone, normalized_mobile_phone,
  organic_team_id, attendance_status, is_active
)
values
  (pg_temp.id('manual_present'), pg_temp.id('incident'), 'Manual', 'Present', '0500000001', '0500000001', pg_temp.id('organic_team'), 'present', true),
  (pg_temp.id('manual_absent'), pg_temp.id('incident'), 'Manual', 'Absent', '0500000003', '0500000003', pg_temp.id('organic_team'), 'unavailable', true),
  (pg_temp.id('manual_other_incident'), pg_temp.id('other_incident'), 'Manual', 'Other', '0500000002', '0500000002', null, 'present', true);

grant select, insert on stage_10_1b_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);

insert into stage_10_1b_ids(key, id)
values ('ad_hoc_one', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Ad hoc one'));
insert into stage_10_1b_ids(key, id)
values ('ad_hoc_two', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Ad hoc two'));
insert into stage_10_1b_ids(key, id)
values ('ad_hoc_empty', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Ad hoc empty'));
insert into stage_10_1b_ids(key, id)
values ('ad_hoc_equipment', public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Ad hoc equipment'));

select pg_temp.check_true(
  public.add_incident_ad_hoc_team_member(
    pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_present'), null
  ) is not null,
  'admin can add a present permanent member'
);

select pg_temp.check_true(
  public.add_incident_ad_hoc_team_member(
    pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), null, pg_temp.id('manual_present')
  ) is not null,
  'admin can add a present manual member'
);

select pg_temp.check_true(
  public.add_incident_ad_hoc_team_member(
    pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_present'), null
  ) = (
    select m.id
    from public.incident_ad_hoc_team_members m
    where m.ad_hoc_team_id = pg_temp.id('ad_hoc_one')
      and m.unit_personnel_id = pg_temp.id('unit_present')
      and m.is_active
  ),
  'idempotent add returns the existing membership'
);

reset role;
select pg_temp.check_true(
  (
    select count(*)
    from public.event_logs el
    where el.incident_id = pg_temp.id('incident')
      and el.log_type = 'incident_ad_hoc_team_member_added'
      and el.metadata->>'ad_hoc_team_id' = pg_temp.id('ad_hoc_one')::text
      and el.metadata->>'unit_personnel_id' = pg_temp.id('unit_present')::text
  ) = 1,
  'idempotent add does not write a duplicate member-added event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);

select public.update_incident_ad_hoc_team(
  pg_temp.id('incident'), pg_temp.id('ad_hoc_empty'), 'Ad hoc empty updated'
);
select pg_temp.check_true(
  (select name = 'Ad hoc empty updated' from public.incident_ad_hoc_teams where id = pg_temp.id('ad_hoc_empty')),
  'admin can update an ad-hoc team'
);

select public.archive_incident_ad_hoc_team(pg_temp.id('incident'), pg_temp.id('ad_hoc_empty'));
select pg_temp.check_true(
  (select status = 'archived' from public.incident_ad_hoc_teams where id = pg_temp.id('ad_hoc_empty')),
  'admin can archive an empty ad-hoc team without equipment'
);

do $$
begin
  perform pg_temp.expect_error(
    format(
      'select public.add_incident_ad_hoc_team_member(%L,%L,%L,null)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_absent')
    ),
    '55000',
    'absent permanent personnel rejected'
  );

  perform pg_temp.expect_error(
    format(
      'select public.add_incident_ad_hoc_team_member(%L,%L,null,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('manual_absent')
    ),
    '55000',
    'absent manual personnel rejected'
  );

  perform pg_temp.expect_error(
    format(
      'select public.add_incident_ad_hoc_team_member(%L,%L,%L,null)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_two'), pg_temp.id('unit_present')
    ),
    '23505',
    'one active permanent assignment per incident'
  );

  perform pg_temp.expect_error(
    format(
      'select public.add_incident_ad_hoc_team_member(%L,%L,null,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_two'), pg_temp.id('manual_present')
    ),
    '23505',
    'one active manual assignment per incident'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id) values (%L,%L,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_two'), pg_temp.id('unit_commander_1')
    ),
    '42501',
    'direct authenticated membership write rejected'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_teams(incident_id,name) values (%L,%L)',
      pg_temp.id('incident'), 'Direct write denied'
    ),
    '42501',
    'direct authenticated ad-hoc team write rejected'
  );

  perform pg_temp.expect_error_contains(
    format('select public.archive_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), pg_temp.id('ad_hoc_one')),
    '55000',
    'active members',
    'archive with active members is rejected before archival'
  );
end;
$$;

select pg_temp.check_true(
  (select status = 'active' from public.incident_ad_hoc_teams where id = pg_temp.id('ad_hoc_one')),
  'team remains active after active-member archive rejection'
);

select set_config('request.jwt.claim.sub', pg_temp.id('commander')::text, true);
select pg_temp.check_true(
  public.create_incident_ad_hoc_team(pg_temp.id('incident'), 'Commander ad hoc') is not null,
  'commander can create an ad-hoc team without incident commander membership'
);

do $$
declare
  v_user_key text;
begin
  foreach v_user_key in array array['editor', 'viewer', 'outsider'] loop
    perform set_config('request.jwt.claim.sub', pg_temp.id(v_user_key)::text, true);
    perform pg_temp.expect_error(
      format('select public.create_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), v_user_key || ' denied'),
      '42501',
      v_user_key || ' cannot create ad-hoc teams'
    );
    perform pg_temp.expect_error(
      format('select public.add_incident_ad_hoc_team_member(%L,%L,%L,null)', pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_commander_1')),
      '42501',
      v_user_key || ' cannot add ad-hoc members'
    );
    perform pg_temp.expect_error(
      format('select public.update_incident_ad_hoc_team(%L,%L,%L)', pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), 'Denied edit'),
      '42501',
      v_user_key || ' cannot update ad-hoc teams'
    );
    perform pg_temp.expect_error(
      format('select public.remove_incident_ad_hoc_team_member(%L,%L)', pg_temp.id('incident'), gen_random_uuid()),
      '42501',
      v_user_key || ' cannot remove ad-hoc members'
    );
    perform pg_temp.expect_error(
      format('select public.archive_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), pg_temp.id('ad_hoc_one')),
      '42501',
      v_user_key || ' cannot archive ad-hoc teams'
    );
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', pg_temp.id('outsider')::text, true);
select pg_temp.check_true(
  public.can_view_incident(pg_temp.id('incident')) is false,
  'outsider cannot access the incident'
);

select set_config(
  'rcc.stage_10_1b_anonymous_call',
  format('select public.create_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), 'Anonymous denied'),
  true
);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select set_config('rcc.test_user_id', '', true);
select pg_temp.expect_error(
  current_setting('rcc.stage_10_1b_anonymous_call', true),
  '42501',
  'anonymous user cannot create an ad-hoc team'
);

reset role;
select set_config('rcc.test_user_id', pg_temp.id('admin')::text, true);

-- Constraint tests run as postgres to isolate database integrity from ACL/RLS.
do $$
begin
  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id) values (%L,%L,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_two'), pg_temp.id('unit_present')
    ),
    '23505',
    'unique active assignment index blocks direct duplicate'
  );

  insert into public.incident_ad_hoc_team_members(incident_id, ad_hoc_team_id, unit_personnel_id, operational_role)
  values (pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_commander_1'), 'commander');

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id,operational_role) values (%L,%L,%L,''deputy'')',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_commander_1')
    ),
    '23505',
    'commander and deputy must be distinct active memberships'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id,operational_role) values (%L,%L,%L,''commander'')',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_commander_2')
    ),
    '23505',
    'one active commander per ad-hoc team'
  );

  insert into public.incident_ad_hoc_team_members(incident_id, ad_hoc_team_id, unit_personnel_id, operational_role)
  values (pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_deputy_1'), 'deputy');

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id,operational_role) values (%L,%L,%L,''deputy'')',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_deputy_2')
    ),
    '23505',
    'one active deputy per ad-hoc team'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id,operational_role) values (%L,%L,%L,''invalid'')',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('unit_commander_2')
    ),
    '23514',
    'operational role check constraint'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id) values (%L,%L,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_other'), pg_temp.id('unit_commander_2')
    ),
    '23503',
    'team incident composite foreign key'
  );

  perform pg_temp.expect_error(
    format(
      'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,manual_personnel_id) values (%L,%L,%L)',
      pg_temp.id('incident'), pg_temp.id('ad_hoc_one'), pg_temp.id('manual_other_incident')
    ),
    '23503',
    'manual personnel incident composite foreign key'
  );
end;
$$;

insert into public.incident_ad_hoc_team_members(
  incident_id, ad_hoc_team_id, unit_personnel_id, is_active, added_at, removed_at
)
values (
  pg_temp.id('incident'),
  pg_temp.id('ad_hoc_two'),
  pg_temp.id('unit_historical'),
  false,
  now() - interval '1 hour',
  now()
);

select pg_temp.check_true(
  exists (
    select 1
    from public.incident_ad_hoc_team_members m
    where m.incident_id = pg_temp.id('incident')
      and m.unit_personnel_id = pg_temp.id('unit_historical')
      and not m.is_active
      and m.removed_at is not null
      and m.operational_role = 'member'
  ),
  'historical inactive membership is preserved with member default'
);

-- Re-grant inside the transaction to prove RLS still blocks direct writes.
grant insert on public.incident_ad_hoc_team_members to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, true);
select pg_temp.expect_error(
  format(
    'insert into public.incident_ad_hoc_team_members(incident_id,ad_hoc_team_id,unit_personnel_id) values (%L,%L,%L)',
    pg_temp.id('incident'), pg_temp.id('ad_hoc_two'), pg_temp.id('unit_commander_2')
  ),
  '42501',
  'RLS blocks direct membership write even with an INSERT grant'
);

insert into stage_10_1b_ids(key, id)
values ('equipment_type', public.create_equipment_type('Stage 10 fixture', 'Test', 3600, 300));
insert into stage_10_1b_ids(key, id)
values ('equipment_item', public.create_equipment_item(pg_temp.id('equipment_type'), 'stage-10-fixture'));

select pg_temp.check_true(
  public.assign_equipment(
    pg_temp.id('incident'),
    pg_temp.id('equipment_item'),
    gen_random_uuid(),
    null,
    pg_temp.id('ad_hoc_equipment'),
    null,
    null
  ) ? 'assignment_id',
  'admin creates a valid active equipment assignment for the archive guard'
);

-- Keep this assertion transport-safe: some PowerShell-to-Docker invocations
-- corrupt Hebrew literals even though the checked-in UTF-8 file is valid.
-- These fixture checks establish that the only archive guard in play is the
-- active-equipment guard, then SQLSTATE verifies its rejection.
select pg_temp.check_true(
  not exists (
    select 1
    from public.incident_ad_hoc_team_members m
    where m.ad_hoc_team_id = pg_temp.id('ad_hoc_equipment')
      and m.incident_id = pg_temp.id('incident')
      and m.is_active
  ),
  'equipment archive fixture has no active members'
);

select pg_temp.check_true(
  exists (
    select 1
    from public.incident_equipment_assignments a
    where a.incident_id = pg_temp.id('incident')
      and a.ad_hoc_team_id = pg_temp.id('ad_hoc_equipment')
      and a.released_at is null
  ),
  'equipment archive fixture has an open assignment'
);

select pg_temp.expect_error(
  format('select public.archive_incident_ad_hoc_team(%L,%L)', pg_temp.id('incident'), pg_temp.id('ad_hoc_equipment')),
  '55000',
  'equipment archive guard remains active for an empty team'
);

select pg_temp.check_true(
  (select status = 'active' from public.incident_ad_hoc_teams where id = pg_temp.id('ad_hoc_equipment')),
  'team remains active after equipment archive rejection'
);

reset role;
rollback;
