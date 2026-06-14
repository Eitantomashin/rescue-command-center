-- UTF-8 repair for known status type Hebrew labels.
--
-- Repairs only known built-in status labels by category/status_key. This does
-- not alter business keys, custom unknown statuses, event history, or logic.

update public.status_types
set hebrew_label = case
  when category = 'incident' and status_key = 'active' then 'פעיל'
  when category = 'incident' and status_key = 'closed' then 'סגור'

  when category = 'site' and status_key = 'created' then 'נפתח'
  when category = 'site' and status_key = 'mobilization' then 'בהיערכות'
  when category = 'site' and status_key = 'active_operations' then 'פעילות בשטח'
  when category = 'site' and status_key = 'search_operations' then 'סריקה'
  when category = 'site' and status_key = 'rescue_operations' then 'חילוץ פעיל'
  when category = 'site' and status_key = 'completed' then 'הסתיים'
  when category = 'site' and status_key = 'closed' then 'סגור'

  when category = 'floor' and status_key = 'active' then 'פעיל'
  when category = 'floor' and status_key = 'inactive' then 'לא פעיל'

  when category = 'unit' and status_key = 'unknown' then 'לא נבדקה'
  when category = 'unit' and status_key = 'partially_verified' then 'מידע חלקי'
  when category = 'unit' and status_key = 'active_investigation' then 'יש נעדרים'
  when category = 'unit' and status_key = 'fully_cleared' then 'זיכוי מלא'
  when category = 'unit' and status_key = 'inactive' then 'לא פעילה'

  when category = 'resident' and status_key = 'unknown' then 'לא ידוע'
  when category = 'resident' and status_key = 'linked_to_person' then 'מקושר למספר מבצעי'
  when category = 'resident' and status_key = 'accounted_for' then 'אותר'
  when category = 'resident' and status_key = 'missing' then 'נעדר'
  when category = 'resident' and status_key = 'in_progress' then 'בטיפול'
  when category = 'resident' and status_key = 'trapped_located_not_yet_rescued' then 'לכוד אותר וטרם חולץ'
  when category = 'resident' and status_key = 'rescued' then 'חולץ'
  when category = 'resident' and status_key = 'evacuated_to_napal' then 'פונה לנאפל'
  when category = 'resident' and status_key = 'evacuated_from_site' then 'פונה מהאתר'
  when category = 'resident' and status_key = 'deceased_evacuated' then 'הרוג פונה'
  when category = 'resident' and status_key = 'evacuated' then 'פונה'
  when category = 'resident' and status_key = 'located_outside_site' then 'אותר מחוץ לאתר'
  when category = 'resident' and status_key = 'resolved' then 'טופל'
  when category = 'resident' and status_key = 'general' then 'כללי'

  when category = 'person' and status_key = 'unknown' then 'לא ידוע'
  when category = 'person' and status_key = 'missing' then 'נעדר'
  when category = 'person' and status_key = 'in_progress' then 'בטיפול'
  when category = 'person' and status_key = 'trapped_located_not_yet_rescued' then 'לכוד אותר וטרם חולץ'
  when category = 'person' and status_key = 'injured_evacuated_to_ccp' then 'פצוע פונה לנאפל'
  when category = 'person' and status_key = 'injured_evacuated_from_site' then 'פצוע פונה מהאתר'
  when category = 'person' and status_key = 'fatality_evacuated' then 'הרוג פונה'
  when category = 'person' and status_key = 'located_outside_site' then 'אותר מחוץ לאתר'
  when category = 'person' and status_key = 'evacuated_to_napal' then 'פצוע פונה לנאפל'
  when category = 'person' and status_key = 'evacuated_from_site' then 'פצוע פונה מהאתר'
  when category = 'person' and status_key = 'deceased_evacuated' then 'הרוג פונה'
  when category = 'person' and status_key = 'rescued' then 'חולץ'
  when category = 'person' and status_key = 'evacuated' then 'פונה'
  when category = 'person' and status_key = 'resolved' then 'טופל'
  when category = 'person' and status_key = 'general' then 'כללי'
  when category = 'person' and status_key = 'duplicate_cancelled' then 'כפילות / בוטל'

  when category = 'team' and status_key = 'available' then 'זמין'
  when category = 'team' and status_key = 'assigned' then 'משויך'
  when category = 'team' and status_key = 'en_route' then 'בדרך'
  when category = 'team' and status_key = 'operating' then 'בפעילות'
  when category = 'team' and status_key = 'resting' then 'במנוחה'
  when category = 'team' and status_key = 'released' then 'שוחרר'

  when category = 'log' and status_key = 'operational' then 'מבצעי'
  when category = 'log' and status_key = 'administrative' then 'מנהלי'
  when category = 'log' and status_key = 'correction' then 'תיקון'
  else hebrew_label
end
where (category, status_key) in (
  ('incident', 'active'),
  ('incident', 'closed'),
  ('site', 'created'),
  ('site', 'mobilization'),
  ('site', 'active_operations'),
  ('site', 'search_operations'),
  ('site', 'rescue_operations'),
  ('site', 'completed'),
  ('site', 'closed'),
  ('floor', 'active'),
  ('floor', 'inactive'),
  ('unit', 'unknown'),
  ('unit', 'partially_verified'),
  ('unit', 'active_investigation'),
  ('unit', 'fully_cleared'),
  ('unit', 'inactive'),
  ('resident', 'unknown'),
  ('resident', 'linked_to_person'),
  ('resident', 'accounted_for'),
  ('resident', 'missing'),
  ('resident', 'in_progress'),
  ('resident', 'trapped_located_not_yet_rescued'),
  ('resident', 'rescued'),
  ('resident', 'evacuated_to_napal'),
  ('resident', 'evacuated_from_site'),
  ('resident', 'deceased_evacuated'),
  ('resident', 'evacuated'),
  ('resident', 'located_outside_site'),
  ('resident', 'resolved'),
  ('resident', 'general'),
  ('person', 'unknown'),
  ('person', 'missing'),
  ('person', 'in_progress'),
  ('person', 'trapped_located_not_yet_rescued'),
  ('person', 'injured_evacuated_to_ccp'),
  ('person', 'injured_evacuated_from_site'),
  ('person', 'fatality_evacuated'),
  ('person', 'located_outside_site'),
  ('person', 'evacuated_to_napal'),
  ('person', 'evacuated_from_site'),
  ('person', 'deceased_evacuated'),
  ('person', 'rescued'),
  ('person', 'evacuated'),
  ('person', 'resolved'),
  ('person', 'general'),
  ('person', 'duplicate_cancelled'),
  ('team', 'available'),
  ('team', 'assigned'),
  ('team', 'en_route'),
  ('team', 'operating'),
  ('team', 'resting'),
  ('team', 'released'),
  ('log', 'operational'),
  ('log', 'administrative'),
  ('log', 'correction')
);
