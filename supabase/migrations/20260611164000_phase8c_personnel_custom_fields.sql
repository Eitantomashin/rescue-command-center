-- Phase 8C improvement: custom role/department labels for personnel records.

alter table public.unit_personnel
  add column if not exists role_other text,
  add column if not exists department_other text;

drop function if exists public.create_unit_personnel(text, text, text, text, text);
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
begin
  if public.current_actor_id() is null then
    raise exception 'Authentication required';
  end if;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
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

drop function if exists public.update_unit_personnel(uuid, text, text, text, text, text, boolean);
create or replace function public.update_unit_personnel(
  p_personnel_id uuid,
  p_first_name text,
  p_last_name text,
  p_role text,
  p_department text,
  p_mobile_phone text default null,
  p_is_active boolean default true,
  p_role_other text default null,
  p_department_other text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  if public.current_actor_id() is null then
    raise exception 'Authentication required';
  end if;

  v_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name := nullif(btrim(coalesce(p_last_name, '')), '');

  if v_first_name is null then
    raise exception 'First name is required';
  end if;

  if v_last_name is null then
    raise exception 'Last name is required';
  end if;

  update public.unit_personnel
  set
    first_name = v_first_name,
    last_name = v_last_name,
    role = p_role,
    department = p_department,
    mobile_phone = nullif(btrim(coalesce(p_mobile_phone, '')), ''),
    role_other = case when p_role = 'other' then nullif(btrim(coalesce(p_role_other, '')), '') else null end,
    department_other = case when p_department = 'other' then nullif(btrim(coalesce(p_department_other, '')), '') else null end,
    is_active = coalesce(p_is_active, true)
  where id = p_personnel_id;

  if not found then
    raise exception 'Personnel record not found';
  end if;
end;
$$;
