-- Supports the active linked-resident lookup used by dashboard summaries.
create index if not exists unit_residents_active_linked_person_idx
  on public.unit_residents (linked_person_id)
  where is_active = true;
