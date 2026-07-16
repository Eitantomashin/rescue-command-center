-- Keep site detail updates and their audit event in one authorized RPC transaction.
-- This avoids widening direct event_logs insert permissions while preserving audit.

create or replace function public.update_site_safe_details(
  p_site_id uuid,
  p_name text default null,
  p_site_type text default null,
  p_city text default null,
  p_street text default null,
  p_house_number text default null,
  p_search_reason text default null,
  p_search_priority text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_site_type text;
  v_new_name text;
  v_new_city text;
  v_new_street text;
  v_new_house_number text;
  v_new_search_reason text;
  v_new_search_priority text;
begin
  select *
  into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site was not found';
  end if;

  perform public.assert_edit_operational_data(v_site.incident_id);

  if coalesce(v_site.is_cancelled, false) then
    raise exception 'Cancelled sites cannot be edited';
  end if;

  v_site_type := coalesce(nullif(btrim(p_site_type), ''), v_site.site_type, 'rescue_site');

  if v_site_type not in ('rescue_site', 'search_site') then
    raise exception 'Invalid site type';
  end if;

  v_new_name := nullif(btrim(p_name), '');
  v_new_city := nullif(btrim(p_city), '');
  v_new_street := nullif(btrim(coalesce(p_street, v_site.street)), '');
  v_new_house_number := nullif(btrim(coalesce(p_house_number, v_site.house_number)), '');
  v_new_search_reason := nullif(btrim(p_search_reason), '');
  v_new_search_priority := nullif(btrim(p_search_priority), '');

  if v_new_street is null then
    raise exception 'Site street is required';
  end if;

  if v_new_house_number is null then
    raise exception 'Site house number is required';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set name = v_new_name,
      site_type = v_site_type,
      city = v_new_city,
      street = v_new_street,
      house_number = v_new_house_number,
      search_reason = v_new_search_reason,
      search_priority = case when v_site_type = 'search_site' then v_new_search_priority else search_priority end,
      search_status = case when v_site_type = 'search_site' then coalesce(search_status, 'not_started') else search_status end,
      updated_by = v_actor_id
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

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
    p_site_id,
    null,
    null,
    null,
    null,
    'site_updated',
    'operational',
    now(),
    'מערכת',
    v_actor_name,
    'אתר עודכן',
    'האתר "' || coalesce(v_new_name, v_site.name, v_new_street || ' ' || v_new_house_number) || '" עודכן על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'normal',
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', p_site_id,
      'previous_name', v_site.name,
      'new_name', v_new_name,
      'previous_site_type', v_site.site_type,
      'new_site_type', v_site_type,
      'previous_city', v_site.city,
      'new_city', v_new_city,
      'previous_street', v_site.street,
      'new_street', v_new_street,
      'previous_house_number', v_site.house_number,
      'new_house_number', v_new_house_number
    ),
    v_actor_id
  );

  perform set_config('rcc.allow_event_log_insert', 'off', true);
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    perform set_config('rcc.allow_event_log_insert', 'off', true);
    raise;
end;
$$;

revoke all on function public.update_site_safe_details(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_site_safe_details(uuid, text, text, text, text, text, text, text) to authenticated;