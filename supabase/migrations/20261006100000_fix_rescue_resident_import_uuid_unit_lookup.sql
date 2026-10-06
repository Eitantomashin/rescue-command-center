-- Forward-only runtime fix for the applied Rescue resident import RPC.
-- PostgreSQL has no min(uuid); count first, then select the UUID only when exactly one unit matches.
create or replace function public.import_site_residents(p_site_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_site public.sites%rowtype; v_actor uuid := public.current_actor_id(); v_actor_name text;
  v_row jsonb; v_ordinal integer; v_floor text; v_apartment text; v_imported_id uuid; v_unit_id uuid;
  v_unit_count integer; v_resident_id uuid; v_status_id uuid; v_count integer := 0;
  v_prior integer; v_matched integer := 0; v_unmatched integer := 0; v_affected_units uuid[] := array[]::uuid[];
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found or not v_site.is_active or coalesce(v_site.is_cancelled, false) then raise exception 'Active site was not found'; end if;
  perform public.assert_edit_operational_data(v_site.incident_id);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Resident rows must be an array'; end if;
  select coalesce(nullif(btrim(display_name), ''), id::text) into v_actor_name from public.profiles where id = v_actor;
  if coalesce(v_site.site_type, 'rescue_site') = 'rescue_site' then
    v_status_id := public.get_status_id('resident', 'missing', v_site.incident_id);
    if v_status_id is null then raise exception 'Default resident status is unavailable'; end if;
  end if;
  for v_row, v_ordinal in select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality loop
    if nullif(btrim(coalesce(v_row->>'first_name','')), '') is null and nullif(btrim(coalesce(v_row->>'last_name','')), '') is null then continue; end if;
    v_floor := nullif(btrim(coalesce(v_row->>'floor','')), '');
    v_apartment := nullif(btrim(coalesce(v_row->>'apartment','')), '');
    -- A Rescue re-import reuses its staging identity (including duplicate-row
    -- ordinal) instead of creating another operational resident.
    v_imported_id := null;
    if coalesce(v_site.site_type, 'rescue_site') = 'rescue_site' then
      select count(*) into v_prior from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
      where x.ordinality < v_ordinal
        and lower(coalesce(btrim(x.value->>'first_name'),''))=lower(coalesce(btrim(v_row->>'first_name'),''))
        and lower(coalesce(btrim(x.value->>'last_name'),''))=lower(coalesce(btrim(v_row->>'last_name'),''))
        and coalesce(x.value->>'gender','unknown')=coalesce(v_row->>'gender','unknown')
        and regexp_replace(lower(coalesce(btrim(x.value->>'floor'),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_floor,'')), '\s+', '', 'g')
        and regexp_replace(lower(coalesce(btrim(x.value->>'apartment'),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_apartment,'')), '\s+', '', 'g');
      select i.id into v_imported_id from public.imported_site_residents i
      where i.incident_id=v_site.incident_id and i.site_id=v_site.id and i.is_active
        and lower(coalesce(btrim(i.first_name),''))=lower(coalesce(btrim(v_row->>'first_name'),''))
        and lower(coalesce(btrim(i.last_name),''))=lower(coalesce(btrim(v_row->>'last_name'),''))
        and coalesce(i.gender,'unknown')=case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end
        and regexp_replace(lower(coalesce(btrim(i.floor),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_floor,'')), '\s+', '', 'g')
        and regexp_replace(lower(coalesce(btrim(i.apartment),'')), '\s+', '', 'g')=regexp_replace(lower(coalesce(v_apartment,'')), '\s+', '', 'g')
      order by i.created_at,i.id offset v_prior limit 1;
    end if;
    if v_imported_id is null then
      insert into public.imported_site_residents(incident_id,site_id,floor,apartment,first_name,last_name,gender,age,phone,notes,created_by)
      values(v_site.incident_id,v_site.id,v_floor,v_apartment,nullif(btrim(coalesce(v_row->>'first_name','')),''),nullif(btrim(coalesce(v_row->>'last_name','')),''),case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,nullif(btrim(coalesce(v_row->>'phone','')),''),nullif(btrim(coalesce(v_row->>'notes','')),''),v_actor)
      returning id into v_imported_id;
    else
      update public.imported_site_residents set age=case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,phone=nullif(btrim(coalesce(v_row->>'phone','')),''),notes=nullif(btrim(coalesce(v_row->>'notes','')),'') where id=v_imported_id;
    end if;
    v_count := v_count + 1;
    if coalesce(v_site.site_type,'rescue_site') <> 'rescue_site' or v_floor is null or v_apartment is null then continue; end if;
    select count(*) into v_unit_count
    from public.units u join public.floors f on f.id=u.floor_id
    where u.incident_id=v_site.incident_id and u.site_id=v_site.id and u.is_active and f.is_active
      and regexp_replace(lower(btrim(f.floor_number::text)), '\s+', '', 'g')=regexp_replace(lower(v_floor), '\s+', '', 'g')
      and regexp_replace(lower(btrim(u.unit_number)), '\s+', '', 'g')=regexp_replace(lower(v_apartment), '\s+', '', 'g');
    if v_unit_count <> 1 then v_unmatched := v_unmatched + 1; continue; end if;
    select u.id into v_unit_id
    from public.units u join public.floors f on f.id=u.floor_id
    where u.incident_id=v_site.incident_id and u.site_id=v_site.id and u.is_active and f.is_active
      and regexp_replace(lower(btrim(f.floor_number::text)), '\s+', '', 'g')=regexp_replace(lower(v_floor), '\s+', '', 'g')
      and regexp_replace(lower(btrim(u.unit_number)), '\s+', '', 'g')=regexp_replace(lower(v_apartment), '\s+', '', 'g')
    limit 1;
    select ur.id into v_resident_id from public.imported_site_residents i join public.unit_residents ur on ur.id=i.linked_resident_id
    where i.id=v_imported_id and ur.unit_id=v_unit_id and ur.is_active for update of ur;
    -- An untouched historical placeholder is the only unlinked record import may replace.
    if not found then select ur.id into v_resident_id from public.unit_residents ur
    join public.status_types st on st.id=ur.status_id
    where ur.unit_id=v_unit_id and ur.is_active and ur.notes='placeholder'
      and ur.first_name ~ '^דייר [0-9]+$' and ur.last_name is null
      and coalesce(ur.gender,'unknown')='unknown' and ur.age is null and ur.phone is null
      and ur.linked_person_id is null and coalesce(ur.requires_medical_evacuation,false)=false
      and st.category='resident' and st.status_key='missing'
    order by ur.created_at,ur.id limit 1 for update skip locked; end if;
    if v_resident_id is null then
      insert into public.unit_residents(incident_id,site_id,unit_id,first_name,last_name,gender,age,phone,status_id,notes,created_by,updated_by)
      values(v_site.incident_id,v_site.id,v_unit_id,nullif(btrim(coalesce(v_row->>'first_name','')),''),nullif(btrim(coalesce(v_row->>'last_name','')),''),case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,nullif(btrim(coalesce(v_row->>'phone','')),''),v_status_id,nullif(btrim(coalesce(v_row->>'notes','')),''),v_actor,v_actor)
      returning id into v_resident_id;
    elsif exists(select 1 from public.unit_residents ur where ur.id=v_resident_id and ur.notes='placeholder' and ur.linked_person_id is null) then
      update public.unit_residents set first_name=nullif(btrim(coalesce(v_row->>'first_name','')),''),last_name=nullif(btrim(coalesce(v_row->>'last_name','')),''),gender=case when coalesce(v_row->>'gender','unknown') in ('male','female','unknown') then coalesce(v_row->>'gender','unknown') else 'unknown' end,age=case when nullif(btrim(coalesce(v_row->>'age','')),'') is null then null else greatest(0,(v_row->>'age')::integer) end,phone=nullif(btrim(coalesce(v_row->>'phone','')),''),notes=nullif(btrim(coalesce(v_row->>'notes','')),''),updated_by=v_actor where id=v_resident_id;
    end if;
    update public.imported_site_residents set linked_resident_id=v_resident_id,linked_unit_id=v_unit_id,linked_at=now(),linked_by=v_actor where id=v_imported_id;
    v_affected_units := array_append(v_affected_units,v_unit_id); v_matched := v_matched + 1;
  end loop;
  -- A new import is the current estimate only for resolved units; meaningful and linked residents survive.
  update public.unit_residents ur set is_active=false,updated_by=v_actor,updated_at=now()
  where ur.unit_id=any(v_affected_units) and ur.is_active and ur.notes='placeholder' and ur.first_name ~ '^דייר [0-9]+$'
    and ur.last_name is null and coalesce(ur.gender,'unknown')='unknown' and ur.age is null and ur.phone is null
    and ur.linked_person_id is null and coalesce(ur.requires_medical_evacuation,false)=false
    and exists(select 1 from public.status_types st where st.id=ur.status_id and st.category='resident' and st.status_key='missing');
  update public.units u set known_people_count=(select count(*) from public.unit_residents ur where ur.unit_id=u.id and ur.is_active),updated_by=v_actor,updated_at=now() where u.id=any(v_affected_units);
  perform set_config('rcc.allow_event_log_insert','on',true);
  insert into public.event_logs(incident_id,site_id,log_type,category,reported_at,source_type,source_name,title,description,importance,metadata,created_by)
  values(v_site.incident_id,v_site.id,'site_resident_list_imported','operational',now(),'system',v_actor_name,'רשימת דיירים נטענה','רשימת דיירים נטענה לאתר '||coalesce(v_site.name,v_site.street||' '||v_site.house_number)||' על ידי '||coalesce(v_actor_name,'משתמש לא ידוע')||'.','important',jsonb_build_object('actor_id',v_actor,'actor_name',v_actor_name,'site_id',v_site.id,'imported_count',v_count,'matched_unit_residents_count',v_matched,'unmatched_unit_residents_count',v_unmatched),v_actor);
  perform set_config('rcc.allow_event_log_insert','off',true);
  return v_count;
exception when others then
  perform set_config('rcc.allow_event_log_insert','off',true); raise;
end;
$$;

revoke all on function public.import_site_residents(uuid,jsonb) from public, anon;
grant execute on function public.import_site_residents(uuid,jsonb) to authenticated;
