-- Generated from schema/50_ontology.yml by scripts/compile_schema.py
-- Do not edit by hand - edit the YAML source and recompile.

CREATE TABLE IF NOT EXISTS "biomed"."ontology_term" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ontology" text NOT NULL,
  "term_id" text NOT NULL,
  "label" text NOT NULL,
  UNIQUE ("ontology", "term_id")
);
COMMENT ON TABLE "biomed"."ontology_term" IS 'A single term from a controlled vocabulary.';
COMMENT ON COLUMN "biomed"."ontology_term"."ontology" IS 'e.g. UBERON, NCIT, SNOMED.';
COMMENT ON COLUMN "biomed"."ontology_term"."term_id" IS 'e.g. UBERON:0000178.';

CREATE TABLE IF NOT EXISTS "biomed"."entity_term_tag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_table" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "ontology_term_id" uuid NOT NULL REFERENCES "biomed"."ontology_term"("id"),
  UNIQUE ("entity_table", "entity_id", "ontology_term_id")
);
COMMENT ON TABLE "biomed"."entity_term_tag" IS 'Generic tag linking any row in this schema to an ontology term, e.g. (entity_table=''specimen'', entity_id=<specimen.id>) tagged with UBERON:0000178 ("blood").';
CREATE INDEX IF NOT EXISTS idx_entity_term_tag_entity_table_entity_id ON "biomed"."entity_term_tag" ("entity_table", "entity_id");
