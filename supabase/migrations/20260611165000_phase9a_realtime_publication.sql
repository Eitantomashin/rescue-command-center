-- Phase 9A: enable Supabase Realtime for operational source tables.
-- Views such as operational_report_history are refreshed through their source tables.

do $$
declare
  v_table text;
  v_tables text[] := array[
    'operational_reports',
    'event_logs',
    'event_personnel_status',
    'site_map_objects',
    'team_site_assignments',
    'sites',
    'unit_residents',
    'units'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
