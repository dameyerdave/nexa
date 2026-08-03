-- Generated from schema/95_storage.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

insert into storage.buckets (id, name, public)
values
  ('raw-instrument-data', 'raw-instrument-data', false),
  ('derived-data', 'derived-data', false)
on conflict (id) do nothing;

drop policy if exists "study_members_rw" on storage.objects;
create policy "study_members_rw" on storage.objects for all
  using (
    bucket_id in ('raw-instrument-data', 'derived-data')
    and biomed.can_access_study((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id in ('raw-instrument-data', 'derived-data')
    and biomed.can_access_study((storage.foldername(name))[1]::uuid)
  );
