-- Search Site Phase 10: approved mobile creation of manually discovered units.
-- Search Sites only. Existing apartments are never renumbered.

create or replace function public.add_search_site_manual_unit(
  p_site_id uuid,
  p_floor_id uuid,
  p_reported_unit_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_floor public.floors%rowtype;
  v_sequence integer;
  v_unit_id uuid;
  v_notes text;
begin
  select * into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Search Site not found';
  end if;

  if v_site.site_type <> 'search_site' then
    raise exception 'Manual mobile unit creation is allowed only for Search Sites';
  end if;

  if coalesce(v_site.is_active, true) = false or coalesce(v_site.lifecycle_status, 'open') = 'closed' then
    raise exception 'Cannot add units to a closed or inactive Search Site';
  end if;

  if exists (
    select 1
    from public.incidents i
    where i.id = v_site.incident_id
      and (coalesce(i.is_closed, false) = true or i.archived_at is not null or coalesce(i.lifecycle_status, 'open') = 'closed')
  ) then
    raise exception 'Cannot add units to a closed or archived incident';
  end if;

  if public.current_user_role() not in ('admin', 'commander', 'search_user') then
    raise exception 'Only admin, commander, or search_user can add mobile Search Site units';
  end if;

  if public.current_user_role() = 'search_user' then
    perform public.assert_edit_search_site_data(v_site.incident_id);
  elsif not public.can_view_incident(v_site.incident_id) then
    raise exception 'User is not allowed to access this incident';
  end if;

  select * into v_floor
  from public.floors
  where id = p_floor_id
    and site_id = p_site_id
    and incident_id = v_site.incident_id
    and is_active = true;

  if not found then
    raise exception 'Floor does not belong to the selected Search Site';
  end if;

  select coalesce(max(zone_sequence), 0) + 1
  into v_sequence
  from public.units
  where floor_id = p_floor_id
    and zone_type = 'other'
    and zone_name = U&'\05D4\05D5\05E1\05E4\05D4 \05D9\05D3\05E0\05D9\05EA';

  v_notes := nullif(
    btrim(
      concat_ws(
        E'\n',
        case
          when nullif(btrim(coalesce(p_reported_unit_number, '')), '') is not null
            then U&'\05DE\05E1\05E4\05E8 \05D3\05D9\05E8\05D4 \05E9\05D3\05D5\05D5\05D7 \05D1\05E9\05D8\05D7: ' || btrim(p_reported_unit_number)
          else null
        end,
        nullif(btrim(coalesce(p_notes, '')), '')
      )
    ),
    ''
  );

  perform set_config('rcc.allow_structure_write', 'on', true);

  insert into public.units (
    incident_id,
    site_id,
    floor_id,
    unit_number,
    family_name,
    known_people_count,
    is_active,
    notes,
    zone_type,
    zone_name,
    zone_sequence,
    expected_occupants,
    structure_change_type,
    structure_changed_at,
    structure_changed_by,
    structure_change_reason,
    created_by,
    updated_by
  )
  values (
    v_site.incident_id,
    v_site.id,
    v_floor.id,
    'manual-search-' || v_sequence::text,
    null,
    null,
    true,
    v_notes,
    'other',
    U&'\05D4\05D5\05E1\05E4\05D4 \05D9\05D3\05E0\05D9\05EA',
    v_sequence,
    0,
    'search_unit_added_in_field',
    now(),
    public.current_actor_id(),
    v_notes,
    public.current_actor_id(),
    public.current_actor_id()
  )
  returning id into v_unit_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  insert into public.site_search_units (
    incident_id,
    site_id,
    unit_id,
    search_status,
    notes,
    searched_by,
    searched_at
  )
  values (
    v_site.incident_id,
    v_site.id,
    v_unit_id,
    'not_visited',
    v_notes,
    null,
    null
  )
  on conflict (site_id, unit_id) do nothing;

  perform public.create_event_log(
    v_site.incident_id,
    'search_unit_added_in_field',
    U&'\05D4\05D5\05E1\05E4\05D4 \05D3\05D9\05E8\05D4 \05D1\05E9\05D8\05D7',
    U&'\05D4\05D5\05E1\05E4\05D4 \05D9\05D3\05E0\05D9\05EA ' || v_sequence::text || U&' \05D1\05E7\05D5\05DE\05D4 ' || v_floor.floor_number::text,
    'operational',
    'normal',
    now(),
    v_site.id,
    v_floor.id,
    v_unit_id,
    null,
    null,
    U&'\05DE\05E2\05E8\05DB\05EA \05E1\05E8\05D9\05E7\05D4',
    null,
    jsonb_build_object(
      'site_id', v_site.id,
      'floor_id', v_floor.id,
      'unit_id', v_unit_id,
      'manual_sequence', v_sequence,
      'reported_unit_number', nullif(btrim(coalesce(p_reported_unit_number, '')), ''),
      'notes', v_notes
    )
  );

  return v_unit_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.add_search_site_manual_unit(uuid, uuid, text, text) to authenticated;

create or replace function public.can_write_search_event_log(
  p_incident_id uuid,
  p_log_type text,
  p_site_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_log_type in (
      'search_unit_apartment_searched',
      'search_unit_no_answer',
      'search_unit_casualties_found',
      'search_unit_completed',
      'search_unit_added_in_field'
    )
    and p_site_id is not null
    and public.can_edit_search_site_data(p_incident_id)
    and exists (
      select 1
      from public.sites s
      where s.id = p_site_id
        and s.incident_id = p_incident_id
        and s.site_type = 'search_site'
    )
$$;

grant execute on function public.can_write_search_event_log(uuid, text, uuid) to authenticated;
