-- Two psql connections; DISPOSABLE LOCAL DB ONLY. This suite COMMITS fixtures.
-- Never use operational data. Do not reset any database. ON_ERROR_STOP required.
-- Before each case create a FRESH incident with exactly one open assignment,
-- started cycle beyond the warning threshold, no alerts/deliveries, and active
-- authorized actors. Backdate only disposable fixture timestamps as owner.
-- In both connections SET rcc.equipment_alert_test_database='disposable-local';
-- Set identical psql variables:
-- mode: sync | same_user | different_users | refuel_first | claim_first
-- incident_id, assignment_id, cycle_id, expected_version, actor_a, actor_b,
-- token_a, token_b, refuel_request (three distinct fresh UUIDs).
-- same_user requires actor_b=actor_a; different_users requires distinct actors.
-- A: \set side A then \i this_file
-- B: \set side B then \i this_file WHILE A holds its transaction open.
-- Once both finish: \set side VERIFY then \i this_file (as owner).
-- Repeat all five modes using fresh fixtures. No cleanup/reset is performed;
-- fixture logs remain in this disposable database for inspection.
\set ON_ERROR_STOP on
do $$ begin
  if current_setting('rcc.equipment_alert_test_database',true) is distinct from 'disposable-local'
    or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL database required';
  end if;
end $$;
select :'side'='A' as run_a, :'side'='B' as run_b, :'side'='VERIFY' as run_verify \gset
select set_config('equipment.test.mode',:'mode',false);
select set_config('equipment.test.incident',:'incident_id',false);
select set_config('equipment.test.assignment',:'assignment_id',false);
select set_config('equipment.test.cycle',:'cycle_id',false);
select set_config('equipment.test.version',:'expected_version',false);
select set_config('equipment.test.actor_a',:'actor_a',false);
select set_config('equipment.test.actor_b',:'actor_b',false);
select set_config('equipment.test.token_a',:'token_a',false);
select set_config('equipment.test.token_b',:'token_b',false);
select set_config('equipment.test.refuel',:'refuel_request',false);
select set_config('request.jwt.claims','{}',false);
do $$ begin
  if current_setting('equipment.test.mode') not in ('sync','same_user','different_users','refuel_first','claim_first')
    or current_setting('equipment.test.token_a')=current_setting('equipment.test.token_b')
    or (current_setting('equipment.test.mode')='same_user' and current_setting('equipment.test.actor_a')<>current_setting('equipment.test.actor_b'))
    or (current_setting('equipment.test.mode')='different_users' and current_setting('equipment.test.actor_a')=current_setting('equipment.test.actor_b')) then
    raise exception 'Invalid concurrency test parameters';
  end if;
end $$;
\if :run_a
begin;
do $$ begin
  if exists(select 1 from public.equipment_cycle_alerts where incident_id=current_setting('equipment.test.incident')::uuid)
    or (select count(*) from public.incident_equipment_assignments where incident_id=current_setting('equipment.test.incident')::uuid and released_at is null)<>1 then
    raise exception 'Fresh single-assignment fixture required';
  end if;
end $$;
select set_config('request.jwt.claim.sub',:'actor_a',true);
set local role authenticated;
do $$ declare result jsonb; mode text:=current_setting('equipment.test.mode');
begin
  if mode in ('sync','refuel_first') then
    result:=public.sync_equipment_alerts(current_setting('equipment.test.incident')::uuid);
  else
    result:=public.claim_equipment_alerts(current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.token_a')::uuid);
  end if;
  if jsonb_array_length(result->'alerts')<>1 then raise exception 'Fixture must produce one alert'; end if;
  if mode='refuel_first' then
    perform public.confirm_equipment_refuel(current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.assignment')::uuid,
      current_setting('equipment.test.version')::bigint,current_setting('equipment.test.refuel')::uuid);
  end if;
end $$;
\echo A holds the incident lock for 20 seconds. Run B NOW.
select pg_sleep(20);
commit;
\endif
\if :run_b
begin;
select set_config('request.jwt.claim.sub',:'actor_b',true);
set local role authenticated;
set local lock_timeout='40s';
do $$ declare started timestamptz:=clock_timestamp(); result jsonb; mode text:=current_setting('equipment.test.mode'); expected_count integer;
begin
  if mode='sync' then
    result:=public.sync_equipment_alerts(current_setting('equipment.test.incident')::uuid);
  elsif mode='claim_first' then
    result:=public.confirm_equipment_refuel(current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.assignment')::uuid,
      current_setting('equipment.test.version')::bigint,current_setting('equipment.test.refuel')::uuid);
  else
    result:=public.claim_equipment_alerts(current_setting('equipment.test.incident')::uuid,current_setting('equipment.test.token_b')::uuid);
  end if;
  if clock_timestamp()-started<interval '1 second' then raise exception 'No overlap: rerun with a fresh fixture while A holds locks'; end if;
  if mode<>'claim_first' then
    expected_count:=case when mode in ('same_user','refuel_first') then 0 else 1 end;
    if jsonb_array_length(result->'alerts')<>expected_count then raise exception 'Unexpected contender alert count: %',result; end if;
  elsif result->>'operation_state'<>'paused' then raise exception 'Refuel must leave the new cycle paused';
  end if;
  raise notice 'PASS: overlapping % operations serialized correctly',mode;
end $$;
commit;
\endif
\if :run_verify
begin;
do $$ declare mode text:=current_setting('equipment.test.mode'); al public.equipment_cycle_alerts; expected_deliveries integer;
begin
  if (select count(*) from public.equipment_cycle_alerts where cycle_id=current_setting('equipment.test.cycle')::uuid)<>1 then
    raise exception 'Expected one alert despite concurrent discovery';
  end if;
  select * into al from public.equipment_cycle_alerts where cycle_id=current_setting('equipment.test.cycle')::uuid;
  if (select count(*) from public.event_logs where entity_id=al.cycle_id and log_type='equipment_warning_reached')<>1
    or (select count(*) from public.event_logs where entity_id=al.cycle_id and log_type='equipment_runtime_exhausted')<>
      case when al.exhausted_at is null then 0 else 1 end then raise exception 'Threshold logs duplicated or missing'; end if;
  if mode in ('refuel_first','claim_first') then
    if al.resolution_reason is distinct from 'refueled' or al.resolved_at is null
      or exists(select 1 from public.equipment_alert_deliveries where alert_id=al.id and
        (lease_until is not null or presentation_token is not null or next_due_at is not null or snoozed_until is not null)) then
      raise exception 'Refuel left a live alert/lease/schedule';
    end if;
  else
    expected_deliveries:=case mode when 'sync' then 0 when 'same_user' then 1 else 2 end;
    if (select count(*) from public.equipment_alert_deliveries where alert_id=al.id and presentation_token is not null)<>expected_deliveries then
      raise exception 'Unexpected delivery ownership count';
    end if;
    if mode='same_user' and not exists(select 1 from public.equipment_alert_deliveries where alert_id=al.id
      and user_id=current_setting('equipment.test.actor_a')::uuid and presentation_token=current_setting('equipment.test.token_a')::uuid) then
      raise exception 'Second tab stole the lease';
    end if;
  end if;
  raise notice 'PASS: alert uniqueness, audit uniqueness, delivery isolation and refuel cancellation';
end $$;
rollback;
\endif
