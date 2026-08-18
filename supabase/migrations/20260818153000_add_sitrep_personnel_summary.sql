-- Add structured personnel summary to new situation-report snapshots.
-- Historical situation_reports rows remain immutable and are not recomputed.

create or replace function public.create_situation_report(
  p_incident_id uuid,
  p_commander_decisions text default null,
  p_meeting_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_report_id uuid;
  v_report_number integer;
  v_snapshot jsonb;
begin
  perform public.assert_incident_viewer(p_incident_id);

  v_actor_id := public.current_actor_id();
  v_actor_role := public.current_user_role();

  if v_actor_id is null or v_actor_role not in ('admin', 'commander') then
    raise exception 'Only an administrator or commander can create a situation report';
  end if;

  if not exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and i.archived_at is null
  ) then
    raise exception 'Situation reports can be created only for active incidents';
  end if;

  -- Serialize numbering for this incident. A report number is never reused.
  perform pg_advisory_xact_lock(hashtextextended(p_incident_id::text, 0));

  select coalesce(max(sr.report_number), 0) + 1
  into v_report_number
  from public.situation_reports sr
  where sr.incident_id = p_incident_id;

  select jsonb_build_object(
    'schema_version', 2,
    'captured_at', now(),
    'incident', jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'incident_type', i.incident_type,
      'city', i.city,
      'address', i.address,
      'opened_at', i.opened_at,
      'is_closed', i.is_closed,
      'status_key', incident_status.status_key,
      'status_label', incident_status.hebrew_label
    ),
    'author', jsonb_build_object(
      'id', v_actor_id,
      'display_name', coalesce(nullif(btrim(p.display_name), ''), 'Unknown')
    ),
    'summary', coalesce((
      select to_jsonb(ids)
      from public.incident_dashboard_summary ids
      where ids.incident_id = p_incident_id
    ), '{}'::jsonb),
    'sites', coalesce((
      select jsonb_agg(to_jsonb(sds) order by sds.site_number)
      from public.site_dashboard_summary sds
      where sds.incident_id = p_incident_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'team_number', t.team_number,
          'name', t.name,
          'commander_name', t.commander_name,
          'personnel_count', t.personnel_count,
          'is_active', t.is_active,
          'assignments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'site_id', tsa.site_id,
              'assignment_status', tsa.assignment_status,
              'assigned_at', tsa.assigned_at
            ) order by tsa.assigned_at)
            from public.team_site_assignments tsa
            where tsa.team_id = t.id
          ), '[]'::jsonb)
        ) order by t.team_number
      )
      from public.teams t
      where t.incident_id = p_incident_id
        and t.is_active = true
    ), '[]'::jsonb),
    'operational_numbers', coalesce((
      select jsonb_agg(
        to_jsonb(ond) || jsonb_build_object(
          'site_name', coalesce(nullif(btrim(s.name), ''), concat('Site ', s.site_number))
        ) order by ond.operational_number
      )
      from public.operational_numbers_dashboard ond
      left join public.sites s on s.id = ond.site_id
      where ond.incident_id = p_incident_id
        and ond.is_merged = false
    ), '[]'::jsonb),
    'personnel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'personnel_id', eps.personnel_id,
        'first_name', up.first_name,
        'last_name', up.last_name,
        'role', up.role,
        'role_other', up.role_other,
        'department', up.department,
        'department_other', up.department_other,
        'attendance_status', eps.attendance_status,
        'updated_at', eps.updated_at
      ) order by up.last_name, up.first_name)
      from public.event_personnel_status eps
      join public.unit_personnel up on up.id = eps.personnel_id
      where eps.incident_id = p_incident_id
    ), '[]'::jsonb),
    'personnel_summary', coalesce((
      with unit_present as (
        select
          'unit:' || up.id::text as person_key,
          case when up.department is not null then 'department:' || up.department || ':' || coalesce(up.department_other, '') else null end as team_key,
          null::uuid as team_id,
          case
            when up.department = 'headquarters' then 'מטה'
            when up.department = 'logistics' then 'לוגיסטיקה'
            when up.department = 'population' then 'אוכלוסייה'
            when up.department = 'command_post' then 'חפ״ק'
            when up.department = 'medical' then 'רפואה'
            when up.department = 'team_1' then 'צוות 1'
            when up.department = 'team_2' then 'צוות 2'
            when up.department = 'team_3' then 'צוות 3'
            when up.department = 'team_4' then 'צוות 4'
            when up.department = 'other' and nullif(btrim(coalesce(up.department_other, '')), '') is not null then btrim(up.department_other)
            when up.department is not null then up.department
            else null
          end as team_name,
          'unit'::text as source_type
        from public.event_personnel_status eps
        join public.unit_personnel up on up.id = eps.personnel_id
        where eps.incident_id = p_incident_id
          and eps.attendance_status = 'present'
          and up.is_active = true
      ),
      manual_present as (
        select
          'manual:' || imp.id::text as person_key,
          case when imp.organic_team_id is not null then 'team:' || imp.organic_team_id::text else null end as team_key,
          imp.organic_team_id as team_id,
          case when imp.organic_team_id is not null then coalesce(nullif(btrim(t.name), ''), 'צוות ' || t.team_number::text) else null end as team_name,
          'manual'::text as source_type
        from public.incident_manual_personnel imp
        left join public.teams t on t.id = imp.organic_team_id and t.incident_id = p_incident_id and t.is_active = true
        where imp.incident_id = p_incident_id
          and imp.is_active = true
          and imp.attendance_status = 'present'
      ),
      present_people as (
        select * from unit_present
        union all
        select * from manual_present
      ),
      active_ad_hoc_teams as (
        select aht.id, aht.name
        from public.incident_ad_hoc_teams aht
        where aht.incident_id = p_incident_id
          and aht.status = 'active'
      ),
      active_ad_hoc_members as (
        select
          ahm.ad_hoc_team_id,
          aht.name as ad_hoc_team_name,
          pp.person_key
        from public.incident_ad_hoc_team_members ahm
        join active_ad_hoc_teams aht on aht.id = ahm.ad_hoc_team_id
        join present_people pp on (
          (ahm.unit_personnel_id is not null and pp.person_key = 'unit:' || ahm.unit_personnel_id::text)
          or
          (ahm.manual_personnel_id is not null and pp.person_key = 'manual:' || ahm.manual_personnel_id::text)
        )
        where ahm.incident_id = p_incident_id
          and ahm.is_active = true
      ),
      organic_team_counts as (
        select team_key, team_id, team_name, count(distinct person_key)::integer as present_count
        from present_people
        where team_key is not null
        group by team_key, team_id, team_name
      ),
      ad_hoc_team_counts as (
        select ad_hoc_team_id, ad_hoc_team_name, count(distinct person_key)::integer as present_count
        from active_ad_hoc_members
        group by ad_hoc_team_id, ad_hoc_team_name
      )
      select jsonb_build_object(
        'uniquePresentTotal', (select count(distinct person_key)::integer from present_people),
        'manuallyAddedPresentCount', (select count(distinct person_key)::integer from present_people where source_type = 'manual'),
        'adHocAssignedPresentCount', (select count(distinct person_key)::integer from active_ad_hoc_members),
        'unassignedPresentCount', (
          select count(distinct pp.person_key)::integer
          from present_people pp
          where pp.team_key is null
            and not exists (
              select 1 from active_ad_hoc_members ahm where ahm.person_key = pp.person_key
            )
        ),
        'organicTeams', coalesce((
          select jsonb_agg(jsonb_build_object(
            'teamKey', otc.team_key,
            'teamId', otc.team_id,
            'teamName', otc.team_name,
            'presentCount', otc.present_count
          ) order by otc.team_name)
          from organic_team_counts otc
        ), '[]'::jsonb),
        'adHocTeams', coalesce((
          select jsonb_agg(jsonb_build_object(
            'teamId', ahtc.ad_hoc_team_id,
            'teamName', ahtc.ad_hoc_team_name,
            'presentCount', ahtc.present_count
          ) order by ahtc.ad_hoc_team_name)
          from ad_hoc_team_counts ahtc
          where ahtc.present_count > 0
        ), '[]'::jsonb)
      )
    ), jsonb_build_object(
      'uniquePresentTotal', 0,
      'manuallyAddedPresentCount', 0,
      'adHocAssignedPresentCount', 0,
      'unassignedPresentCount', 0,
      'organicTeams', '[]'::jsonb,
      'adHocTeams', '[]'::jsonb
    )),
    'map_objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', smo.id,
        'site_id', smo.site_id,
        'object_type', smo.object_type,
        'name', smo.name,
        'assigned_team_number', smo.assigned_team_number,
        'operational_status', smo.operational_status
      ) order by smo.created_at)
      from public.site_map_objects smo
      where smo.incident_id = p_incident_id
        and smo.is_active = true
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.incidents i
  join public.status_types incident_status on incident_status.id = i.status_id
  join public.profiles p on p.id = v_actor_id
  where i.id = p_incident_id;

  if v_snapshot is null then
    raise exception 'Incident snapshot could not be created';
  end if;

  insert into public.situation_reports (
    incident_id,
    report_number,
    snapshot,
    commander_decisions,
    meeting_summary,
    created_by
  ) values (
    p_incident_id,
    v_report_number,
    v_snapshot,
    nullif(btrim(coalesce(p_commander_decisions, '')), ''),
    nullif(btrim(coalesce(p_meeting_summary, '')), ''),
    v_actor_id
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

comment on function public.create_situation_report(uuid, text, text) is
  'Creates the next sequential situation report and captures operational source data, including structured personnel summary, in one transaction.';

revoke all on function public.create_situation_report(uuid, text, text) from public, anon;
grant execute on function public.create_situation_report(uuid, text, text) to authenticated;
