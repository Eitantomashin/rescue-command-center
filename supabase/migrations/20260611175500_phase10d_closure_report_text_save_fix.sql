-- Phase 10D closure report text save fix.
-- Closure report command summary / lessons learned are post-closure completion
-- fields. Saving them must remain possible for admins/commanders after an
-- incident is closed, without weakening general closed-incident EventLog rules.

create or replace function public.update_closure_report_text(
  p_report_id uuid,
  p_command_summary text,
  p_lessons_learned text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.closure_reports%rowtype;
begin
  select * into v_report
  from public.closure_reports
  where id = p_report_id;

  if not found then
    raise exception 'Closure report does not exist';
  end if;

  perform public.assert_control_incident_lifecycle(v_report.incident_id);

  update public.closure_reports
  set command_summary = nullif(btrim(coalesce(p_command_summary, '')), ''),
      lessons_learned = nullif(btrim(coalesce(p_lessons_learned, '')), ''),
      updated_by = public.current_actor_id(),
      updated_at = now()
  where id = p_report_id;
end;
$$;

grant execute on function public.update_closure_report_text(uuid, text, text) to authenticated;
