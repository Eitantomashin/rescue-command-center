-- Stage 10.1A.1: בדיקת שלמות לקריאה בלבד של צוותי אד־הוק.
-- מיועד להרצה ידנית ב-Supabase SQL Editor. אין בקובץ פעולות כתיבה.
-- כל section מחזיר רק מזהים ונתוני תפעול הכרחיים; מספרי טלפון אינם נחשפים.

-- A. אנשי כוח אדם עם יותר משיוך אד־הוק פעיל אחד באותו אירוע.
with active_members as (
  select
    m.incident_id,
    'unit_personnel'::text as source_type,
    m.unit_personnel_id as person_id,
    m.ad_hoc_team_id
  from public.incident_ad_hoc_team_members m
  join public.incident_ad_hoc_teams t
    on t.id = m.ad_hoc_team_id
   and t.incident_id = m.incident_id
  where m.is_active
    and t.status = 'active'
    and m.unit_personnel_id is not null

  union all

  select
    m.incident_id,
    'manual_personnel'::text as source_type,
    m.manual_personnel_id as person_id,
    m.ad_hoc_team_id
  from public.incident_ad_hoc_team_members m
  join public.incident_ad_hoc_teams t
    on t.id = m.ad_hoc_team_id
   and t.incident_id = m.incident_id
  where m.is_active
    and t.status = 'active'
    and m.manual_personnel_id is not null
)
select
  'A'::text as check_code,
  'שיוכים פעילים כפולים'::text as check_name,
  incident_id,
  source_type,
  person_id,
  count(*)::integer as assignment_count,
  array_agg(ad_hoc_team_id order by ad_hoc_team_id) as ad_hoc_team_ids
from active_members
group by incident_id, source_type, person_id
having count(*) > 1
order by incident_id, source_type, person_id;

-- B. חברויות פעילות שבהן סטטוס הנוכחות אינו present, לרבות סטטוס חסר.
select
  'B'::text as check_code,
  'חברות פעילה ללא נוכחות'::text as check_name,
  m.id as membership_id,
  m.incident_id,
  m.ad_hoc_team_id,
  t.status as team_status,
  'unit_personnel'::text as source_type,
  m.unit_personnel_id as person_id,
  coalesce(eps.attendance_status, 'missing') as attendance_status
from public.incident_ad_hoc_team_members m
left join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
left join public.event_personnel_status eps
  on eps.incident_id = m.incident_id
 and eps.personnel_id = m.unit_personnel_id
where m.is_active
  and m.unit_personnel_id is not null
  and coalesce(eps.attendance_status, 'missing') <> 'present'

union all

select
  'B'::text,
  'חברות פעילה ללא נוכחות'::text,
  m.id,
  m.incident_id,
  m.ad_hoc_team_id,
  t.status,
  'manual_personnel'::text,
  m.manual_personnel_id,
  coalesce(imp.attendance_status, 'missing')
from public.incident_ad_hoc_team_members m
left join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
left join public.incident_manual_personnel imp
  on imp.id = m.manual_personnel_id
 and imp.incident_id = m.incident_id
where m.is_active
  and m.manual_personnel_id is not null
  and coalesce(imp.attendance_status, 'missing') <> 'present'
order by incident_id, source_type, person_id;

-- C. צוותים בארכיון שעדיין מחזיקים חברויות פעילות.
select
  'C'::text as check_code,
  'צוות בארכיון עם חברים פעילים'::text as check_name,
  t.id as ad_hoc_team_id,
  t.incident_id,
  t.status,
  t.archived_at,
  count(m.id)::integer as active_member_count
from public.incident_ad_hoc_teams t
join public.incident_ad_hoc_team_members m
  on m.ad_hoc_team_id = t.id
 and m.is_active
where t.status = 'archived'
   or t.archived_at is not null
group by t.id, t.incident_id, t.status, t.archived_at
order by t.incident_id, t.id;

