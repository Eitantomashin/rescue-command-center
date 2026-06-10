-- Phase 2.1 Admin Bootstrap
--
-- Purpose:
-- Promote an existing Supabase Auth user to public.profiles.role = system_administrator.
--
-- How to use:
-- 1. Create/sign up the first user in Supabase Auth.
-- 2. Copy that user's auth.users.id.
-- 3. Replace the UUID below.
-- 4. Run this script in Supabase SQL Editor.
--
-- This script does not create an auth.users row. Create the user through Supabase Auth first.

do $$
declare
  v_admin_user_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace v_admin_user_id with a real auth.users.id before running this script';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = v_admin_user_id
  ) then
    raise exception 'No auth.users row exists for %', v_admin_user_id;
  end if;

  insert into public.profiles (
    id,
    display_name,
    role
  )
  values (
    v_admin_user_id,
    'System Administrator',
    'system_administrator'
  )
  on conflict (id) do update
  set
    role = 'system_administrator',
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  raise notice 'User % is now system_administrator', v_admin_user_id;
end;
$$;

select
  p.id,
  p.display_name,
  p.role,
  p.created_at,
  p.updated_at
from public.profiles p
where p.role = 'system_administrator'
order by p.updated_at desc;
