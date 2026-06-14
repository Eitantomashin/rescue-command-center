-- Phase 5B resident details-only update hardening.
--
-- The building view may edit resident identity/details and links only.
-- Resident status changes are no longer performed through update_unit_resident.

create or replace function public.update_unit_resident(
  p_resident_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_age integer default null,
  p_phone text default null,
  p_status_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.unit_residents%rowtype;
  v_unit public.units%rowtype;
  v_site_id uuid;
  v_floor_id uuid;
  v_unit_id uuid;
  v_context text;
  v_old_name text;
  v_new_first_name text;
  v_new_last_name text;
  v_new_phone text;
  v_new_notes text;
  v_new_name text;
  v_old_is_placeholder boolean;
  v_new_is_real_name boolean;
  v_non_status_changed boolean;
  v_details_description text;
begin
  select * into v_resident
  from public.unit_residents
  where id = p_resident_id
  for update;

  if not found then
    raise exception 'Resident % does not exist', p_resident_id;
  end if;

  if p_age is not null and p_age < 0 then
    raise exception 'Resident age cannot be negative';
  end if;

  perform public.assert_incident_writable(v_resident.incident_id, 'update_unit_resident');

  if v_resident.unit_id is not null then
    select * into v_unit
    from public.units
    where id = v_resident.unit_id;

    if not found then
      raise exception 'Resident unit % does not exist', v_resident.unit_id;
    end if;

    v_site_id := v_unit.site_id;
    v_floor_id := v_unit.floor_id;
    v_unit_id := v_unit.id;
  else
    v_site_id := v_resident.site_id;
    v_floor_id := null;
    v_unit_id := null;
  end if;

  v_context := public.resident_event_context(v_site_id, v_floor_id, v_unit_id);
  v_new_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_new_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  v_new_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_new_notes := nullif(btrim(coalesce(p_notes, '')), '');

  v_old_name := coalesce(
    nullif(btrim(concat_ws(' ', v_resident.first_name, v_resident.last_name)), ''),
    'דייר ללא שם'
  );
  v_new_name := coalesce(
    nullif(btrim(concat_ws(' ', v_new_first_name, v_new_last_name)), ''),
    v_old_name
  );
  v_old_is_placeholder := v_resident.last_name is null
    and coalesce(v_resident.first_name, '') ~ '^דייר [0-9]+$';
  v_new_is_real_name := not (v_new_name ~ '^דייר [0-9]+$' or v_new_name = 'דייר ללא שם');

  v_non_status_changed :=
    v_resident.first_name is distinct from v_new_first_name
    or v_resident.last_name is distinct from v_new_last_name
    or v_resident.age is distinct from p_age
    or v_resident.phone is distinct from v_new_phone
    or v_resident.notes is distinct from v_new_notes;

  update public.unit_residents
  set
    first_name = v_new_first_name,
    last_name = v_new_last_name,
    age = p_age,
    phone = v_new_phone,
    status_id = v_resident.status_id,
    notes = v_new_notes,
    updated_by = public.current_actor_id()
  where id = v_resident.id;

  if v_non_status_changed then
    v_details_description := v_context || case
      when v_old_is_placeholder and v_new_is_real_name then v_old_name || ' → ' || v_new_name
      else 'עודכנו פרטי הדייר ' || v_new_name
    end;

    if p_age is distinct from v_resident.age and p_age is not null then
      v_details_description := v_details_description || ' (גיל ' || p_age || ')';
    end if;

    perform public.create_event_log(
      v_resident.incident_id,
      'unit_resident_updated',
      'עדכון פרטי דייר',
      v_details_description,
      'operational',
      'normal',
      now(),
      v_site_id,
      v_floor_id,
      v_unit_id,
      v_resident.linked_person_id,
      null,
      'ui',
      null,
      jsonb_build_object(
        'resident_id', v_resident.id,
        'linked_person_id', v_resident.linked_person_id,
        'old_first_name', v_resident.first_name,
        'old_last_name', v_resident.last_name,
        'new_first_name', v_new_first_name,
        'new_last_name', v_new_last_name,
        'old_age', v_resident.age,
        'new_age', p_age,
        'old_phone', v_resident.phone,
        'new_phone', v_new_phone,
        'old_notes', v_resident.notes,
        'new_notes', v_new_notes,
        'status_preserved', true,
        'preserved_status_id', v_resident.status_id
      )
    );
  end if;
end;
$$;

comment on function public.update_unit_resident(uuid, text, text, integer, text, uuid, text)
  is 'Updates resident identity/details only. Resident status_id is preserved; operational status changes happen through operational reports.';
