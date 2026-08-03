-- Generated from schema/20_biological_material.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

CREATE TABLE IF NOT EXISTS "biomed"."subject" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_id" uuid NOT NULL REFERENCES "biomed"."study"("id"),
  "external_id" text NOT NULL,
  "species" text NOT NULL,
  "sex" text,
  "age_at_enrollment_years" numeric,
  "cohort" text,
  UNIQUE ("study_id", "external_id")
);
COMMENT ON TABLE "biomed"."subject" IS 'A de-identified study participant/organism. Holds only the research-relevant covariates, never direct identifiers.';
COMMENT ON COLUMN "biomed"."subject"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."subject"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."subject"."external_id" IS 'De-identified research code assigned by the study team, e.g. SUBJ-014.';
COMMENT ON COLUMN "biomed"."subject"."species" IS 'e.g. Homo sapiens, Mus musculus.';
COMMENT ON COLUMN "biomed"."subject"."age_at_enrollment_years" IS 'Age rather than date of birth, by design - see privacy note above.';
COMMENT ON COLUMN "biomed"."subject"."cohort" IS 'e.g. control, treatment-a.';
CREATE INDEX IF NOT EXISTS idx_subject_study_id ON "biomed"."subject" ("study_id");

CREATE TABLE IF NOT EXISTS "biomed"."specimen" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_id" uuid NOT NULL REFERENCES "biomed"."study"("id"),
  "subject_id" uuid REFERENCES "biomed"."subject"("id"),
  "parent_specimen_id" uuid REFERENCES "biomed"."specimen"("id"),
  "specimen_type" text NOT NULL,
  "collection_date" timestamptz,
  "collection_site" text,
  "storage_location" text,
  "storage_condition" text,
  "status" text NOT NULL DEFAULT 'available',
  CHECK (status in ('available', 'depleted', 'discarded'))
);
COMMENT ON TABLE "biomed"."specimen" IS 'A physical biological sample (tissue, blood, extract, ...) collected from a subject or, for QC/reference material, standalone. Aliquots and extracts derived from another specimen link back via parent_specimen_id, forming a specimen lineage tree.';
COMMENT ON COLUMN "biomed"."specimen"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."specimen"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."specimen"."subject_id" IS 'Null for QC/reference specimens not tied to a subject.';
COMMENT ON COLUMN "biomed"."specimen"."parent_specimen_id" IS 'Set when this specimen was derived from another (e.g. plasma aliquoted from whole blood).';
COMMENT ON COLUMN "biomed"."specimen"."specimen_type" IS 'e.g. whole blood, tumor tissue, plasma. Consider tagging with an ontology_term (UBERON) via entity_term_tag for controlled vocabulary.';
COMMENT ON COLUMN "biomed"."specimen"."collection_site" IS 'Anatomical site or collecting facility.';
COMMENT ON COLUMN "biomed"."specimen"."storage_location" IS 'Freezer / box / position.';
COMMENT ON COLUMN "biomed"."specimen"."storage_condition" IS 'e.g. -80C.';
COMMENT ON COLUMN "biomed"."specimen"."status" IS 'available | depleted | discarded';
CREATE INDEX IF NOT EXISTS idx_specimen_study_id ON "biomed"."specimen" ("study_id");
CREATE INDEX IF NOT EXISTS idx_specimen_subject_id ON "biomed"."specimen" ("subject_id");
CREATE INDEX IF NOT EXISTS idx_specimen_parent_specimen_id ON "biomed"."specimen" ("parent_specimen_id");
