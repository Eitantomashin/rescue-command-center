-- Stage 8. Only scoped invalidations are published, never catalog or deliveries.
begin;

create table public.equipment_incident_signals (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  assignment_id uuid,
  equipment_item_id uuid,
  event_type text not null check (event_type in ('assignment','cycle','alert','catalog','presentation','lifecycle')),
  created_at timestamptz not null default clock_timestamp()
);
create index equipment_signals_incident on public.equipment_incident_signals(incident_id,id);
alter table public.equipment_incident_signals enable row level security;
create policy equipment_signals_read on public.equipment_incident_signals for select to authenticated
  using (public.can_read_equipment_incident(incident_id));
revoke all on public.equipment_incident_signals from public,anon,authenticated,service_role;
revoke all on sequence public.equipment_incident_signals_id_seq from public,anon,authenticated,service_role;
grant select on public.equipment_incident_signals to authenticated;

create function public.emit_equipment_incident_signal()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name='incident_equipment_assignments' then
    insert into public.equipment_incident_signals(incident_id,assignment_id,equipment_item_id,event_type)
      values(new.incident_id,new.id,new.equipment_item_id,'assignment');
  elsif tg_table_name='equipment_cycles' then
    insert into public.equipment_incident_signals(incident_id,assignment_id,event_type)
      values(new.incident_id,new.assignment_id,'cycle');
  elsif tg_table_name='equipment_cycle_alerts' then
    insert into public.equipment_incident_signals(incident_id,assignment_id,event_type)
      values(new.incident_id,new.assignment_id,'alert');
  elsif tg_table_name='equipment_alert_deliveries' then
    -- No token, user identity or personal schedule enters the publication.
    if tg_op='UPDATE' and (new.presentation_token is distinct from old.presentation_token
      or new.dismissed_at is distinct from old.dismissed_at) then
      insert into public.equipment_incident_signals(incident_id,event_type) values(new.incident_id,'presentation');
    end if;
  elsif tg_table_name='equipment_items' then
    if (new.is_active,new.serviceability,new.serial_number,new.equipment_type_id)
      is distinct from (old.is_active,old.serviceability,old.serial_number,old.equipment_type_id) then
      insert into public.equipment_incident_signals(incident_id,assignment_id,equipment_item_id,event_type)
        select incident_id,id,equipment_item_id,'catalog' from public.incident_equipment_assignments
        where equipment_item_id=new.id and released_at is null;
    end if;
  elsif tg_table_name='equipment_types' then
    if new.is_active is distinct from old.is_active then
      insert into public.equipment_incident_signals(incident_id,assignment_id,equipment_item_id,event_type)
        select a.incident_id,a.id,a.equipment_item_id,'catalog' from public.incident_equipment_assignments a
        join public.equipment_items i on i.id=a.equipment_item_id
        where i.equipment_type_id=new.id and a.released_at is null;
    end if;
  elsif tg_table_name='incidents' then
    if (new.lifecycle_status,new.is_closed,new.archived_at) is distinct from (old.lifecycle_status,old.is_closed,old.archived_at) then
      insert into public.equipment_incident_signals(incident_id,event_type) values(new.id,'lifecycle');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.emit_equipment_incident_signal() from public,anon,authenticated,service_role;
create trigger equipment_assignment_signal after insert or update on public.incident_equipment_assignments
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_cycle_signal after insert or update on public.equipment_cycles
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_alert_signal after insert or update on public.equipment_cycle_alerts
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_presentation_signal after update on public.equipment_alert_deliveries
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_item_signal after update on public.equipment_items
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_type_signal after update on public.equipment_types
  for each row execute function public.emit_equipment_incident_signal();
create trigger equipment_lifecycle_signal after update on public.incidents
  for each row execute function public.emit_equipment_incident_signal();

do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='equipment_incident_signals') then
    alter publication supabase_realtime add table public.equipment_incident_signals;
  end if;
end $$;

-- Additive read fields only; stage 5 detection, claim, ack and dismiss unchanged.
create or replace function public.equipment_active_alert_state(p_incident_id uuid,p_now timestamptz)
returns table(alert_id uuid,severity text,details jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select al.id,case when (s.state->>'remaining_seconds')::numeric<=0 then 'critical' else 'warning' end,
    s.state || jsonb_build_object('alert_id',al.id,'warning_reached_at',al.warning_reached_at,
      'exhausted_at',al.exhausted_at,'detected_at',al.detected_at,'serial_number',i.serial_number,
      'severity',case when (s.state->>'remaining_seconds')::numeric<=0 then 'critical' else 'warning' end,
      'team_name',case when a.team_id is not null then coalesce(t.name,'צוות ' || t.team_number::text) else h.name end)
  from public.equipment_cycle_alerts al
  join public.incident_equipment_assignments a on a.id=al.assignment_id and a.incident_id=al.incident_id
  join public.equipment_cycles c on c.id=al.cycle_id
  join public.equipment_items i on i.id=a.equipment_item_id
  left join public.teams t on t.id=a.team_id
  left join public.incident_ad_hoc_teams h on h.id=a.ad_hoc_team_id
  cross join lateral (select public.equipment_clock_snapshot(a,c,p_now) as state) s
  where al.incident_id=p_incident_id and al.resolved_at is null and a.released_at is null
    and c.ended_at is null and c.first_started_at is not null
$$;

create or replace function public.sync_equipment_alerts(p_incident_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_now timestamptz; v_alerts jsonb; v_presentations jsonb; v_actor uuid;
begin
  v_actor:=public.assert_equipment_incident_operation(p_incident_id,false);
  v_now:=clock_timestamp();
  perform public.sync_equipment_alerts_internal(p_incident_id,v_now);
  select coalesce(jsonb_agg(details order by alert_id),'[]'::jsonb) into v_alerts
    from public.equipment_active_alert_state(p_incident_id,v_now);
  -- Private to auth.uid(); lets a screen discard a superseded/expired token.
  -- Reading does not renew a lease, acknowledge, snooze or move next_due_at.
  select coalesce(jsonb_agg(jsonb_build_object('alert_id',d.alert_id,
    'presentation_token',d.presentation_token,'lease_until',d.lease_until,
    'presentation_acknowledged',d.presentation_acknowledged,'next_due_at',d.next_due_at,
    'dismissed_at',d.dismissed_at,'claimed_severity',d.claimed_severity) order by d.alert_id),'[]'::jsonb)
    into v_presentations from public.equipment_alert_deliveries d
    join public.equipment_cycle_alerts a on a.id=d.alert_id and a.incident_id=d.incident_id
    where d.incident_id=p_incident_id and d.user_id=v_actor and a.resolved_at is null;
  return jsonb_build_object('server_now',v_now,'alerts',v_alerts,'presentations',v_presentations);
end;
$$;
revoke all on function public.equipment_active_alert_state(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_equipment_alerts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sync_equipment_alerts(uuid) to authenticated;
commit;
