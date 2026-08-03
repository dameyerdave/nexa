-- Generated from schema/90_access_control.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

create or replace function biomed.can_access_study(p_study_id uuid)
returns boolean
language sql
security definer
stable
set search_path = biomed, pg_temp
as $$
  select exists (
    select 1 from biomed.study_member m
    where m.study_id = p_study_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function biomed.can_access_study_via_run(p_run_id uuid)
returns boolean
language sql
security definer
stable
set search_path = biomed, pg_temp
as $$
  select biomed.can_access_study(study_id)
  from biomed.run
  where id = p_run_id;
$$;

ALTER TABLE "biomed"."study" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."study";
CREATE POLICY "study_members_all" ON "biomed"."study" FOR ALL
  USING (biomed.can_access_study(id))
  WITH CHECK (biomed.can_access_study(id));

ALTER TABLE "biomed"."study_member" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."study_member";
CREATE POLICY "study_members_all" ON "biomed"."study_member" FOR ALL
  USING (biomed.can_access_study(study_id))
  WITH CHECK (biomed.can_access_study(study_id));

ALTER TABLE "biomed"."subject" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."subject";
CREATE POLICY "study_members_all" ON "biomed"."subject" FOR ALL
  USING (biomed.can_access_study(study_id))
  WITH CHECK (biomed.can_access_study(study_id));

ALTER TABLE "biomed"."specimen" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."specimen";
CREATE POLICY "study_members_all" ON "biomed"."specimen" FOR ALL
  USING (biomed.can_access_study(study_id))
  WITH CHECK (biomed.can_access_study(study_id));

ALTER TABLE "biomed"."run" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."run";
CREATE POLICY "study_members_all" ON "biomed"."run" FOR ALL
  USING (biomed.can_access_study(study_id))
  WITH CHECK (biomed.can_access_study(study_id));

ALTER TABLE "biomed"."raw_file" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "study_members_all" ON "biomed"."raw_file";
CREATE POLICY "study_members_all" ON "biomed"."raw_file" FOR ALL
  USING (biomed.can_access_study_via_run(run_id))
  WITH CHECK (biomed.can_access_study_via_run(run_id));

grant usage on schema biomed to authenticated;
grant select, insert, update, delete on all tables in schema biomed to authenticated;
alter default privileges in schema biomed
  grant select, insert, update, delete on tables to authenticated;
