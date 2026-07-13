-- Enterprise User Management UX support.
-- Additive-only: user status and soft deletion metadata on profiles.

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles(id),
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

create index if not exists profiles_user_status_idx
  on public.profiles (role, is_active)
  where deleted_at is null;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p.role
    when 'system_administrator' then 'admin'
    when 'incident_commander' then 'commander'
    when 'command_post_operator' then 'editor'
    when 'observer' then 'viewer'
    else p.role
  end
  from public.profiles p
  where p.id = public.current_actor_id()
    and coalesce(p.is_active, true) = true
    and p.deleted_at is null
$$;

drop function if exists public.list_user_profiles();
create function public.list_user_profiles()
returns table (
  id uuid,
  display_name text,
  email text,
  role text,
  is_active boolean,
  deactivated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_manage_users();

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    case p.role
      when 'system_administrator' then 'admin'
      when 'incident_commander' then 'commander'
      when 'command_post_operator' then 'editor'
      when 'observer' then 'viewer'
      else p.role
    end as role,
    coalesce(p.is_active, true) as is_active,
    p.deactivated_at,
    p.deleted_at,
    p.created_at,
    u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.deleted_at is null
  order by p.created_at desc;
end;
$$;

grant execute on function public.list_user_profiles() to authenticated;
