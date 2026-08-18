-- Phase 3 corrective RPC: clone an arrived vehicle roster for a linked next destination.
-- This migration is additive and does not modify the applied Phase 2 migration.

create or replace function public.clone_incident_vehicle_roster_for_next_destination(
  p_incident_id uuid,
  p_source_roster_id uuid,
  p_planned_departure_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.incident_vehicle_rosters%rowtype;
  v_root_id uuid;
  v_suffix integer;
  v_clone_id uuid;
  v_display text;
begin
  perform public.assert_edit_personnel(p_incident_id);
  perform pg_advisory_xact_lock(hashtext('incident_vehicle_rosters:' || p_incident_id::text));

  select * into v_source
  from public.incident_vehicle_rosters
  where id = p_source_roster_id
    and incident_id = p_incident_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_found');
  end if;

  if v_source.status <> 'arrived' then
    return jsonb_build_object('success', false, 'code', 'source_roster_not_arrived');
  end if;

  if nullif(btrim(coalesce(v_source.destination_text, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'source_roster_missing_destination');
  end if;

  v_root_id := coalesce(v_source.root_roster_id, v_source.id);

  select coalesce(max(clone_suffix_index), 0) + 1 into v_suffix
  from public.incident_vehicle_rosters
  where incident_id = p_incident_id
    and (id = v_root_id or root_roster_id = v_root_id);

  insert into public.incident_vehicle_rosters (
    incident_id,
    main_sequence,
    clone_suffix_index,
    root_roster_id,
    source_roster_id,
    status,
    movement_type,
    origin_text,
    destination_text,
    origin_site_id,
    destination_site_id,
    planned_departure_at,
    vehicle_license_plate,
    normalized_license_plate,
    vehicle_description,
    vehicle_type,
    vehicle_notes,
    operational_notes,
    created_by,
    updated_by
  )
  values (
    p_incident_id,
    v_source.main_sequence,
    v_suffix,
    v_root_id,
    p_source_roster_id,
    'draft',
    'between_sites',
    v_source.destination_text,
    null,
    v_source.destination_site_id,
    null,
    null,
    v_source.vehicle_license_plate,
    v_source.normalized_license_plate,
    v_source.vehicle_description,
    v_source.vehicle_type,
    v_source.vehicle_notes,
    null,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_clone_id;

  insert into public.incident_roster_participants (
    incident_id,
    roster_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    added_by,
    updated_by
  )
  select
    incident_id,
    v_clone_id,
    source_type,
    unit_personnel_id,
    manual_personnel_id,
    external_person_id,
    participant_key,
    display_name_snapshot,
    normalized_mobile_phone,
    is_driver,
    is_movement_commander,
    is_passenger,
    notes,
    public.current_actor_id(),
    public.current_actor_id()
  from public.incident_roster_participants
  where roster_id = p_source_roster_id;

  v_display := public.incident_roster_display_number(v_source.main_sequence, v_suffix);

  perform public.log_incident_roster_event_internal(
    p_incident_id,
    v_clone_id,
    'incident_vehicle_roster_next_destination_cloned',
    'שבצ"ק המשך נוצר',
    'נוצר שבצ"ק המשך ' || v_display || ' על בסיס ' || public.incident_roster_display_number(v_source.main_sequence, v_source.clone_suffix_index) || '.',
    'important',
    jsonb_build_object(
      'display_number', v_display,
      'source_roster_id', p_source_roster_id,
      'root_roster_id', v_root_id,
      'clone_mode', 'next_destination'
    )
  );

  return jsonb_build_object(
    'success', true,
    'roster_id', v_clone_id,
    'display_number', v_display,
    'source_roster_id', p_source_roster_id,
    'root_roster_id', v_root_id,
    'clone_mode', 'next_destination'
  );
end;
$$;

revoke all on function public.clone_incident_vehicle_roster_for_next_destination(uuid, uuid, timestamptz) from public;
grant execute on function public.clone_incident_vehicle_roster_for_next_destination(uuid, uuid, timestamptz) to authenticated;
