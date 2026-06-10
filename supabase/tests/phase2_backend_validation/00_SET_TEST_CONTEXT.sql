-- Phase 2 Backend Validation
-- Run this first in the same SQL session, then run the numbered scripts.
--
-- Replace the UUID below with an existing Supabase auth.users.id that also has
-- a matching public.profiles row. A system_administrator profile is easiest.

select set_config(
  'rcc.test_user_id',
  '00000000-0000-0000-0000-000000000000',
  false
);

select set_config(
  'rcc.sql_editor_validation_mode',
  'on',
  false
);

do $$
declare
  v_test_user_id uuid;
begin
  v_test_user_id := nullif(current_setting('rcc.test_user_id', true), '')::uuid;

  if v_test_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Edit 00_SET_TEST_CONTEXT.sql and set rcc.test_user_id to a real auth.users.id';
  end if;

  if not exists (select 1 from public.profiles where id = v_test_user_id) then
    raise exception 'No public.profiles row exists for user %', v_test_user_id;
  end if;

  if not public.sql_editor_validation_mode_enabled() then
    raise exception 'SQL Editor validation mode was not enabled';
  end if;

  raise notice 'SQL Editor validation context ready for user %', v_test_user_id;
end;
$$;

select
  public.current_actor_id() as active_validation_actor_id,
  p.role as profile_role
from public.profiles p
where p.id = public.current_actor_id();