-- D. אי-התאמות בין האירוע שבחברות, הצוות והאדם הידני; וכן מקורות חסרים.
select
  'D'::text as check_code,
  'שלמות קשרי אירוע'::text as check_name,
  m.id as membership_id,
  m.incident_id as membership_incident_id,
  m.ad_hoc_team_id,
  m.unit_personnel_id,
  m.manual_personnel_id,
  case
    when t.id is null then 'missing_ad_hoc_team'
    when t.incident_id is distinct from m.incident_id then 'team_incident_mismatch'
    when m.manual_personnel_id is not null and imp.id is null then 'missing_manual_personnel'
    when m.manual_personnel_id is not null and imp.incident_id is distinct from m.incident_id then 'manual_personnel_incident_mismatch'
    when m.unit_personnel_id is not null and up.id is null then 'missing_unit_personnel'
    when (m.unit_personnel_id is null and m.manual_personnel_id is null)
      or (m.unit_personnel_id is not null and m.manual_personnel_id is not null) then 'invalid_person_source'
  end as issue_kind,
  t.incident_id as team_incident_id,
  imp.incident_id as manual_personnel_incident_id
from public.incident_ad_hoc_team_members m
left join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
left join public.incident_manual_personnel imp on imp.id = m.manual_personnel_id
left join public.unit_personnel up on up.id = m.unit_personnel_id
where t.id is null
   or t.incident_id is distinct from m.incident_id
   or (m.manual_personnel_id is not null and imp.id is null)
   or (m.manual_personnel_id is not null and imp.incident_id is distinct from m.incident_id)
   or (m.unit_personnel_id is not null and up.id is null)
   or (m.unit_personnel_id is null and m.manual_personnel_id is null)
   or (m.unit_personnel_id is not null and m.manual_personnel_id is not null)
order by m.incident_id, m.id;

-- E. בדיקת commander_name ההיסטורי. השם הוא שדה חופשי ולכן זו אינדיקציה לבדיקה ידנית בלבד.
with commander_matches as (
  select
    t.id as ad_hoc_team_id,
    t.incident_id,
    t.name as team_name,
    nullif(btrim(t.commander_name), '') as commander_name,
    count(m.id) filter (
      where lower(btrim(concat_ws(' ', up.first_name, up.last_name))) = lower(btrim(t.commander_name))
         or lower(btrim(concat_ws(' ', imp.first_name, imp.last_name))) = lower(btrim(t.commander_name))
    )::integer as matching_active_member_count
  from public.incident_ad_hoc_teams t
  left join public.incident_ad_hoc_team_members m
    on m.ad_hoc_team_id = t.id
   and m.incident_id = t.incident_id
   and m.is_active
  left join public.unit_personnel up on up.id = m.unit_personnel_id
  left join public.incident_manual_personnel imp on imp.id = m.manual_personnel_id
  group by t.id, t.incident_id, t.name, t.commander_name
)
select
  'E'::text as check_code,
  'שלמות מפקד צוות היסטורי'::text as check_name,
  ad_hoc_team_id,
  incident_id,
  team_name,
  commander_name,
  matching_active_member_count,
  case
    when commander_name is null then 'missing_commander_name'
    when matching_active_member_count = 0 then 'commander_not_active_member_or_name_mismatch'
    when matching_active_member_count > 1 then 'ambiguous_commander_name'
  end as issue_kind
from commander_matches
where commander_name is null
   or matching_active_member_count <> 1
order by incident_id, ad_hoc_team_id;

-- F. צוותי אד־הוק עם הקצאות ציוד פתוחות. זו אינה תקלה כשלעצמה, אך היא חוסמת פירוק.
select
  'F'::text as check_code,
  'תלויות ציוד פתוחות'::text as check_name,
  t.id as ad_hoc_team_id,
  t.incident_id,
  t.name as team_name,
  count(a.id)::integer as open_equipment_assignment_count
from public.incident_ad_hoc_teams t
join public.incident_equipment_assignments a
  on a.ad_hoc_team_id = t.id
 and a.incident_id = t.incident_id
 and a.released_at is null
group by t.id, t.incident_id, t.name
order by t.incident_id, t.id;

