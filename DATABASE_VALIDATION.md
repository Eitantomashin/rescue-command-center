# Database Validation

Run these checks against the local Supabase database after `supabase db reset`.

Most checks should return zero missing rows or a `pass` result. The write-blocking checks intentionally attempt blocked operations inside rolled-back transactions.

## 1. All Tables Exist

Expected result: no rows.

```sql
with expected_tables(table_name) as (
  values
    ('profiles'),
    ('status_types'),
    ('incidents'),
    ('incident_memberships'),
    ('sites'),
    ('floors'),
    ('units'),
    ('unit_residents'),
    ('persons'),
    ('teams'),
    ('team_site_assignments'),
    ('person_status_history'),
    ('person_merges'),
    ('event_logs')
)
select table_name as missing_table
from expected_tables
where not exists (
  select 1
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and information_schema.tables.table_name = expected_tables.table_name
);
```

## 2. Seed Statuses Exist

Expected result: no rows.

```sql
with expected_statuses(category, status_key) as (
  values
    ('incident', 'active'),
    ('incident', 'closed'),
    ('site', 'created'),
    ('site', 'mobilization'),
    ('site', 'active_operations'),
    ('site', 'search_operations'),
    ('site', 'rescue_operations'),
    ('site', 'completed'),
    ('site', 'closed'),
    ('floor', 'active'),
    ('floor', 'inactive'),
    ('unit', 'unknown'),
    ('unit', 'partially_verified'),
    ('unit', 'active_investigation'),
    ('unit', 'fully_cleared'),
    ('unit', 'inactive'),
    ('resident', 'unknown'),
    ('resident', 'linked_to_person'),
    ('resident', 'accounted_for'),
    ('person', 'missing'),
    ('person', 'trapped_located_not_yet_rescued'),
    ('person', 'injured_evacuated_to_ccp'),
    ('person', 'injured_evacuated_from_site'),
    ('person', 'fatality_evacuated'),
    ('person', 'located_outside_site'),
    ('person', 'general'),
    ('person', 'duplicate_cancelled'),
    ('team', 'available'),
    ('team', 'assigned'),
    ('team', 'en_route'),
    ('team', 'operating'),
    ('team', 'resting'),
    ('team', 'released'),
    ('log', 'operational'),
    ('log', 'administrative'),
    ('log', 'correction')
)
select category, status_key
from expected_statuses
where not exists (
  select 1
  from public.status_types st
  where st.incident_id is null
    and st.category = expected_statuses.category
    and st.status_key = expected_statuses.status_key
    and st.is_active = true
);
```

Optional count check. Expected result: 36.

```sql
select count(*) as global_status_count
from public.status_types
where incident_id is null;
```

## 3. Functions Exist

Expected result: no rows.

```sql
with expected_functions(function_name) as (
  values
    ('set_updated_at'),
    ('prevent_update_or_delete'),
    ('prevent_delete'),
    ('current_user_role'),
    ('current_user_incident_role'),
    ('can_read_incident'),
    ('can_write_incident'),
    ('can_command_incident'),
    ('can_correct_closed_incident'),
    ('assert_incident_writable'),
    ('create_event_log'),
    ('create_authorized_correction_event_log'),
    ('close_incident'),
    ('next_operational_number'),
    ('get_status_id'),
    ('has_open_persons_in_unit'),
    ('set_unit_clearance'),
    ('set_floor_unit_count'),
    ('update_person_status'),
    ('internal_write_allowed'),
    ('validate_floor_consistency'),
    ('validate_unit_consistency'),
    ('validate_person_location_consistency'),
    ('validate_unit_resident_consistency'),
    ('validate_team_assignment_consistency'),
    ('guard_site_structure_write'),
    ('guard_floor_structure_write'),
    ('guard_unit_operational_write'),
    ('guard_person_operational_write'),
    ('guard_internal_event_log_insert'),
    ('guard_internal_status_history_insert'),
    ('guard_internal_person_merge_insert'),
    ('create_site_with_structure'),
    ('reassign_person'),
    ('merge_persons')
)
select function_name as missing_function
from expected_functions
where not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = expected_functions.function_name
);
```

