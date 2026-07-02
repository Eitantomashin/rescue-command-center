-- Operational person status list update.
-- Adds the missing "fatality_trapped" status and keeps dashboard grouping aligned.
-- Existing person/report rows are not migrated or rewritten.

insert into public.status_types (
  incident_id,
  category,
  status_key,
  name,
  hebrew_label,
  color,
  is_open,
  is_dashboard_counted,
  is_default,
  counts_as_gap_resolved,
  sort_order
)
values
  (null, 'person', 'fatality_trapped', 'Fatality Trapped', 'הרוג לכוד', 'black', true, true, true, false, 55)
on conflict do nothing;

update public.status_types
set hebrew_label = case status_key
    when 'unknown' then 'לא ידוע'
    when 'missing' then 'נעדר'
    when 'trapped_located_not_yet_rescued' then 'לכוד אותר וטרם חולץ'
    when 'injured_evacuated_to_ccp' then 'פצוע פונה לנאפ"ל'
    when 'injured_evacuated_from_site' then 'פצוע פונה מהאתר'
    when 'fatality_trapped' then 'הרוג לכוד'
    when 'fatality_evacuated' then 'הרוג פונה'
    when 'located_outside_site' then 'אותר מחוץ לאתר'
    when 'rescued' then 'חולץ'
    when 'duplicate_cancelled' then 'כפילות/בוטל'
    else hebrew_label
  end,
  sort_order = case status_key
    when 'unknown' then 1
    when 'missing' then 2
    when 'trapped_located_not_yet_rescued' then 3
    when 'injured_evacuated_to_ccp' then 4
    when 'injured_evacuated_from_site' then 5
    when 'fatality_trapped' then 6
    when 'fatality_evacuated' then 7
    when 'located_outside_site' then 8
    when 'rescued' then 9
    when 'duplicate_cancelled' then 10
    else sort_order
  end
where category = 'person'
  and incident_id is null
  and status_key in (
    'unknown',
    'missing',
    'trapped_located_not_yet_rescued',
    'injured_evacuated_to_ccp',
    'injured_evacuated_from_site',
    'fatality_trapped',
    'fatality_evacuated',
    'located_outside_site',
    'rescued',
    'duplicate_cancelled'
  );

create or replace function public.operational_status_dashboard_group(p_status_key text)
returns text
language sql
immutable
as $$
  select case
    when p_status_key in ('missing', 'unknown', 'general') then 'missing_unknown'
    when p_status_key = 'trapped_located_not_yet_rescued' then 'trapped_located_not_yet_rescued'
    when p_status_key = 'rescued' then 'rescued'
    when p_status_key in (
      'evacuated',
      'evacuated_to_napal',
      'evacuated_from_site',
      'injured_evacuated_to_ccp',
      'injured_evacuated_from_site'
    ) then 'evacuated'
    when p_status_key = 'located_outside_site' then 'located_outside_site'
    when p_status_key in (
      'deceased',
      'deceased_evacuated',
      'fatality_trapped',
      'fatality_evacuated',
      'dead'
    ) then 'deceased'
    else 'other'
  end
$$;

create or replace function public.operational_status_dashboard_label(p_status_key text)
returns text
language sql
immutable
as $$
  select case public.operational_status_dashboard_group(p_status_key)
    when 'missing_unknown' then 'נעדר / לא ידוע'
    when 'trapped_located_not_yet_rescued' then 'לכוד אותר וטרם חולץ'
    when 'rescued' then 'חולץ'
    when 'evacuated' then 'פונה'
    when 'located_outside_site' then 'אותר מחוץ לאתר'
    when 'deceased' then 'הרוג / נפטר'
    else 'אחר'
  end
$$;

create or replace function public.operational_status_card_color(p_status_key text)
returns text
language sql
immutable
as $$
  select case public.operational_status_dashboard_group(p_status_key)
    when 'missing_unknown' then 'blue'
    when 'trapped_located_not_yet_rescued' then 'orange'
    when 'rescued' then 'green'
    when 'evacuated' then 'green'
    when 'located_outside_site' then 'green'
    when 'deceased' then 'red'
    else 'orange'
  end
$$;