-- G. שלמות היסטוריית החברויות. חפיפות מדווחות כעמימות היסטורית פוטנציאלית.
with membership_periods as (
  select
    m.id as membership_id,
    m.incident_id,
    m.ad_hoc_team_id,
    case
      when m.unit_personnel_id is not null then 'unit_personnel'
      when m.manual_personnel_id is not null then 'manual_personnel'
      else 'invalid'
    end as source_type,
    coalesce(m.unit_personnel_id, m.manual_personnel_id) as person_id,
    m.is_active,
    m.added_at,
    m.removed_at,
    max(coalesce(m.removed_at, 'infinity'::timestamptz)) over (
      partition by m.incident_id, m.unit_personnel_id, m.manual_personnel_id
      order by m.added_at, m.id
      rows between unbounded preceding and 1 preceding
    ) as prior_latest_end
  from public.incident_ad_hoc_team_members m
), history_findings as (
  select
    membership_id,
    incident_id,
    ad_hoc_team_id,
    source_type,
    person_id,
    is_active,
    added_at,
    removed_at,
    case
      when is_active and removed_at is not null then 'active_membership_has_removed_at'
      when not is_active and removed_at is null then 'inactive_membership_missing_removed_at'
      when removed_at is not null and removed_at < added_at then 'removed_before_added'
      when prior_latest_end is not null and added_at <= prior_latest_end then 'potential_overlapping_membership_period'
    end as issue_kind
  from membership_periods
)
select
  'G'::text as check_code,
  'שלמות היסטוריית חברויות'::text as check_name,
  membership_id,
  incident_id,
  ad_hoc_team_id,
  source_type,
  person_id,
  is_active,
  added_at,
  removed_at,
  issue_kind,
  case
    when issue_kind = 'potential_overlapping_membership_period' then 'potential_historical_ambiguity'
    else 'confirmed_inconsistency'
  end as finding_classification
from history_findings
where issue_kind is not null
order by incident_id, source_type, person_id, added_at, membership_id;

-- H. כוח אדם ידני פעיל ללא צוות אורגני. זהו מידע תפעולי, לא שגיאה אוטומטית.
select
  'H'::text as check_code,
  'כוח אדם ידני ללא צוות אורגני'::text as check_name,
  imp.id as manual_personnel_id,
  imp.incident_id,
  imp.attendance_status,
  array_remove(array_agg(m.ad_hoc_team_id order by m.ad_hoc_team_id), null) as active_ad_hoc_team_ids
from public.incident_manual_personnel imp
left join public.incident_ad_hoc_team_members m
  on m.manual_personnel_id = imp.id
 and m.incident_id = imp.incident_id
 and m.is_active
where imp.is_active
  and imp.organic_team_id is null
group by imp.id, imp.incident_id, imp.attendance_status
order by imp.incident_id, imp.id;

