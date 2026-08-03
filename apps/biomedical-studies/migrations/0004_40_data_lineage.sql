-- Generated from schema/40_data_lineage.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

CREATE TABLE IF NOT EXISTS "biomed"."pipeline" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "is_current" boolean NOT NULL DEFAULT True,
  "superseded_by" uuid REFERENCES "biomed"."pipeline"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "version" text NOT NULL,
  "source_repo_url" text,
  "source_commit" text,
  "container_image" text,
  "description" text,
  UNIQUE ("name", "version")
);
COMMENT ON TABLE "biomed"."pipeline" IS 'A versioned analysis pipeline/workflow definition. Pin source_commit and/or container_image so an analysis row can point at the *exact* code that ran, not just a pipeline name.';
COMMENT ON COLUMN "biomed"."pipeline"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."pipeline"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."pipeline"."superseded_by" IS 'Set once a newer version exists; points at that row''s id.';
COMMENT ON COLUMN "biomed"."pipeline"."name" IS 'e.g. rnaseq-star-salmon.';
COMMENT ON COLUMN "biomed"."pipeline"."version" IS 'Semver or git tag, e.g. 1.4.2.';
COMMENT ON COLUMN "biomed"."pipeline"."source_commit" IS 'Git commit SHA of the exact code that ran.';
COMMENT ON COLUMN "biomed"."pipeline"."container_image" IS 'e.g. a docker image digest (sha256:...) - the strongest reproducibility anchor available.';

CREATE TABLE IF NOT EXISTS "biomed"."raw_file" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "biomed"."run"("id"),
  "storage_bucket" text NOT NULL,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "file_format" text,
  "size_bytes" bigint,
  "checksum_sha256" text NOT NULL,
  "acquired_at" timestamptz,
  UNIQUE ("storage_bucket", "storage_path")
);
COMMENT ON TABLE "biomed"."raw_file" IS 'A raw instrument output file, stored in Supabase Storage and pointed to from here. Always traceable to the run that produced it.';
COMMENT ON COLUMN "biomed"."raw_file"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."raw_file"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."raw_file"."storage_path" IS 'Object key within the bucket. Must start with <study_id>/ - see 95_storage.yml, storage access policy relies on this.';
COMMENT ON COLUMN "biomed"."raw_file"."file_format" IS 'e.g. fastq.gz, dicom, raw.';
COMMENT ON COLUMN "biomed"."raw_file"."checksum_sha256" IS 'SHA-256 of the file contents, computed at ingestion - the integrity/reproducibility anchor for this file.';
COMMENT ON COLUMN "biomed"."raw_file"."acquired_at" IS 'When the instrument actually wrote the file, if different from run.run_date.';
CREATE INDEX IF NOT EXISTS idx_raw_file_run_id ON "biomed"."raw_file" ("run_id");
CREATE INDEX IF NOT EXISTS idx_raw_file_checksum_sha256 ON "biomed"."raw_file" ("checksum_sha256");

CREATE TABLE IF NOT EXISTS "biomed"."analysis" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pipeline_id" uuid NOT NULL REFERENCES "biomed"."pipeline"("id"),
  "run_by" uuid REFERENCES "auth"."users"("id"),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'running',
  "log_storage_path" text,
  CHECK (status in ('running', 'succeeded', 'failed'))
);
COMMENT ON TABLE "biomed"."analysis" IS 'One execution of a pipeline (an "activity" in provenance terms): which pipeline version, who/what ran it, with which parameters, and what its inputs/outputs were (see analysis_input and derived_file).';
COMMENT ON COLUMN "biomed"."analysis"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."analysis"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."analysis"."parameters" IS 'CLI args / config for this specific execution.';
COMMENT ON COLUMN "biomed"."analysis"."status" IS 'running | succeeded | failed';
COMMENT ON COLUMN "biomed"."analysis"."log_storage_path" IS 'Path to the execution log in Storage, if kept.';
CREATE INDEX IF NOT EXISTS idx_analysis_pipeline_id ON "biomed"."analysis" ("pipeline_id");

CREATE TABLE IF NOT EXISTS "biomed"."derived_file" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "auth"."users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "analysis_id" uuid NOT NULL REFERENCES "biomed"."analysis"("id"),
  "storage_bucket" text NOT NULL,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "file_format" text,
  "size_bytes" bigint,
  "checksum_sha256" text NOT NULL,
  "data_type" text,
  UNIQUE ("storage_bucket", "storage_path")
);
COMMENT ON TABLE "biomed"."derived_file" IS 'An output of an analysis (processed/derived data), stored the same way as raw_file. Always traceable to the analysis that produced it, and from there to its pipeline and inputs.';
COMMENT ON COLUMN "biomed"."derived_file"."created_by" IS 'User who created this record.';
COMMENT ON COLUMN "biomed"."derived_file"."updated_by" IS 'User who last modified this record.';
COMMENT ON COLUMN "biomed"."derived_file"."storage_path" IS 'Object key within the bucket. Must start with <study_id>/ - see 95_storage.yml, storage access policy relies on this.';
COMMENT ON COLUMN "biomed"."derived_file"."data_type" IS 'e.g. aligned-bam, count-matrix, qc-report.';
CREATE INDEX IF NOT EXISTS idx_derived_file_analysis_id ON "biomed"."derived_file" ("analysis_id");

CREATE TABLE IF NOT EXISTS "biomed"."analysis_input" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "analysis_id" uuid NOT NULL REFERENCES "biomed"."analysis"("id") ON DELETE CASCADE,
  "raw_file_id" uuid REFERENCES "biomed"."raw_file"("id"),
  "derived_file_id" uuid REFERENCES "biomed"."derived_file"("id"),
  CHECK ((raw_file_id is not null)::int + (derived_file_id is not null)::int = 1)
);
COMMENT ON TABLE "biomed"."analysis_input" IS 'Join table recording exactly which files fed an analysis - the other half of the provenance chain (an analysis can consume raw files, previously-derived files, or both, e.g. when chaining pipelines).';
CREATE INDEX IF NOT EXISTS idx_analysis_input_analysis_id ON "biomed"."analysis_input" ("analysis_id");
CREATE INDEX IF NOT EXISTS idx_analysis_input_raw_file_id ON "biomed"."analysis_input" ("raw_file_id");
CREATE INDEX IF NOT EXISTS idx_analysis_input_derived_file_id ON "biomed"."analysis_input" ("derived_file_id");
