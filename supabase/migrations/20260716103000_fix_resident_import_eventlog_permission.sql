-- Keep municipal resident import and its audit event in one authorized RPC transaction.
-- This avoids widening direct event_logs insert permissions while preserving audit.

create or replace function public.import_site_residents(
  p_site_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_row jsonb;
  v_count integer := 0;
begin
  select *
  into v_site
  from public.sites
  where id = p_site_id;

  if not found or not v_site.is_active or coalesce(v_site.is_cancelled, false) then
    raise exception 'Active site was not found';
  end if;

  perform public.assert_edit_operational_data(v_site.incident_id);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Resident rows must be an array';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(coalesce(v_row ->> 'first_name', '')), '') is null
      and nullif(btrim(coalesce(v_row ->> 'last_name', '')), '') is null
    then
      continue;
    end if;

    insert into public.imported_site_residents (
      incident_id,
      site_id,
      floor,
      apartment,
      first_name,
      last_name,
      gender,
      age,
      phone,
      notes,
      created_by
    )
    values (
      v_site.incident_id,
      v_site.id,
      nullif(btrim(coalesce(v_row ->> 'floor', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'apartment', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'last_name', '')), ''),
      case
        when coalesce(v_row ->> 'gender', 'unknown') in ('male', 'female', 'unknown') then coalesce(v_row ->> 'gender', 'unknown')
        else 'unknown'
      end,
      case
        when nullif(btrim(coalesce(v_row ->> 'age', '')), '') is null then null
        else greatest(0, (v_row ->> 'age')::integer)
      end,
      nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
      v_actor_id
    );

    v_count := v_count + 1;
  end loop;

  perform set_config('rcc.allow_event_log_insert', 'on', true);

  insert into public.event_logs (
    incident_id,
    site_id,
    floor_id,
    unit_id,
    person_id,
    team_id,
    log_type,
    category,
    reported_at,
    source_type,
    source_name,
    title,
    description,
    importance,
    metadata,
    created_by
  )
  values (
    v_site.incident_id,
    v_site.id,
    null,
    null,
    null,
    null,
    'site_resident_list_imported',
    'operational',
    now(),
    'system',
    v_actor_name,
    'רשימת דיירים נטענה',
    'רשימת דיירים נטענה לאתר ' || coalesce(v_site.name, v_site.street || ' ' || v_site.house_number) || ' על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'important',
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', v_site.id,
      'imported_count', v_count
    ),
    v_actor_id
  );

  perform set_config('rcc.allow_event_log_insert', 'off', true);

  return v_count;
exception
  when others then
    perform set_config('rcc.allow_event_log_insert', 'off', true);
    raise;
end;
$$;

revoke all on function public.import_site_residents(uuid, jsonb) from public, anon;
grant execute on function public.import_site_residents(uuid, jsonb) to authenticated;