-- סיכום: כל section מופיע גם כאשר לא נמצאו ממצאים.
with
duplicate_active_assignments as (
  select 1
  from (
    select m.incident_id, m.unit_personnel_id as person_id
    from public.incident_ad_hoc_team_members m
    join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id and t.incident_id = m.incident_id
    where m.is_active and t.status = 'active' and m.unit_personnel_id is not null
    group by m.incident_id, m.unit_personnel_id
    having count(*) > 1
    union all
    select m.incident_id, m.manual_personnel_id
    from public.incident_ad_hoc_team_members m
    join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id and t.incident_id = m.incident_id
    where m.is_active and t.status = 'active' and m.manual_personnel_id is not null
    group by m.incident_id, m.manual_personnel_id
    having count(*) > 1
  ) findings
), attendance_inconsistencies as (
  select 1
  from public.incident_ad_hoc_team_members m
  left join public.event_personnel_status eps on eps.incident_id = m.incident_id and eps.personnel_id = m.unit_personnel_id
  left join public.incident_manual_personnel imp on imp.id = m.manual_personnel_id and imp.incident_id = m.incident_id
  where m.is_active
    and (
      (m.unit_personnel_id is not null and coalesce(eps.attendance_status, 'missing') <> 'present')
      or (m.manual_personnel_id is not null and coalesce(imp.attendance_status, 'missing') <> 'present')
    )
), archived_with_active_members as (
  select 1
  from public.incident_ad_hoc_teams t
  join public.incident_ad_hoc_team_members m on m.ad_hoc_team_id = t.id and m.is_active
  where t.status = 'archived' or t.archived_at is not null
), incident_relationship_issues as (
  select 1
  from public.incident_ad_hoc_team_members m
  left join public.incident_ad_hoc_teams t on t.id = m.ad_hoc_team_id
  left join public.incident_manual_personnel imp on imp.id = m.manual_personnel_id
  left join public.unit_personnel up on up.id = m.unit_personnel_id
  where t.id is null
     or t.incident_id is distinct from m.incident_id
     or (m.manual_personnel_id is not null and (imp.id is null or imp.incident_id is distinct from m.incident_id))
     or (m.unit_personnel_id is not null and up.id is null)
     or (m.unit_personnel_id is null and m.manual_personnel_id is null)
     or (m.unit_personnel_id is not null and m.manual_personnel_id is not null)
), leadership_issues as (
  select 1
  from public.incident_ad_hoc_teams t
  left join public.incident_ad_hoc_team_members m on m.ad_hoc_team_id = t.id and m.incident_id = t.incident_id and m.is_active
  left join public.unit_personnel up on up.id = m.unit_personnel_id
  left join public.incident_manual_personnel imp on imp.id = m.manual_personnel_id
  group by t.id, t.commander_name
  having nullif(btrim(t.commander_name), '') is null
      or count(m.id) filter (
        where lower(btrim(concat_ws(' ', up.first_name, up.last_name))) = lower(btrim(t.commander_name))
           or lower(btrim(concat_ws(' ', imp.first_name, imp.last_name))) = lower(btrim(t.commander_name))
      ) <> 1
), equipment_dependencies as (
  select 1
  from public.incident_ad_hoc_teams t
  join public.incident_equipment_assignments a
    on a.ad_hoc_team_id = t.id and a.incident_id = t.incident_id and a.released_at is null
), membership_history_issues as (
  select 1
  from (
    select
      m.is_active,
      m.added_at,
      m.removed_at,
      max(coalesce(m.removed_at, 'infinity'::timestamptz)) over (
        partition by m.incident_id, m.unit_personnel_id, m.manual_personnel_id
        order by m.added_at, m.id
        rows between unbounded preceding and 1 preceding
      ) as prior_latest_end
    from public.incident_ad_hoc_team_members m
  ) membership_history
  where (is_active and removed_at is not null)
     or (not is_active and removed_at is null)
     or (removed_at is not null and removed_at < added_at)
     or (prior_latest_end is not null and added_at <= prior_latest_end)
), manual_without_organic_team as (
  select 1
  from public.incident_manual_personnel imp
  where imp.is_active and imp.organic_team_id is null
)
select
  check_code,
  check_name,
  finding_count,
  severity,
  manual_review_required
from (
  select 'A'::text as check_code, 'שיוכים פעילים כפולים'::text as check_name,
    (select count(*)::integer from duplicate_active_assignments) as finding_count,
    'BLOCKER'::text as severity, true as manual_review_required
  union all
  select 'B', 'חברות פעילה ללא נוכחות',
    (select count(*)::integer from attendance_inconsistencies),
    'BLOCKER', true
  union all
  select 'C', 'צוות בארכיון עם חברים פעילים',
    (select count(*)::integer from archived_with_active_members),
    'WARNING', true
  union all
  select 'D', 'שלמות קשרי אירוע',
    (select count(*)::integer from incident_relationship_issues),
    'BLOCKER', true
  union all
  select 'E', 'שלמות מפקד צוות היסטורי',
    (select count(*)::integer from leadership_issues),
    'WARNING', true
  union all
  select 'F', 'תלויות ציוד פתוחות',
    (select count(*)::integer from equipment_dependencies),
    'WARNING', true
  union all
  select 'G', 'שלמות היסטוריית חברויות',
    (select count(*)::integer from membership_history_issues),
    'WARNING', true
  union all
  select 'H', 'כוח אדם ידני ללא צוות אורגני',
    (select count(*)::integer from manual_without_organic_team),
    'INFO', false
) summary
order by check_code;
