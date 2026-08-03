-- Generated from schema/30_acquisition.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

CREATE TABLE IF NOT EXISTS "biomed"."run" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_id" uuid NOT NULL REFERENCES "biomed"."study"("id"),
  "specimen_id" uuid REFERENCES "biomed"."specimen"("id"),
  "protocol_id" uuid NOT NULL REFERENCES "biomed"."protocol"("id"),
  "instrument_id" uuid REFERENCES "biomed"."instrument"("id"),
  "performed_by" uuid REFERENCES "auth"."users"("id"),
  "performed_by_name" text,
  "run_date" timestamptz NOT NULL,
  "assay_type" text NOT NULL,
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text
);
COMMENT ON TABLE "biomed"."run" IS 'A single data-acquisition event on an instrument: which specimen, which protocol *version*, which instrument, and the parameters used. This is the row every raw file must point back to, and the anchor of the whole provenance chain from subject to result.';
COMMENT ON COLUMN "biomed"."run"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."run"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."run"."specimen_id" IS 'Null for instrument QC/calibration runs not tied to a specimen.';
COMMENT ON COLUMN "biomed"."run"."protocol_id" IS 'The exact protocol version followed - required for every run.';
COMMENT ON COLUMN "biomed"."run"."performed_by" IS 'Operator, if they have a platform account.';
COMMENT ON COLUMN "biomed"."run"."performed_by_name" IS 'Free-text operator name, for operators without a platform account.';
COMMENT ON COLUMN "biomed"."run"."assay_type" IS 'e.g. RNA-seq, mass-spec, flow-cytometry.';
COMMENT ON COLUMN "biomed"."run"."parameters" IS 'Instrument/assay settings that vary too much by assay_type to be fixed columns (e.g. laser power, gradient, cycle count). Keep anything you''ll routinely filter/join on as a real column instead - jsonb is for the long tail, not everything.';
CREATE INDEX IF NOT EXISTS idx_run_study_id ON "biomed"."run" ("study_id");
CREATE INDEX IF NOT EXISTS idx_run_specimen_id ON "biomed"."run" ("specimen_id");
CREATE INDEX IF NOT EXISTS idx_run_protocol_id ON "biomed"."run" ("protocol_id");
