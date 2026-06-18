-- Phase 8C: duplicate protection for manual personnel creation.
-- Existing duplicate rows are preserved; this only prevents future duplicate creates.

create or replace function public.create_unit_personnel(
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null,
  p_role_other text default null,
  p_department_other text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_last_name text;
  v_mobile_phone text;
begin
  if public.current_actor_id() is null then
    raise exception 'Authentication required';
  end if;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  v_mobile_phone := nullif(regexp_replace(coalesce(p_mobile_phone, ''), '[^\d+]', '', 'g'), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  if v_mobile_phone is not null and exists (
    select 1
    from public.unit_personnel up
    where nullif(regexp_replace(coalesce(up.mobile_phone, ''), '[^\d+]', '', 'g'), '') = v_mobile_phone
  ) then
    raise exception 'האדם כבר קיים ברשימת כ"א';
  end if;

  if v_mobile_phone is null and exists (
    select 1
    from public.unit_personnel up
    where lower(btrim(up.first_name)) = lower(v_first_name)
      and lower(btrim(up.last_name)) = lower(v_last_name)
  ) then
    raise exception 'האדם כבר קיים ברשימת כ"א';
  end if;

  insert into public.unit_personnel (
    first_name,
    last_name,
    role,
    department,
    mobile_phone,
    role_other,
    department_other,
    created_by
  )
  values (
    v_first_name,
    v_last_name,
    p_role,
    p_department,
    nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    case when p_role = 'other' then nullif(btrim(coalesce(p_role_other, '')), '') else null end,
    case when p_department = 'other' then nullif(btrim(coalesce(p_department_other, '')), '') else null end,
    public.current_actor_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;
