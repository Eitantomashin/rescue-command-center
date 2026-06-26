-- Search Site Phase 2: add an approved RPC for creating Search Sites.
-- Rescue Site creation continues to use the existing create_site_from_wizard
-- RPC unchanged. This wrapper reuses the existing floor/unit/resident/team
-- creation path and then records Search Site metadata on public.sites.

create or replace function public.create_search_site_from_wizard(
  p_incident_id uuid,
  p_site_name text,
  p_street text,
  p_house_number text,
  p_city text default null,
  p_structure_type text default null,
  p_structure_description text default null,
  p_damage_severity text default null,
  p_image_name text default null,
  p_image_data_url text default null,
  p_lowest_level integer default 0,
  p_highest_level integer default 0,
  p_zones jsonb default '[]'::jsonb,
  p_teams jsonb default '[]'::jsonb,
  p_parent_site_id uuid default null,
  p_search_reason text default null,
  p_search_priority text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_parent_site public.sites%rowtype;
  v_search_reason text := nullif(btrim(coalesce(p_search_reason, '')), '');
  v_search_priority text := nullif(btrim(coalesce(p_search_priority, '')), '');
begin
  if p_parent_site_id is not null then
    select *
    into v_parent_site
    from public.sites
    where id = p_parent_site_id
      and incident_id = p_incident_id
      and site_type = 'rescue_site'
      and is_active = true;

    if not found then
      raise exception 'Parent rescue site does not exist in this incident';
    end if;
  end if;

  v_site_id := public.create_site_from_wizard(
    p_incident_id,
    p_site_name,
    p_street,
    p_house_number,
    p_city,
    p_structure_type,
    p_structure_description,
    p_damage_severity,
    p_image_name,
    p_image_data_url,
    p_lowest_level,
    p_highest_level,
    p_zones,
    p_teams
  );

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set
    site_type = 'search_site',
    parent_site_id = p_parent_site_id,
    search_status = 'not_started',
    search_reason = v_search_reason,
    search_priority = v_search_priority,
    search_completed_at = null,
    updated_by = public.current_actor_id()
  where id = v_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  return v_site_id;
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

comment on function public.create_search_site_from_wizard(uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb, jsonb, uuid, text, text)
  is 'Creates a Search Site by reusing the existing Phase 6A site wizard creation path, then records Search Site metadata on public.sites.';
