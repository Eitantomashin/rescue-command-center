-- Phase 8A fix: approved write path for site grid image references.
-- This updates only image reference fields and preserves the structural write guard.

create or replace function public.update_site_grid_image(
  p_site_id uuid,
  p_image_path text,
  p_image_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_image_path text;
  v_image_name text;
begin
  select *
  into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site not found';
  end if;

  perform public.assert_incident_writable(v_site.incident_id, 'update_site_grid_image');

  v_image_path := nullif(btrim(coalesce(p_image_path, '')), '');
  v_image_name := nullif(btrim(coalesce(p_image_name, '')), '');

  if v_image_path is null then
    raise exception 'Image path is required';
  end if;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set
    image_data_url = v_image_path,
    image_name = coalesce(v_image_name, image_name)
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_grid_image_updated',
    'עדכון תמונת תא שטח',
    'עודכנה תמונת תא שטח לאתר',
    'operational',
    'normal',
    now(),
    v_site.id,
    null,
    null,
    null,
    null,
    'מערכת',
    null,
    jsonb_build_object(
      'site_id', v_site.id,
      'site_number', v_site.site_number,
      'site_name', coalesce(v_site.name, concat(v_site.street, ' ', v_site.house_number)),
      'old_image_path', v_site.image_data_url,
      'new_image_path', v_image_path,
      'image_name', v_image_name
    )
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

comment on function public.update_site_grid_image(uuid, text, text)
  is 'Approved write path for updating a site grid/aerial image reference. Updates only image reference fields and appends an immutable EventLog.';
