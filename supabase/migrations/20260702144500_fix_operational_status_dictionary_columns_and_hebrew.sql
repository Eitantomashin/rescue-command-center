-- Corrective operational status dictionary migration.
-- Forward-only fix for environments where the earlier status migration was already applied
-- before disabled_at/disabled_by were added, or where Hebrew labels were corrupted.

alter table public.status_types
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references public.profiles(id);

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
  (null, 'person', 'fatality_trapped', 'Fatality Trapped', U&'\05D4\05E8\05D5\05D2 \05DC\05DB\05D5\05D3', 'black', true, true, true, false, 6)
on conflict do nothing;

update public.status_types
set name = case status_key
    when 'unknown' then U&'\05DC\05D0 \05D9\05D3\05D5\05E2'
    when 'missing' then U&'\05E0\05E2\05D3\05E8'
    when 'trapped_located_not_yet_rescued' then U&'\05DC\05DB\05D5\05D3 \05D0\05D5\05EA\05E8 \05D5\05D8\05E8\05DD \05D7\05D5\05DC\05E5'
    when 'injured_evacuated_to_ccp' then U&'\05E4\05E6\05D5\05E2 \05E4\05D5\05E0\05D4 \05DC\05E0\05D0\05E4"\05DC'
    when 'injured_evacuated_from_site' then U&'\05E4\05E6\05D5\05E2 \05E4\05D5\05E0\05D4 \05DE\05D4\05D0\05EA\05E8'
    when 'fatality_trapped' then U&'\05D4\05E8\05D5\05D2 \05DC\05DB\05D5\05D3'
    when 'fatality_evacuated' then U&'\05D4\05E8\05D5\05D2 \05E4\05D5\05E0\05D4'
    when 'located_outside_site' then U&'\05D0\05D5\05EA\05E8 \05DE\05D7\05D5\05E5 \05DC\05D0\05EA\05E8'
    when 'rescued' then U&'\05D7\05D5\05DC\05E5'
    when 'duplicate_cancelled' then U&'\05DB\05E4\05D9\05DC\05D5\05EA/\05D1\05D5\05D8\05DC'
    else name
  end,
  hebrew_label = case status_key
    when 'unknown' then U&'\05DC\05D0 \05D9\05D3\05D5\05E2'
    when 'missing' then U&'\05E0\05E2\05D3\05E8'
    when 'trapped_located_not_yet_rescued' then U&'\05DC\05DB\05D5\05D3 \05D0\05D5\05EA\05E8 \05D5\05D8\05E8\05DD \05D7\05D5\05DC\05E5'
    when 'injured_evacuated_to_ccp' then U&'\05E4\05E6\05D5\05E2 \05E4\05D5\05E0\05D4 \05DC\05E0\05D0\05E4"\05DC'
    when 'injured_evacuated_from_site' then U&'\05E4\05E6\05D5\05E2 \05E4\05D5\05E0\05D4 \05DE\05D4\05D0\05EA\05E8'
    when 'fatality_trapped' then U&'\05D4\05E8\05D5\05D2 \05DC\05DB\05D5\05D3'
    when 'fatality_evacuated' then U&'\05D4\05E8\05D5\05D2 \05E4\05D5\05E0\05D4'
    when 'located_outside_site' then U&'\05D0\05D5\05EA\05E8 \05DE\05D7\05D5\05E5 \05DC\05D0\05EA\05E8'
    when 'rescued' then U&'\05D7\05D5\05DC\05E5'
    when 'duplicate_cancelled' then U&'\05DB\05E4\05D9\05DC\05D5\05EA/\05D1\05D5\05D8\05DC'
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
  end,
  is_active = true,
  disabled_at = null,
  disabled_by = null
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

update public.status_types
set is_active = false,
    disabled_at = coalesce(disabled_at, now())
where category = 'person'
  and incident_id is null
  and status_key not in (
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

create or replace function public.operational_status_dashboard_label(p_status_key text)
returns text
language sql
immutable
as $$
  select case public.operational_status_dashboard_group(p_status_key)
    when 'missing_unknown' then U&'\05E0\05E2\05D3\05E8 / \05DC\05D0 \05D9\05D3\05D5\05E2'
    when 'trapped_located_not_yet_rescued' then U&'\05DC\05DB\05D5\05D3 \05D0\05D5\05EA\05E8 \05D5\05D8\05E8\05DD \05D7\05D5\05DC\05E5'
    when 'rescued' then U&'\05D7\05D5\05DC\05E5'
    when 'evacuated' then U&'\05E4\05D5\05E0\05D4'
    when 'located_outside_site' then U&'\05D0\05D5\05EA\05E8 \05DE\05D7\05D5\05E5 \05DC\05D0\05EA\05E8'
    when 'deceased' then U&'\05D4\05E8\05D5\05D2 / \05E0\05E4\05D8\05E8'
    else U&'\05D0\05D7\05E8'
  end
$$;
