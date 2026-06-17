-- Phase 8A: Storage bucket for site grid/aerial images.
-- No application data tables are changed. The existing sites.image_data_url column
-- stores a storage reference string in the form: storage:site-grid-images/<path>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-grid-images',
  'site-grid-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read site grid images" on storage.objects;
create policy "Authenticated users can read site grid images"
on storage.objects for select
to authenticated
using (bucket_id = 'site-grid-images');

drop policy if exists "Authenticated users can upload site grid images" on storage.objects;
create policy "Authenticated users can upload site grid images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'site-grid-images');

drop policy if exists "Authenticated users can update site grid images" on storage.objects;
create policy "Authenticated users can update site grid images"
on storage.objects for update
to authenticated
using (bucket_id = 'site-grid-images')
with check (bucket_id = 'site-grid-images');