## 4. Triggers Exist

Expected result: no rows.

```sql
with expected_triggers(trigger_name) as (
  values
    ('profiles_set_updated_at'),
    ('status_types_set_updated_at'),
    ('incidents_set_updated_at'),
    ('sites_set_updated_at'),
    ('floors_set_updated_at'),
    ('units_set_updated_at'),
    ('unit_residents_set_updated_at'),
    ('persons_set_updated_at'),
    ('teams_set_updated_at'),
    ('team_site_assignments_set_updated_at'),
    ('status_types_prevent_delete'),
    ('incidents_prevent_delete'),
    ('sites_prevent_delete'),
    ('floors_prevent_delete'),
    ('units_prevent_delete'),
    ('unit_residents_prevent_delete'),
    ('persons_prevent_delete'),
    ('teams_prevent_delete'),
    ('team_site_assignments_prevent_delete'),
    ('event_logs_immutable'),
    ('person_status_history_immutable'),
    ('person_merges_immutable'),
    ('floors_validate_consistency'),
    ('units_validate_consistency'),
    ('persons_validate_location_consistency'),
    ('unit_residents_validate_consistency'),
    ('team_site_assignments_validate_consistency'),
    ('sites_guard_structure_write'),
    ('floors_guard_structure_write'),
    ('units_guard_operational_write'),
    ('persons_guard_operational_write'),
    ('event_logs_guard_insert'),
    ('person_status_history_guard_insert'),
    ('person_merges_guard_insert')
)
select trigger_name as missing_trigger
from expected_triggers
where not exists (
  select 1
  from information_schema.triggers t
  where t.trigger_schema = 'public'
    and t.trigger_name = expected_triggers.trigger_name
);
```

## 5. RLS Is Enabled

Expected result: no rows.

```sql
with expected_rls_tables(table_name) as (
  values
    ('profiles'),
    ('status_types'),
    ('incidents'),
    ('incident_memberships'),
    ('sites'),
    ('floors'),
    ('units'),
    ('unit_residents'),
    ('persons'),
    ('teams'),
    ('team_site_assignments'),
    ('person_status_history'),
    ('person_merges'),
    ('event_logs')
)
select table_name as rls_not_enabled
from expected_rls_tables
where not exists (
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = expected_rls_tables.table_name
    and c.relrowsecurity = true
);
```

Policy count by table. Expected result: each listed table should have at least one policy.

```sql
select
  schemaname,
  tablename,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by schemaname, tablename
order by tablename;
```

## 6. Dashboard Views Work

Expected result: all queries return successfully. Empty result sets are acceptable before incident test data exists.

```sql
select *
from public.person_status_counts
limit 10;

select *
from public.incident_dashboard_summary
limit 10;

select *
from public.site_dashboard_summary
limit 10;

select *
from public.recent_event_logs
limit 10;
```

Confirm the views exist. Expected result: no rows.

```sql
with expected_views(view_name) as (
  values
    ('person_status_counts'),
    ('incident_dashboard_summary'),
    ('site_dashboard_summary'),
    ('recent_event_logs')
)
select view_name as missing_view
from expected_views
where not exists (
  select 1
  from information_schema.views
  where table_schema = 'public'
    and information_schema.views.table_name = expected_views.view_name
);
```

## 7. Event Logs Are Immutable

Expected result: `event_logs_update_blocked` and `event_logs_delete_blocked`.

```sql
do $$
declare
  v_incident_id uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
begin
  insert into public.event_logs (
    id,
    incident_id,
    log_type,
    title
  )
  values (
    v_log_id,
    v_incident_id,
    'validation',
    'Validation Event Log'
  );
exception
  when others then
    raise notice 'event_logs_insert_blocked_as_expected: %', sqlerrm;
end $$;
```

The direct insert check above should be blocked by the Phase 1.5 insert guard.

Use the bypass flag below only inside this transaction to create a temporary row and prove update/delete immutability. Expected notices: update and delete blocked.

