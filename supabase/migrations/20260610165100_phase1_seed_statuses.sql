-- RCC Phase 1 global default status seed data.
-- Global defaults have incident_id = null. Incidents may define custom statuses with their own incident_id.

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
  sort_order
)
values
  (null, 'incident', 'active', 'Active', 'פעיל', 'green', true, false, true, 10),
  (null, 'incident', 'closed', 'Closed', 'סגור', 'gray', false, false, true, 20),

  (null, 'site', 'created', 'Created', 'נפתח', 'gray', true, false, true, 10),
  (null, 'site', 'mobilization', 'Mobilization', 'בהיערכות', 'blue', true, false, true, 20),
  (null, 'site', 'active_operations', 'Active Operations', 'פעילות בשטח', 'orange', true, false, true, 30),
  (null, 'site', 'search_operations', 'Search Operations', 'סריקה', 'yellow', true, false, true, 40),
  (null, 'site', 'rescue_operations', 'Rescue Operations', 'חילוץ פעיל', 'red', true, false, true, 50),
  (null, 'site', 'completed', 'Completed', 'הסתיים', 'green', false, false, true, 60),
  (null, 'site', 'closed', 'Closed', 'סגור', 'gray', false, false, true, 70),

  (null, 'floor', 'active', 'Active', 'פעיל', 'blue', true, false, true, 10),
  (null, 'floor', 'inactive', 'Inactive', 'לא פעיל', 'gray', false, false, true, 20),

  (null, 'unit', 'unknown', 'Unknown', 'לא נבדקה', 'gray', true, false, true, 10),
  (null, 'unit', 'partially_verified', 'Partially Verified', 'מידע חלקי', 'yellow', true, false, true, 20),
  (null, 'unit', 'active_investigation', 'Active Investigation', 'יש נעדרים', 'orange', true, false, true, 30),
  (null, 'unit', 'fully_cleared', 'Fully Cleared', 'זיכוי מלא', 'green', false, false, true, 40),
  (null, 'unit', 'inactive', 'Inactive', 'לא פעילה', 'gray', false, false, true, 50),

  (null, 'resident', 'unknown', 'Unknown', 'לא ידוע', 'gray', true, false, true, 10),
  (null, 'resident', 'linked_to_person', 'Linked To Person', 'מקושר לכרטיס מבצעי', 'blue', true, false, true, 20),
  (null, 'resident', 'accounted_for', 'Accounted For', 'אותר', 'green', false, false, true, 30),

  (null, 'person', 'missing', 'Missing', 'נעדרים', 'orange', true, true, true, 10),
  (null, 'person', 'trapped_located_not_yet_rescued', 'Trapped Located Not Yet Rescued', 'לכודים שאותרו וטרם חולצו', 'red', true, true, true, 20),
  (null, 'person', 'injured_evacuated_to_ccp', 'Injured Evacuated To CCP', 'פצועים שפונו לנאפל', 'yellow', false, true, true, 30),
  (null, 'person', 'injured_evacuated_from_site', 'Injured Evacuated From Site', 'פצועים שפונו מהאתר', 'green', false, true, true, 40),
  (null, 'person', 'fatality_evacuated', 'Fatality Evacuated', 'הרוגים שפונו', 'black', false, true, true, 50),
  (null, 'person', 'located_outside_site', 'Located Outside Site', 'אזרחים שאותרו לא באתר', 'blue', false, true, true, 60),
  (null, 'person', 'general', 'General', 'כללי', 'gray', true, false, true, 70),
  (null, 'person', 'duplicate_cancelled', 'Duplicate / Cancelled', 'כפילות / בוטל', 'purple', false, false, true, 80),

  (null, 'team', 'available', 'Available', 'זמין', 'green', true, false, true, 10),
  (null, 'team', 'assigned', 'Assigned', 'משויך', 'blue', true, false, true, 20),
  (null, 'team', 'en_route', 'En Route', 'בדרך', 'yellow', true, false, true, 30),
  (null, 'team', 'operating', 'Operating', 'בפעילות', 'orange', true, false, true, 40),
  (null, 'team', 'resting', 'Resting', 'במנוחה', 'gray', true, false, true, 50),
  (null, 'team', 'released', 'Released', 'שוחרר', 'gray', false, false, true, 60),

  (null, 'log', 'operational', 'Operational', 'מבצעי', 'blue', true, false, true, 10),
  (null, 'log', 'administrative', 'Administrative', 'מנהלי', 'gray', true, false, true, 20),
  (null, 'log', 'correction', 'Correction', 'תיקון', 'purple', true, false, true, 30)
on conflict do nothing;
