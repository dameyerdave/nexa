-- Generated from schema/10_organization.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

CREATE SCHEMA IF NOT EXISTS "biomed";

CREATE TABLE IF NOT EXISTS "biomed"."investigation" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "description" text,
  "pi_name" text,
  "funding_source" text,
  "start_date" date,
  "end_date" date,
  CHECK (end_date is null or end_date >= start_date)
);
COMMENT ON TABLE "biomed"."investigation" IS 'Top-level research project or grant umbrella that one or more studies belong to.';
COMMENT ON COLUMN "biomed"."investigation"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."investigation"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."investigation"."code" IS 'Short human code, e.g. INV-2026-CANCER.';
COMMENT ON COLUMN "biomed"."investigation"."pi_name" IS 'Principal investigator.';

CREATE TABLE IF NOT EXISTS "biomed"."study" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigation_id" uuid NOT NULL REFERENCES "biomed"."investigation"("id"),
  "code" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "objective" text,
  "design_description" text,
  "ethics_approval_id" text,
  "status" text NOT NULL DEFAULT 'planned',
  CHECK (status in ('planned', 'active', 'completed', 'archived'))
);
COMMENT ON TABLE "biomed"."study" IS 'A single defined study within an investigation: one protocol-driven body of work with its own subjects/specimens and data. This is the unit that access control (study_member) is scoped to.';
COMMENT ON COLUMN "biomed"."study"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."study"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."study"."code" IS 'Short human code, e.g. STUDY-2026-001.';
COMMENT ON COLUMN "biomed"."study"."design_description" IS 'Free-text summary of the study design.';
COMMENT ON COLUMN "biomed"."study"."ethics_approval_id" IS 'IRB / ethics committee reference number, if human or animal subjects are involved.';
COMMENT ON COLUMN "biomed"."study"."status" IS 'planned | active | completed | archived';
CREATE INDEX IF NOT EXISTS idx_study_investigation_id ON "biomed"."study" ("investigation_id");

CREATE TABLE IF NOT EXISTS "biomed"."study_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_id" uuid NOT NULL REFERENCES "biomed"."study"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'contributor',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("study_id", "user_id"),
  CHECK (role in ('owner', 'contributor', 'viewer'))
);
COMMENT ON TABLE "biomed"."study_member" IS 'Who has access to a study, and at what level. This is the table access-control policies check against (see 90_access_control.yml).';
COMMENT ON COLUMN "biomed"."study_member"."role" IS 'owner | contributor | viewer. Only enforced as read/write today; see app README for the reduced v1 scope.';

CREATE TABLE IF NOT EXISTS "biomed"."protocol" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "is_current" boolean NOT NULL DEFAULT True,
  "superseded_by" uuid REFERENCES "biomed"."protocol"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "description" text,
  "external_doi" text,
  UNIQUE ("code", "version")
);
COMMENT ON TABLE "biomed"."protocol" IS 'A versioned, reusable method description (SOP) - e.g. an extraction or acquisition protocol. Runs reference a specific protocol *version* so that changing a protocol later never changes what a past run says it followed.';
COMMENT ON COLUMN "biomed"."protocol"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."protocol"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."protocol"."superseded_by" IS 'Set once a newer version exists; points at that row''s id.';
COMMENT ON COLUMN "biomed"."protocol"."code" IS 'Stable identifier shared by all versions, e.g. PROT-RNA-EXTRACTION.';
COMMENT ON COLUMN "biomed"."protocol"."version" IS 'Sequential amendment number: 1, 2, 3, ...';
COMMENT ON COLUMN "biomed"."protocol"."description" IS 'Full method text, or a summary if kept externally.';
COMMENT ON COLUMN "biomed"."protocol"."external_doi" IS 'e.g. a registered protocols.io DOI, if the full method lives there.';

CREATE TABLE IF NOT EXISTS "biomed"."instrument" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "manufacturer" text,
  "model" text,
  "serial_number" text UNIQUE,
  "location" text,
  "calibration_date" date,
  "calibration_due" date
);
COMMENT ON TABLE "biomed"."instrument" IS 'Physical equipment used to acquire raw data.';
COMMENT ON COLUMN "biomed"."instrument"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."instrument"."updated_by" IS 'User who last modified this record.';
