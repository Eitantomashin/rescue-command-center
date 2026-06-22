-- Phase 10A.1: post-meeting completion without changing immutable snapshots.

alter table public.situation_reports
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles(id);

create or replace function public.complete_situation_report_meeting(
  p_report_id uuid,
  p_commander_decisions text default null,
  p_meeting_summary text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.situation_reports%rowtype;
  v_actor_id uuid;
  v_actor_role text;
begin
  select *
  into v_report
  from public.situation_reports sr
  where sr.id = p_report_id;

  if not found then
    raise exception 'Situation report does not exist';
  end if;

  perform public.assert_incident_viewer(v_report.incident_id);
  v_actor_id := public.current_actor_id();
  v_actor_role := public.current_user_role();

  if v_actor_id is null or v_actor_role not in ('admin', 'commander') then
    raise exception 'Only an administrator or commander can complete a situation report meeting';
  end if;

  update public.situation_reports
  set
    commander_decisions = nullif(btrim(coalesce(p_commander_decisions, '')), ''),
    meeting_summary = nullif(btrim(coalesce(p_meeting_summary, '')), ''),
    updated_at = now(),
    updated_by = v_actor_id
  where id = p_report_id;
end;
$$;

comment on function public.complete_situation_report_meeting(uuid, text, text) is
  'Updates only post-meeting decisions, summary, and audit fields. The report snapshot and numbering remain immutable.';

revoke all on function public.complete_situation_report_meeting(uuid, text, text) from public, anon;
grant execute on function public.complete_situation_report_meeting(uuid, text, text) to authenticated;
