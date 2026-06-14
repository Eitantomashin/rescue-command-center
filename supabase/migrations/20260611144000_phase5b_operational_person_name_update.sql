create or replace function public.update_operational_person_name(
  p_person_id uuid,
  p_first_name text default null,
  p_last_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_old_first_name text;
  v_old_last_name text;
  v_new_first_name text;
  v_new_last_name text;
  v_old_name text;
  v_new_name text;
begin
  if p_person_id is null then
    raise exception 'Operational person is required';
  end if;

  select * into v_person
  from public.persons
  where id = p_person_id
  for update;

  if not found then
    raise exception 'Operational person % does not exist', p_person_id;
  end if;

  perform public.assert_incident_writable(v_person.incident_id, 'update_operational_person_name');

  if v_person.is_merged then
    raise exception 'Merged operational numbers cannot be renamed';
  end if;

  v_old_first_name := v_person.first_name;
  v_old_last_name := v_person.last_name;
  v_new_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_new_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_old_first_name is not distinct from v_new_first_name
    and v_old_last_name is not distinct from v_new_last_name
  then
    return;
  end if;

  v_old_name := coalesce(
    nullif(btrim(concat_ws(' ', v_old_first_name, v_old_last_name)), ''),
    'שם לא ידוע'
  );

  v_new_name := coalesce(
    nullif(btrim(concat_ws(' ', v_new_first_name, v_new_last_name)), ''),
    'שם לא ידוע'
  );

  update public.persons
  set
    first_name = v_new_first_name,
    last_name = v_new_last_name,
    updated_by = public.current_actor_id()
  where id = v_person.id;

  perform public.create_event_log(
    v_person.incident_id,
    'operational_person_name_updated',
    'עדכון שם אדם מבצעי',
    '#' || v_person.operational_number || ': ' || v_old_name || ' → ' || v_new_name,
    'operational',
    'normal',
    now(),
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    null,
    'RCC',
    'RCC',
    jsonb_build_object(
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'old_first_name', v_old_first_name,
      'old_last_name', v_old_last_name,
      'new_first_name', v_new_first_name,
      'new_last_name', v_new_last_name,
      'old_name', v_old_name,
      'new_name', v_new_name
    )
  );
end;
$$;

comment on function public.update_operational_person_name(uuid, text, text)
  is 'Updates optional operational person name fields and appends an immutable EventLog row.';
