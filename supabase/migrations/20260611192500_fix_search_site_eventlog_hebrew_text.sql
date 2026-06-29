-- Fix Search Site EventLog Hebrew text for future log entries.
-- Existing immutable EventLogs are not rewritten; the UI applies a safe display repair for legacy mojibake rows.

create or replace function public.search_unit_event_text(p_status text)
returns table(log_type text, title text, description text, importance text)
language sql
stable
set search_path = public
as $$
  select
    case
      when p_status = 'no_answer' then 'search_unit_no_answer'
      when p_status = 'casualties' then 'search_unit_casualties_found'
      when p_status = 'completed' then 'search_unit_completed'
      else 'search_unit_apartment_searched'
    end,
    case
      when p_status = 'no_answer' then U&'\05D0\05D9\05DF \05DE\05E2\05E0\05D4 \05D1\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4'
      when p_status = 'casualties' then U&'\05D3\05D5\05D5\05D7\05D5 \05E0\05E4\05D2\05E2\05D9\05DD \05D1\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4'
      when p_status = 'completed' then U&'\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4 \05D4\05D5\05E9\05DC\05DE\05D4'
      else U&'\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4 \05E0\05D1\05D3\05E7\05D4'
    end,
    case
      when p_status = 'no_answer' then U&'\05D4\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05DC\05DC\05D0 \05DE\05E2\05E0\05D4'
      when p_status = 'casualties' then U&'\05D4\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05E2\05DD \05D3\05D9\05D5\05D5\05D7 \05E0\05E4\05D2\05E2\05D9\05DD'
      when p_status = 'completed' then U&'\05D4\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D5\05E9\05DC\05DE\05D4'
      else U&'\05E2\05D5\05D3\05DB\05E0\05D5 \05E4\05E8\05D8\05D9 \05E1\05E8\05D9\05E7\05EA \05D3\05D9\05E8\05D4'
    end,
    case
      when p_status = 'casualties' then 'important'
      else 'normal'
    end;
$$;

create or replace function public.complete_search_unit(
  p_site_id uuid,
  p_unit_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_unit public.units%rowtype;
  v_id uuid;
  v_previous public.site_search_units%rowtype;
begin
  select * into v_site from public.sites where id = p_site_id;
  if not found then
    raise exception 'Search Site not found';
  end if;

  if v_site.site_type <> 'search_site' then
    raise exception 'Search unit results can only be completed for Search Sites';
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'complete_search_unit');

  select * into v_unit from public.units where id = p_unit_id;
  if not found then
    raise exception 'Unit not found';
  end if;

  if v_unit.site_id <> p_site_id or v_unit.incident_id <> v_site.incident_id then
    raise exception 'Unit must belong to the selected Search Site';
  end if;

  select * into v_previous
  from public.site_search_units
  where site_id = p_site_id and unit_id = p_unit_id;

  insert into public.site_search_units (
    incident_id,
    site_id,
    unit_id,
    search_status,
    searched_by,
    searched_at,
    completed_at
  )
  values (
    v_site.incident_id,
    p_site_id,
    p_unit_id,
    'completed',
    public.current_actor_id(),
    now(),
    now()
  )
  on conflict (site_id, unit_id) do update
  set
    search_status = 'completed',
    searched_by = public.current_actor_id(),
    searched_at = now(),
    completed_at = now()
  returning id into v_id;

  perform public.create_event_log(
    v_site.incident_id,
    'search_unit_completed',
    U&'\05D3\05D9\05E8\05D4 \05D1\05E1\05E8\05D9\05E7\05D4 \05D4\05D5\05E9\05DC\05DE\05D4',
    U&'\05D4\05D3\05D9\05E8\05D4 \05E1\05D5\05DE\05E0\05D4 \05DB\05D4\05D5\05E9\05DC\05DE\05D4',
    'operational',
    'normal',
    now(),
    v_site.id,
    v_unit.floor_id,
    v_unit.id,
    null,
    null,
    U&'\05DE\05E2\05E8\05DB\05EA',
    null,
    jsonb_build_object(
      'search_unit_id', v_id,
      'site_id', v_site.id,
      'unit_id', v_unit.id,
      'old_search_status', v_previous.search_status,
      'new_search_status', 'completed'
    )
  );

  return v_id;
end;
$$;

grant execute on function public.complete_search_unit(uuid, uuid) to authenticated;
