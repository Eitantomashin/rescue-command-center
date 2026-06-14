-- Phase 5B operational person name/report save workflow.
--
-- Saves optional operational person name changes and appends the operational
-- report in one database transaction. Existing EventLog behavior remains in
-- the underlying functions.

create or replace function public.save_operational_report_with_person_name(
  p_person_id uuid,
  p_status_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_information_source_type text default null,
  p_information_source_name text default null,
  p_source_phone text default null,
  p_grid_cell text default null,
  p_confidence_level text default null,
  p_notes text default null,
  p_reported_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
begin
  perform public.update_operational_person_name(
    p_person_id,
    p_first_name,
    p_last_name
  );

  v_report_id := public.create_operational_report(
    p_person_id,
    p_status_id,
    p_information_source_type,
    p_information_source_name,
    p_source_phone,
    p_grid_cell,
    p_confidence_level,
    p_notes,
    p_reported_at
  );

  return v_report_id;
end;
$$;

comment on function public.save_operational_report_with_person_name(uuid, uuid, text, text, text, text, text, text, text, text, timestamptz)
  is 'Updates optional operational person name fields if changed, then appends an operational report in the same transaction.';
