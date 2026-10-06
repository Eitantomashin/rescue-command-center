-- Keep Search apartment card persistence unchanged while making its single
-- operational event describe only meaningful resident and apartment changes.

create or replace function public.save_search_unit_card(
  p_site_id uuid, p_unit_id uuid, p_known_people_count integer, p_has_apartment_damage boolean default false,
  p_apartment_damage_notes text default null, p_notes text default null, p_residents jsonb default '[]'::jsonb,
  p_deactivate_resident_ids jsonb default '[]'::jsonb, p_action text default 'save'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_site public.sites%rowtype; v_unit public.units%rowtype; v_previous public.site_search_units%rowtype; v_result_id uuid;
  v_resident jsonb; v_resident_id uuid; v_status_key text; v_status_id uuid; v_gender text; v_requires_evacuation boolean;
  v_active_count integer := 0; v_anxiety_count integer := 0; v_physical_count integer := 0; v_deceased_count integer := 0; v_evacuation_count integer := 0;
  v_has_casualties boolean := false; v_had_casualties boolean := false; v_all_clear boolean := false; v_new_status text := 'not_visited';
  v_actor_id uuid := public.current_actor_id(); v_actor_name text; v_floor_number integer;
  v_before_residents jsonb := '[]'::jsonb; v_before_resident jsonb; v_changes text[] := array[]::text[];
  v_before_name text; v_after_name text; v_before_status_label text; v_after_status_label text;
  v_old_search_status text; v_old_search_status_label text; v_new_search_status_label text;
  v_previous_damage_notes text; v_new_damage_notes text; v_previous_unit_notes text; v_new_unit_notes text;
begin
  if p_known_people_count is not null and (p_known_people_count < 0 or p_known_people_count > 10) then raise exception 'Known people count must be between 0 and 10'; end if;
  if p_action not in ('save','no_answer','clear','complete_casualties') then raise exception 'Invalid search card action'; end if;
  if jsonb_typeof(coalesce(p_residents,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_deactivate_resident_ids,'[]'::jsonb)) <> 'array' then raise exception 'Residents must be arrays'; end if;
  if p_known_people_count is not null and jsonb_array_length(p_residents) <> p_known_people_count then raise exception 'Resident entries must exactly match known people count'; end if;
  select * into v_site from public.sites where id=p_site_id and site_type='search_site'; if not found then raise exception 'Search Site not found'; end if;
  perform public.assert_edit_search_site_data(v_site.incident_id);
  select * into v_unit from public.units where id=p_unit_id and site_id=p_site_id and incident_id=v_site.incident_id for update; if not found then raise exception 'Unit must belong to the selected Search Site'; end if;
  select * into v_previous from public.site_search_units where site_id=p_site_id and unit_id=p_unit_id for update;
  select floor_number into v_floor_number from public.floors where id=v_unit.floor_id;
  select coalesce(nullif(btrim(display_name), ''), v_actor_id::text) into v_actor_name from public.profiles where id=v_actor_id;
  select coalesce(jsonb_agg(to_jsonb(prior) order by prior.id), '[]'::jsonb)
    into v_before_residents
  from (
    select ur.id, ur.first_name, ur.last_name, ur.status_id, st.status_key, st.hebrew_label as status_label,
      ur.notes, ur.requires_evacuation
    from public.unit_residents ur
    join public.status_types st on st.id=ur.status_id
    where ur.incident_id=v_site.incident_id and ur.site_id=v_site.id and ur.unit_id=v_unit.id and ur.is_active=true
    for update of ur
  ) prior;

  if exists (
    select 1
    from public.unit_residents ur
    join public.status_types st on st.id = ur.status_id
    where ur.id in (select value::text::uuid from jsonb_array_elements_text(p_deactivate_resident_ids))
      and ur.incident_id = v_site.incident_id and ur.site_id = v_site.id and ur.unit_id = v_unit.id
      and ur.is_active = true and st.status_key in ('anxiety_casualty','physical_casualty','deceased')
      and ur.requires_evacuation = true and ur.evacuated_at is null
  ) then
    raise exception 'לא ניתן להוציא מהרשימה הפעילה דייר הממתין לפינוי.';
  end if;

  update public.unit_residents ur
  set is_active=false,updated_by=public.current_actor_id()
  from public.status_types st
  where ur.status_id=st.id and ur.unit_id=v_unit.id and ur.incident_id=v_site.incident_id and ur.site_id=v_site.id and ur.is_active=true
    and ur.notes='placeholder' and ur.first_name ~ '^דייר [0-9]+$' and ur.last_name is null and ur.gender='unknown'
    and ur.age is null and ur.phone is null and ur.linked_person_id is null and coalesce(ur.requires_evacuation,false)=false
    and st.category='resident' and st.status_key='missing';
  v_had_casualties := coalesce(v_previous.search_status='casualties',false) or coalesce(v_previous.casualty_psych,false) or coalesce(v_previous.casualty_body,false) or coalesce(v_previous.medical_evacuation,false) or coalesce(v_previous.casualties_resolved,false)
    or exists (select 1 from public.unit_residents ur join public.status_types st on st.id=ur.status_id where ur.unit_id=v_unit.id and st.category='resident' and st.status_key in ('anxiety_casualty','physical_casualty','medical_evacuation','deceased'));
  for v_resident in select value from jsonb_array_elements(p_residents) loop
    v_resident_id := nullif(v_resident->>'id','')::uuid; v_status_key := coalesce(nullif(v_resident->>'status_key',''),'not_checked');
    if v_status_key='medical_evacuation' then v_status_key := 'physical_casualty'; v_requires_evacuation := true; else v_requires_evacuation := coalesce((v_resident->>'requires_evacuation')::boolean,false); end if;
    v_gender := coalesce(nullif(v_resident->>'gender',''),'unknown');
    if v_status_key not in ('not_checked','resident_clear','anxiety_casualty','physical_casualty','deceased') or v_gender not in ('unknown','male','female') then raise exception 'Invalid resident status or gender'; end if;
    v_requires_evacuation := v_status_key in ('anxiety_casualty','physical_casualty','deceased') and v_requires_evacuation;
    v_status_id := public.get_status_id('resident',v_status_key,v_site.incident_id); if v_status_id is null then raise exception 'Resident status is unavailable'; end if;
    select hebrew_label into v_after_status_label from public.status_types where id=v_status_id;
    v_after_name := nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_resident->>'first_name','')), ''), nullif(btrim(coalesce(v_resident->>'last_name','')), ''))), '');
    if v_resident_id is null then
      insert into public.unit_residents (incident_id,site_id,unit_id,first_name,last_name,age,phone,status_id,gender,requires_evacuation,requires_medical_evacuation,notes,created_by,updated_by)
      values (v_site.incident_id,v_site.id,v_unit.id,nullif(btrim(v_resident->>'first_name'),''),nullif(btrim(v_resident->>'last_name'),''),nullif(v_resident->>'age','')::integer,nullif(btrim(v_resident->>'phone'),''),v_status_id,v_gender,v_requires_evacuation,v_status_key='physical_casualty' and v_requires_evacuation,nullif(btrim(v_resident->>'notes'),''),public.current_actor_id(),public.current_actor_id());
      if v_after_name is not null then v_changes := array_append(v_changes, 'נוסף דייר: ' || v_after_name); end if;
    else
      select value into v_before_resident from jsonb_array_elements(v_before_residents) where value->>'id'=v_resident_id::text limit 1;
      v_before_name := nullif(btrim(concat_ws(' ', v_before_resident->>'first_name', v_before_resident->>'last_name')), '');
      v_before_status_label := coalesce(v_before_resident->>'status_label', v_before_resident->>'status_key');
      if v_before_resident is not null and coalesce(v_before_resident->>'status_key','') is distinct from v_status_key then
        v_changes := array_append(v_changes, coalesce(v_after_name, v_before_name, 'דייר ללא שם') || ' – ' || coalesce(v_before_status_label, 'לא ידוע') || ' → ' || coalesce(v_after_status_label, v_status_key));
      end if;
      if v_before_resident is not null and coalesce((v_before_resident->>'requires_evacuation')::boolean, false) is distinct from v_requires_evacuation then
        v_changes := array_append(v_changes, case when v_requires_evacuation then 'נדרש פינוי: ' else 'בוטלה דרישת פינוי: ' end || coalesce(v_after_name, v_before_name, 'דייר ללא שם'));
      end if;
      if v_before_resident is not null and nullif(btrim(coalesce(v_before_resident->>'notes','')), '') is distinct from nullif(btrim(coalesce(v_resident->>'notes','')), '') then
        v_changes := array_append(v_changes, 'הערות דייר עודכנו: ' || coalesce(v_after_name, v_before_name, 'דייר ללא שם'));
      end if;
      if v_before_resident is not null and v_before_name is distinct from v_after_name then
        v_changes := array_append(v_changes, 'שם דייר עודכן: ' || coalesce(v_before_name, 'ללא שם') || ' → ' || coalesce(v_after_name, 'ללא שם'));
      end if;
      update public.unit_residents set first_name=nullif(btrim(v_resident->>'first_name'),''),last_name=nullif(btrim(v_resident->>'last_name'),''),age=nullif(v_resident->>'age','')::integer,phone=nullif(btrim(v_resident->>'phone'),''),status_id=v_status_id,gender=v_gender,requires_evacuation=v_requires_evacuation,requires_medical_evacuation=v_status_key='physical_casualty' and v_requires_evacuation,notes=nullif(btrim(v_resident->>'notes'),''),updated_by=public.current_actor_id() where id=v_resident_id and incident_id=v_site.incident_id and site_id=v_site.id and unit_id=v_unit.id and is_active=true;
      if not found then raise exception 'Resident does not belong to this unit'; end if;
    end if;
  end loop;
  for v_before_resident in select value from jsonb_array_elements(v_before_residents) where value->>'id' in (select value from jsonb_array_elements_text(p_deactivate_resident_ids)) loop
    v_before_name := nullif(btrim(concat_ws(' ', v_before_resident->>'first_name', v_before_resident->>'last_name')), '');
    if v_before_name is not null then v_changes := array_append(v_changes, 'הוסר דייר: ' || v_before_name); end if;
  end loop;
  update public.unit_residents set is_active=false,updated_by=public.current_actor_id() where id in (select value::text::uuid from jsonb_array_elements_text(p_deactivate_resident_ids)) and incident_id=v_site.incident_id and site_id=v_site.id and unit_id=v_unit.id and is_active=true;
  select count(*),count(*) filter(where st.status_key='anxiety_casualty'),count(*) filter(where st.status_key='physical_casualty'),count(*) filter(where st.status_key='deceased'),count(*) filter(where st.status_key in ('anxiety_casualty','physical_casualty','deceased') and ur.requires_evacuation),coalesce(bool_or(st.status_key in ('anxiety_casualty','physical_casualty','deceased')),false),coalesce(bool_and(st.status_key='resident_clear'),false)
  into v_active_count,v_anxiety_count,v_physical_count,v_deceased_count,v_evacuation_count,v_has_casualties,v_all_clear from public.unit_residents ur join public.status_types st on st.id=ur.status_id where ur.unit_id=v_unit.id and ur.is_active=true;
  if p_known_people_count is not null and v_active_count > p_known_people_count then raise exception 'Reduce residents explicitly before reducing the known people count'; end if;
  if p_action='complete_casualties' and exists (
    select 1 from public.unit_residents ur join public.status_types st on st.id=ur.status_id
    where ur.unit_id=v_unit.id and ur.is_active=true and st.status_key in ('anxiety_casualty','physical_casualty','deceased')
      and ur.requires_evacuation=true and ur.evacuated_at is null
  ) then
    raise exception 'לא ניתן לסיים טיפול בנפגעים כל עוד קיים דייר הממתין לפינוי.';
  end if;
  if p_action='no_answer' then v_new_status:='no_answer'; elsif v_has_casualties and p_action <> 'complete_casualties' then v_new_status:='casualties'; elsif p_action='clear' then if p_known_people_count is null or (p_known_people_count>0 and (v_active_count<>p_known_people_count or not v_all_clear)) then raise exception 'All known residents must be marked clear before clearance'; end if; if v_had_casualties then raise exception 'Reported casualties require explicit completion'; end if; v_new_status:='clear'; elsif p_action='complete_casualties' then if not(v_has_casualties or v_had_casualties) then raise exception 'No reported casualties require completion'; end if; v_new_status:='completed'; elsif p_known_people_count is not null or jsonb_array_length(p_residents)>0 or coalesce(p_has_apartment_damage,false) or nullif(btrim(coalesce(p_notes,'')),'') is not null then v_new_status:='in_progress'; end if;
  v_old_search_status := coalesce(v_previous.search_status, 'not_visited');
  v_old_search_status_label := case v_old_search_status when 'not_visited' then 'טרם נסרקה' when 'in_progress' then 'סריקה מתבצעת' when 'no_answer' then 'אין מענה' when 'clear' then 'תקין / מזוכה' when 'casualties' then 'דווחו נפגעים' when 'completed' then 'סריקה הושלמה' else v_old_search_status end;
  v_new_search_status_label := case v_new_status when 'not_visited' then 'טרם נסרקה' when 'in_progress' then 'סריקה מתבצעת' when 'no_answer' then 'אין מענה' when 'clear' then 'תקין / מזוכה' when 'casualties' then 'דווחו נפגעים' when 'completed' then 'סריקה הושלמה' else v_new_status end;
  if v_old_search_status is distinct from v_new_status then v_changes := array_append(v_changes, 'סטטוס דירה: ' || v_old_search_status_label || ' → ' || v_new_search_status_label); end if;
  if v_unit.known_people_count is distinct from p_known_people_count then v_changes := array_append(v_changes, 'מספר דיירים ידוע: ' || coalesce(v_unit.known_people_count::text, 'לא ידוע') || ' → ' || coalesce(p_known_people_count::text, 'לא ידוע')); end if;
  v_previous_damage_notes := nullif(btrim(coalesce(v_previous.apartment_damage_notes, '')), '');
  v_new_damage_notes := nullif(btrim(coalesce(p_apartment_damage_notes, '')), '');
  if coalesce(v_previous.has_apartment_damage, false) is distinct from coalesce(p_has_apartment_damage, false) then
    v_changes := array_append(v_changes, case when coalesce(p_has_apartment_damage, false) then 'דווח נזק לדירה' else 'דיווח נזק לדירה הוסר' end);
  elsif coalesce(p_has_apartment_damage, false) and v_previous_damage_notes is distinct from v_new_damage_notes then
    v_changes := array_append(v_changes, 'תיאור נזק עודכן');
  end if;
  v_previous_unit_notes := nullif(btrim(coalesce(v_previous.notes, '')), '');
  v_new_unit_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_previous_unit_notes is distinct from v_new_unit_notes then v_changes := array_append(v_changes, 'הערות דירה עודכנו'); end if;
  update public.units set known_people_count=p_known_people_count,updated_by=public.current_actor_id() where id=v_unit.id;
  insert into public.site_search_units (incident_id,site_id,unit_id,occupants_count,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,has_apartment_damage,apartment_damage_notes,casualties_resolved,casualties_resolved_at,notes,searched_by,searched_at,completed_at)
  values(v_site.incident_id,v_site.id,v_unit.id,p_known_people_count,v_new_status,v_anxiety_count>0,v_physical_count>0,v_evacuation_count>0,v_anxiety_count,v_physical_count,coalesce(p_has_apartment_damage,false),v_new_damage_notes,p_action='complete_casualties',case when p_action='complete_casualties' then now() end,v_new_unit_notes,public.current_actor_id(),now(),case when v_new_status in ('clear','completed') then now() end)
  on conflict(site_id,unit_id) do update set occupants_count=excluded.occupants_count,search_status=excluded.search_status,casualty_psych=excluded.casualty_psych,casualty_body=excluded.casualty_body,medical_evacuation=excluded.medical_evacuation,anxiety_casualties_count=excluded.anxiety_casualties_count,physical_casualties_count=excluded.physical_casualties_count,has_apartment_damage=excluded.has_apartment_damage,apartment_damage_notes=excluded.apartment_damage_notes,casualties_resolved=excluded.casualties_resolved or public.site_search_units.casualties_resolved,casualties_resolved_at=case when excluded.casualties_resolved then now() else public.site_search_units.casualties_resolved_at end,notes=excluded.notes,searched_by=excluded.searched_by,searched_at=excluded.searched_at,completed_at=excluded.completed_at returning id into v_result_id;
  if coalesce(array_length(v_changes, 1), 0) > 0 then
    perform set_config('rcc.allow_event_log_insert', 'on', true);
    insert into public.event_logs (incident_id,site_id,floor_id,unit_id,log_type,category,reported_at,source_type,source_name,title,description,importance,metadata,created_by)
    values(v_site.incident_id,v_site.id,v_unit.floor_id,v_unit.id,'search_unit_card_saved','operational',now(),'חפ"ק',v_actor_name,'פרטי דירה עודכנו – קומה ' || coalesce(v_floor_number::text, '-') || ', דירה ' || v_unit.unit_number,array_to_string(v_changes, ' • '),case when v_new_status='casualties' then 'important' else 'normal' end,jsonb_build_object('old_search_status',v_previous.search_status,'new_search_status',v_new_status,'known_people_count',p_known_people_count,'resident_summary',jsonb_build_object('total',v_active_count,'clear',v_active_count-v_anxiety_count-v_physical_count-v_deceased_count,'anxiety',v_anxiety_count,'physical',v_physical_count,'deceased',v_deceased_count,'evacuation_required',v_evacuation_count),'action',p_action,'actor_id',v_actor_id,'actor_name',v_actor_name,'changes',to_jsonb(v_changes)),v_actor_id);
    perform set_config('rcc.allow_event_log_insert', 'off', true);
  end if;
  return v_result_id;
exception when others then
  perform set_config('rcc.allow_event_log_insert', 'off', true);
  raise;
end $$;

revoke all on function public.save_search_unit_card(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text) from public;
grant execute on function public.save_search_unit_card(uuid,uuid,integer,boolean,text,text,jsonb,jsonb,text) to authenticated;
