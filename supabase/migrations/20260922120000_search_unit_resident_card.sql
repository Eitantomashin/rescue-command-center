-- Stage 9: one operational search-card write. Residents remain public.unit_residents.

insert into public.status_types (incident_id, category, status_key, name, hebrew_label, color, is_open, is_dashboard_counted, is_default, is_active, sort_order)
values
  (null, 'resident', 'not_checked', 'Not checked', 'טרם נבדק', 'gray', true, false, false, true, 60),
  (null, 'resident', 'resident_clear', 'Resident clear', 'תקין', 'green', false, true, false, true, 61),
  (null, 'resident', 'anxiety_casualty', 'Anxiety casualty', 'נפגע חרדה', 'orange', true, true, false, true, 62),
  (null, 'resident', 'physical_casualty', 'Physical casualty', 'נפגע גוף', 'red', true, true, false, true, 63),
  (null, 'resident', 'medical_evacuation', 'Medical evacuation', 'דורש פינוי רפואי', 'red', true, true, false, true, 64)
on conflict do nothing;

create or replace function public.save_search_unit_card(
  p_site_id uuid,
  p_unit_id uuid,
  p_known_people_count integer,
  p_has_apartment_damage boolean default false,
  p_apartment_damage_notes text default null,
  p_notes text default null,
  p_residents jsonb default '[]'::jsonb,
  p_deactivate_resident_ids jsonb default '[]'::jsonb,
  p_action text default 'save'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_unit public.units%rowtype;
  v_result_id uuid;
  v_resident jsonb;
  v_resident_id uuid;
  v_status_key text;
  v_status_id uuid;
  v_active_count integer;
  v_has_casualties boolean := false;
  v_had_casualties boolean := false;
  v_all_clear boolean := false;
  v_anxiety_count integer := 0;
  v_physical_count integer := 0;
  v_medical_evacuation boolean := false;
  v_previous public.site_search_units%rowtype;
  v_new_status text := 'not_visited';
begin
  if p_known_people_count is not null and (p_known_people_count < 0 or p_known_people_count > 10) then
    raise exception 'Known people count must be between 0 and 10';
  end if;
  if p_action not in ('save', 'no_answer', 'clear', 'complete_casualties') then
    raise exception 'Invalid search card action';
  end if;
  select * into v_site from public.sites where id = p_site_id and site_type = 'search_site';
  if not found then raise exception 'Search Site not found'; end if;
  perform public.assert_edit_search_site_data(v_site.incident_id);
  select * into v_unit from public.units where id = p_unit_id and site_id = p_site_id and incident_id = v_site.incident_id for update;
  if not found then raise exception 'Unit must belong to the selected Search Site'; end if;
  select * into v_previous from public.site_search_units where site_id = p_site_id and unit_id = p_unit_id for update;
  v_had_casualties := coalesce(v_previous.search_status = 'casualties', false)
    or coalesce(v_previous.casualty_psych, false)
    or coalesce(v_previous.casualty_body, false)
    or coalesce(v_previous.medical_evacuation, false)
    or coalesce(v_previous.casualties_resolved, false);

  if jsonb_typeof(coalesce(p_residents, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_deactivate_resident_ids, '[]'::jsonb)) <> 'array' then raise exception 'Residents must be arrays'; end if;
  if p_known_people_count is not null and jsonb_array_length(p_residents) > p_known_people_count then raise exception 'Resident count exceeds known people count'; end if;

  for v_resident in select value from jsonb_array_elements(p_residents) loop
    v_resident_id := nullif(v_resident->>'id', '')::uuid;
    v_status_key := coalesce(nullif(v_resident->>'status_key', ''), 'not_checked');
    if v_status_key not in ('not_checked', 'resident_clear', 'anxiety_casualty', 'physical_casualty', 'medical_evacuation') then raise exception 'Invalid resident status'; end if;
    v_status_id := public.get_status_id('resident', v_status_key, v_site.incident_id);
    if v_status_id is null then raise exception 'Resident status is unavailable'; end if;
    if v_resident_id is null then
      insert into public.unit_residents (incident_id, site_id, unit_id, first_name, last_name, age, phone, status_id, notes, created_by, updated_by)
      values (v_site.incident_id, v_site.id, v_unit.id, nullif(btrim(v_resident->>'first_name'), ''), nullif(btrim(v_resident->>'last_name'), ''), nullif(v_resident->>'age','')::integer, nullif(btrim(v_resident->>'phone'), ''), v_status_id, nullif(btrim(v_resident->>'notes'), ''), public.current_actor_id(), public.current_actor_id());
    else
      update public.unit_residents set first_name = nullif(btrim(v_resident->>'first_name'), ''), last_name = nullif(btrim(v_resident->>'last_name'), ''), age = nullif(v_resident->>'age','')::integer, phone = nullif(btrim(v_resident->>'phone'), ''), status_id = v_status_id, notes = nullif(btrim(v_resident->>'notes'), ''), updated_by = public.current_actor_id()
      where id = v_resident_id and incident_id = v_site.incident_id and unit_id = v_unit.id and is_active = true;
      if not found then raise exception 'Resident does not belong to this unit'; end if;
    end if;
  end loop;

  update public.unit_residents
  set is_active = false, updated_by = public.current_actor_id()
  where incident_id = v_site.incident_id and unit_id = v_unit.id and is_active
    and id in (select value::text::uuid from jsonb_array_elements_text(p_deactivate_resident_ids));

  select count(*), bool_or(st.status_key in ('anxiety_casualty','physical_casualty','medical_evacuation')), coalesce(bool_and(st.status_key = 'resident_clear'), false), count(*) filter (where st.status_key='anxiety_casualty'), count(*) filter (where st.status_key='physical_casualty'), bool_or(st.status_key='medical_evacuation')
  into v_active_count, v_has_casualties, v_all_clear, v_anxiety_count, v_physical_count, v_medical_evacuation
  from public.unit_residents ur join public.status_types st on st.id = ur.status_id
  where ur.unit_id = v_unit.id and ur.is_active;
  if p_known_people_count is not null and v_active_count > p_known_people_count then raise exception 'Reduce residents explicitly before reducing the known people count'; end if;
  if v_has_casualties then v_new_status := 'casualties';
  elsif p_action = 'no_answer' then v_new_status := 'no_answer';
  elsif p_action = 'clear' then
    if p_known_people_count is null or (p_known_people_count > 0 and (v_active_count <> p_known_people_count or not v_all_clear)) then raise exception 'All known residents must be marked clear before clearance'; end if;
    if v_had_casualties then raise exception 'Reported casualties require explicit completion'; end if;
    v_new_status := 'clear';
  elsif p_action = 'complete_casualties' then
    if not (v_has_casualties or v_had_casualties) then raise exception 'No reported casualties require completion'; end if;
    v_new_status := 'completed';
  elsif p_known_people_count is not null or jsonb_array_length(p_residents) > 0 or coalesce(p_has_apartment_damage,false) or nullif(btrim(coalesce(p_notes,'')),'') is not null then v_new_status := 'not_visited'; end if;

  update public.units set known_people_count = p_known_people_count, updated_by = public.current_actor_id() where id = v_unit.id;
  insert into public.site_search_units (incident_id, site_id, unit_id, occupants_count, search_status, casualty_psych, casualty_body, medical_evacuation, anxiety_casualties_count, physical_casualties_count, has_apartment_damage, apartment_damage_notes, casualties_resolved, casualties_resolved_at, notes, searched_by, searched_at, completed_at)
  values (v_site.incident_id, v_site.id, v_unit.id, p_known_people_count, v_new_status, v_anxiety_count > 0, v_physical_count > 0, v_medical_evacuation, v_anxiety_count, v_physical_count, coalesce(p_has_apartment_damage,false), nullif(btrim(coalesce(p_apartment_damage_notes,'')),''), p_action = 'complete_casualties', case when p_action = 'complete_casualties' then now() end, nullif(btrim(coalesce(p_notes,'')),''), public.current_actor_id(), now(), case when v_new_status in ('clear','completed') then now() end)
  on conflict (site_id, unit_id) do update set occupants_count=excluded.occupants_count, search_status=excluded.search_status, casualty_psych=excluded.casualty_psych, casualty_body=excluded.casualty_body, medical_evacuation=excluded.medical_evacuation, has_apartment_damage=excluded.has_apartment_damage, apartment_damage_notes=excluded.apartment_damage_notes, casualties_resolved=excluded.casualties_resolved or public.site_search_units.casualties_resolved, casualties_resolved_at=case when excluded.casualties_resolved then now() else public.site_search_units.casualties_resolved_at end, notes=excluded.notes, searched_by=excluded.searched_by, searched_at=excluded.searched_at, completed_at=excluded.completed_at returning id into v_result_id;
  insert into public.event_logs (incident_id, site_id, floor_id, unit_id, log_type, category, reported_at, source_type, title, importance, metadata, created_by)
  values (v_site.incident_id, v_site.id, v_unit.floor_id, v_unit.id, 'search_unit_card_saved', 'operational', now(), 'system', 'כרטיס סריקת דירה עודכן', case when v_new_status='casualties' then 'important' else 'normal' end, jsonb_build_object('old_search_status',v_previous.search_status,'new_search_status',v_new_status,'known_people_count',p_known_people_count,'resident_count',v_active_count,'has_apartment_damage',coalesce(p_has_apartment_damage,false),'action',p_action), public.current_actor_id());
  return v_result_id;
end;
$$;

revoke all on function public.save_search_unit_card(uuid, uuid, integer, boolean, text, text, jsonb, jsonb, text) from public;
grant execute on function public.save_search_unit_card(uuid, uuid, integer, boolean, text, text, jsonb, jsonb, text) to authenticated;
