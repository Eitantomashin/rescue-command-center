-- Controlled site edit, cancellation and admin restore.
-- Soft-cancel only: linked operational numbers, residents, units, reports and logs remain intact.

alter table public.sites
  add column if not exists is_cancelled boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by uuid references public.profiles(id);

create index if not exists sites_active_not_cancelled_idx
  on public.sites (incident_id, site_number)
  where is_active = true and is_cancelled = false;

create index if not exists sites_cancelled_idx
  on public.sites (incident_id, cancelled_at desc)
  where is_cancelled = true;

create or replace function public.site_cancellation_reason_label(
  p_reason text,
  p_reason_other text default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select case nullif(btrim(coalesce(p_reason, '')), '')
    when 'created_by_mistake' then 'נוצר בטעות'
    when 'duplicate' then 'כפילות'
    when 'wrong_site' then 'אתר שגוי'
    when 'other' then nullif(btrim(coalesce(p_reason_other, '')), '')
    else nullif(btrim(coalesce(p_reason, '')), '')
  end
$$;

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

  if nullif(btrim(coalesce(p_street, v_site.street)), '') is null then
    raise exception 'Site street is required';
  end if;

  if nullif(btrim(coalesce(p_house_number, v_site.house_number)), '') is null then
    raise exception 'Site house number is required';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set name = nullif(btrim(p_name), ''),
      site_type = v_site_type,
      city = nullif(btrim(p_city), ''),
      street = nullif(btrim(coalesce(p_street, v_site.street)), ''),
      house_number = nullif(btrim(coalesce(p_house_number, v_site.house_number)), ''),
      search_reason = nullif(btrim(p_search_reason), ''),
      search_priority = case when v_site_type = 'search_site' then nullif(btrim(p_search_priority), '') else search_priority end,
      search_status = case when v_site_type = 'search_site' then coalesce(search_status, 'not_started') else search_status end,
      updated_by = v_actor_id
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_updated',
    'אתר עודכן',
    'האתר "' || coalesce(nullif(btrim(p_name), ''), v_site.name, v_site.street || ' ' || v_site.house_number) || '" עודכן על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'operational',
    'normal',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', p_site_id,
      'previous_name', v_site.name,
      'new_name', nullif(btrim(p_name), ''),
      'previous_site_type', v_site.site_type,
      'new_site_type', v_site_type
    )
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.cancel_site(
  p_site_id uuid,
  p_reason text,
  p_reason_other text default null
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
  v_reason text;
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
    raise exception 'Site is already cancelled';
  end if;

  v_reason := public.site_cancellation_reason_label(p_reason, p_reason_other);

  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set is_cancelled = true,
      is_active = false,
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancellation_reason = v_reason,
      restored_at = null,
      restored_by = null,
      updated_by = v_actor_id
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_cancelled',
    'אתר בוטל',
    'האתר "' || coalesce(v_site.name, v_site.street || ' ' || v_site.house_number) || '" בוטל על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '. סיבה: ' || v_reason || '.',
    'operational',
    'important',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', p_site_id,
      'site_number', v_site.site_number,
      'cancellation_reason', v_reason,
      'cancelled_at', now()
    )
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

create or replace function public.restore_cancelled_site(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
  v_actor_id uuid := public.current_actor_id();
  v_actor_name text;
begin
  perform public.assert_admin();

  select *
  into v_site
  from public.sites
  where id = p_site_id;

  if not found then
    raise exception 'Site was not found';
  end if;

  if not coalesce(v_site.is_cancelled, false) then
    raise exception 'Site is not cancelled';
  end if;

  select coalesce(nullif(btrim(display_name), ''), id::text)
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  perform set_config('rcc.allow_structure_write', 'on', true);

  update public.sites
  set is_cancelled = false,
      is_active = true,
      cancellation_reason = null,
      restored_at = now(),
      restored_by = v_actor_id,
      updated_by = v_actor_id
  where id = p_site_id;

  perform set_config('rcc.allow_structure_write', 'off', true);

  perform public.create_event_log(
    v_site.incident_id,
    'site_restored',
    'אתר שוחזר',
    'האתר "' || coalesce(v_site.name, v_site.street || ' ' || v_site.house_number) || '" שוחזר על ידי ' || coalesce(v_actor_name, 'משתמש לא ידוע') || '.',
    'operational',
    'important',
    now(),
    p_site_id,
    null,
    null,
    null,
    null,
    'מערכת',
    v_actor_name,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_name', v_actor_name,
      'site_id', p_site_id,
      'site_number', v_site.site_number,
      'restored_at', now()
    )
  );
exception
  when others then
    perform set_config('rcc.allow_structure_write', 'off', true);
    raise;
end;
$$;

grant execute on function public.update_site_safe_details(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.cancel_site(uuid, text, text) to authenticated;
grant execute on function public.restore_cancelled_site(uuid) to authenticated;
