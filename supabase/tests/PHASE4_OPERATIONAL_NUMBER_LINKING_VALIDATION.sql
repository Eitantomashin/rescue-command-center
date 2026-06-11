-- Phase 4 operational number linking validation.
-- Verifies that the RPC used by the site detail UI exists with the expected signature.

select
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'link_operational_number_to_resident'
      and pg_get_function_identity_arguments(p.oid) = 'p_resident_id uuid, p_operational_number integer, p_reason text'
  ) as link_operational_number_to_resident_exists;

-- Optional manual workflow check:
-- 1. Pick an active resident id:
--    select id from public.unit_residents where is_active = true limit 1;
-- 2. Call:
--    select public.link_operational_number_to_resident('<resident-id>'::uuid, 101, 'manual validation');
-- 3. Verify the resident displays #101 and an event log was created:
--    select linked_person_id from public.unit_residents where id = '<resident-id>'::uuid;
--    select * from public.event_logs where log_type = 'person_linked_to_resident' order by created_at desc limit 1;
