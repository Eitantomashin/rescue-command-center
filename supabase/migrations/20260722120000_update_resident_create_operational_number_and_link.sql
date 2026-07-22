-- Extend the create-and-link workflow to update resident details in the same transaction.

drop function if exists public.create_operational_number_and_link_resident(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
);

create or replace function public.create_operational_number_and_link_resident(
  p_incident_id uuid,
  p_site_id uuid,
  p_resident_id uuid,
  p_team_number integer,
  p_operational_number integer,
  p_status_id uuid default null,
  p_information_source_type text default 'חפ"ק',
  p_information_source_name text default null,
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default 'לא ידוע',
  p_reported_at timestamptz default now(),
  p_resident_first_name text default null,
  p_resident_last_name text default null,
  p_resident_age integer default null,
  p_resident_phone text default null,
  p_resident_status_id uuid default null,
  p_resident_notes text default null,
  p_resident_gender text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_person_id uuid;
begin
  if p_incident_id is null then
    raise exception 'Incident is required';
  end if;

  if p_site_id is null then
    raise exception 'Site is required';
  end if;

  if p_resident_id is null then
    raise exception 'Resident is required';
  end if;

  select *
  into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  if not v_resident.is_active then
    raise exception 'Inactive residents cannot be linked to operational persons';
  end if;

  if v_resident.incident_id <> p_incident_id or v_resident.site_id <> p_site_id then
    raise exception 'Resident does not belong to the requested incident and site';
  end if;

  if v_resident.linked_person_id is not null then
    raise exception 'Resident is already linked to an operational number';
  end if;

  perform public.assert_incident_writable(p_incident_id, 'update_unit_resident');
  perform public.assert_incident_writable(p_incident_id, 'create_operational_number');
  perform public.assert_incident_writable(p_incident_id, 'link_person_to_resident');

  perform public.update_unit_resident(
    p_resident_id,
    p_resident_first_name,
    p_resident_last_name,
    p_resident_age,
    p_resident_phone,
    p_resident_status_id,
    p_resident_notes,
    p_resident_gender
  );

  v_person_id := public.create_operational_number(
    p_incident_id,
    p_site_id,
    p_team_number,
    p_operational_number,
    p_status_id,
    null,
    null,
    null,
    p_information_source_type,
    p_information_source_name,
    p_source_phone,
    p_grid_cell,
    p_confidence_level,
    p_reported_at
  );

  perform public.link_person_to_resident(
    v_person_id,
    p_resident_id,
    'יצירת מספר מבצעי חדש מתוך עדכון דייר'
  );

  return jsonb_build_object(
    'person_id', v_person_id,
    'resident_id', p_resident_id,
    'operational_number', p_operational_number
  );
end;
$$;

revoke all on function public.create_operational_number_and_link_resident(uuid, uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, integer, text, uuid, text, text) from public, anon;
grant execute on function public.create_operational_number_and_link_resident(uuid, uuid, uuid, integer, integer, uuid, text, text, text, text, text, timestamptz, text, text, integer, text, uuid, text, text) to authenticated;