```sql
begin;

insert into public.incidents (
  id,
  name,
  address,
  status_id
)
values (
  '00000000-0000-0000-0000-000000000900',
  'Validation Incident',
  'Validation Address',
  public.get_status_id('incident', 'active')
);

select set_config('rcc.allow_event_log_insert', 'on', true);

insert into public.event_logs (
  id,
  incident_id,
  log_type,
  title
)
values (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000900',
  'validation',
  'Validation Event Log'
);

do $$
begin
  update public.event_logs
  set title = 'Should Be Blocked'
  where id = '00000000-0000-0000-0000-000000000901';

  raise exception 'event_logs_update_was_not_blocked';
exception
  when raise_exception then
    if sqlerrm = 'event_logs_update_was_not_blocked' then
      raise;
    end if;

    raise notice 'event_logs_update_blocked: %', sqlerrm;
end $$;

do $$
begin
  delete from public.event_logs
  where id = '00000000-0000-0000-0000-000000000901';

  raise exception 'event_logs_delete_was_not_blocked';
exception
  when raise_exception then
    if sqlerrm = 'event_logs_delete_was_not_blocked' then
      raise;
    end if;

    raise notice 'event_logs_delete_blocked: %', sqlerrm;
end $$;

rollback;
```

## 8. Direct Writes Are Blocked Where Required

These checks prove direct writes are blocked for tables that must be changed through approved database functions.

Expected notices:

- `sites_direct_insert_blocked`
- `floors_direct_insert_blocked`
- `units_direct_insert_blocked`
- `event_logs_direct_insert_blocked`
- `person_status_history_direct_insert_blocked`
- `person_merges_direct_insert_blocked`

```sql
do $$
begin
  insert into public.sites (
    incident_id,
    site_number,
    street,
    house_number,
    floors_count,
    default_units_per_floor,
    status_id
  )
  values (
    gen_random_uuid(),
    999,
    'Validation Street',
    '1',
    0,
    0,
    gen_random_uuid()
  );

  raise exception 'sites_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'sites_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'sites_direct_insert_blocked: %', sqlerrm;
end $$;

do $$
begin
  insert into public.floors (
    incident_id,
    site_id,
    floor_number
  )
  values (
    gen_random_uuid(),
    gen_random_uuid(),
    1
  );

  raise exception 'floors_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'floors_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'floors_direct_insert_blocked: %', sqlerrm;
end $$;

do $$
begin
  insert into public.units (
    incident_id,
    site_id,
    floor_id,
    unit_number
  )
  values (
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    '999'
  );

  raise exception 'units_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'units_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'units_direct_insert_blocked: %', sqlerrm;
end $$;

do $$
begin
  insert into public.event_logs (
    incident_id,
    log_type,
    title
  )
  values (
    gen_random_uuid(),
    'validation',
    'Direct Insert Should Fail'
  );

  raise exception 'event_logs_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'event_logs_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'event_logs_direct_insert_blocked: %', sqlerrm;
end $$;

do $$
begin
  insert into public.person_status_history (
    person_id,
    incident_id,
    new_status_id
  )
  values (
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid()
  );

  raise exception 'person_status_history_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'person_status_history_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'person_status_history_direct_insert_blocked: %', sqlerrm;
end $$;

do $$
begin
  insert into public.person_merges (
    incident_id,
    primary_person_id,
    merged_person_id,
    primary_operational_number,
    merged_operational_number,
    reason
  )
  values (
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    1,
    2,
    'Validation'
  );

  raise exception 'person_merges_direct_insert_was_not_blocked';
exception
  when others then
    if sqlerrm = 'person_merges_direct_insert_was_not_blocked' then
      raise;
    end if;

    raise notice 'person_merges_direct_insert_blocked: %', sqlerrm;
end $$;
```

## 9. Direct Deletes Are Blocked

Expected result: every listed trigger exists and uses `prevent_delete` or `prevent_update_or_delete`.

```sql
select
  event_object_table,
  trigger_name,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and (
    trigger_name like '%prevent_delete'
    or trigger_name in (
      'event_logs_immutable',
      'person_status_history_immutable',
      'person_merges_immutable'
    )
  )
order by event_object_table, trigger_name;
```
