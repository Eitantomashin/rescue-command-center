-- Fix controlled operational-number cancellation EventLog importance.
-- event_logs.importance allows only: normal, important, critical.

create or replace function public.cancel_operational_number(
  p_person_id uuid,
  p_reason text,
  p_reason_other text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.persons%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
  v_reason text;
  v_cancelled_status_id uuid;
begin
  select *
  into v_person
  from public.persons
  where id = p_person_id;

  if not found then
    raise exception 'Operational number was not found';
  end if;

  perform public.assert_edit_operational_data(v_person.incident_id);

  if v_person.is_cancelled then
    raise exception 'Operational number is already cancelled';
  end if;

  if v_person.is_merged then
    raise exception 'Merged secondary operational numbers are already inactive';
  end if;

  v_reason := case nullif(btrim(coalesce(p_reason, '')), '')
    when 'created_by_mistake' then 'נוצר בטעות'
    when 'duplicate' then 'כפילות'
    when 'opened_by_mistake' then 'נפתח בטעות'
    when 'other' then nullif(btrim(coalesce(p_reason_other, '')), '')
    else nullif(btrim(coalesce(p_reason, '')), '')
  end;

  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  select id
  into v_cancelled_status_id
  from public.status_types
  where category = 'person'
    and status_key = 'duplicate_cancelled'
    and is_active = true
    and (incident_id is null or incident_id = v_person.incident_id)
  order by incident_id desc nulls last
  limit 1;

  if v_cancelled_status_id is null then
    raise exception 'Duplicate/cancelled status is missing';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_person_operational_write', 'on', true);

  update public.persons
  set is_cancelled = true,
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancellation_reason = v_reason,
      current_status_id = v_cancelled_status_id,
      updated_by = v_actor_id
  where id = v_person.id;

  perform set_config('rcc.allow_person_operational_write', 'off', true);

  perform public.create_event_log(
    v_person.incident_id,
    'operational_number_cancelled',
    '🗑️ מספר מבצעי בוטל',
    'המספר המבצעי ' || v_person.operational_number || ' בוטל על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '. סיבה: ' || v_reason || '.',
    'operational',
    'important',
    now(),
    v_person.site_id,
    v_person.floor_id,
    v_person.unit_id,
    v_person.id,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'person_id', v_person.id,
      'operational_number', v_person.operational_number,
      'cancellation_reason', v_reason,
      'cancelled_at', now()
    )
  );
exception
  when others then
    perform set_config('rcc.allow_person_operational_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.cancel_operational_number(uuid, text, text) to authenticated;
