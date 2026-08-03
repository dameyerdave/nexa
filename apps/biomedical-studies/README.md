# biomedical-studies

Tracks biomedical studies end to end: who/what was studied, what was done
to generate data, and where every byte of that data actually lives - so
that any result can be traced back to exactly the specimen, protocol
version, instrument, and pipeline version that produced it.

Installs into its own Postgres schema, `biomed` (nothing lives in `public`).

## The model

```
investigation ──< study ──< study_member (who can access this study)
                    │
                    ├──< subject ──< specimen ──< specimen        (aliquots/extracts,
                    │                  │             ▲ parent_specimen_id     self-referencing)
                    │                  │
                    │                  └──< run >── protocol (versioned)
                    │                         >── instrument
                    │
                    └──< run ──< raw_file  (bytes live in Supabase Storage)
                                     │
                                     └──< analysis_input >── analysis ── pipeline (versioned)
                                                                  │
                                                                  └──< derived_file  (bytes in Storage)
```

Read the chain backwards from any file and you get full provenance:
`derived_file → analysis → pipeline` tells you *what code, which version,
produced this*; `analysis → analysis_input → raw_file → run → specimen →
subject → study` tells you *from what material, on what instrument, under
what protocol version*. That round trip - result to source, and source to
every result derived from it - is the actual point of this schema.

## Walking it with real data

```sql
select
  sub.external_id, sp.specimen_type, r.assay_type,
  p.name || ' v' || p.version as protocol,
  rf.file_name as raw_file, pl.name || ' ' || pl.version as pipeline,
  df.file_name as derived_file
from biomed.subject sub
join biomed.specimen sp on sp.subject_id = sub.id
join biomed.run r on r.specimen_id = sp.id
join biomed.protocol p on p.id = r.protocol_id
join biomed.raw_file rf on rf.run_id = r.id
join biomed.analysis_input ai on ai.raw_file_id = rf.id
join biomed.analysis a on a.id = ai.analysis_id
join biomed.pipeline pl on pl.id = a.pipeline_id
join biomed.derived_file df on df.analysis_id = a.id;
```

```
 external_id | specimen_type | assay_type |     protocol      |  raw_file  |       pipeline        | derived_file
-------------+---------------+------------+--------------------+------------+------------------------+--------------
 SUBJ-001    | plasma        | mass-spec  | Plasma extract v1  | sample.raw | ms-quant-pipeline 1.0.0| results.csv
```

## Reproducibility, concretely

Every design choice below exists to answer "can I trust this result, and
can I reproduce it" - not as an abstract goal, but as specific columns:

- **Protocols and pipelines are versioned, never edited in place.**
  `protocol` and `pipeline` use the `supersedable` mixin: changing a method
  means inserting a new row (new `version`) and pointing the old one at it
  via `superseded_by`. A `run` or `analysis` row always points at the exact
  version that was in effect, forever - editing "the RNA extraction
  protocol" next year can't silently change what an old run says it
  followed.
- **Every file has a checksum.** `raw_file.checksum_sha256` and
  `derived_file.checksum_sha256` are computed at ingestion and never
  updated. That's the integrity proof: at any later point, re-hash the
  object in Storage and confirm it still matches what's on record.
- **Raw and derived files are treated as immutable.** A correction is a
  new row (and usually a new `run`/`analysis`), never an `UPDATE` of
  `storage_path`/`checksum_sha256` on an existing one. Nothing in the
  schema enforces this at the database level yet (see "Extending this" -
  a `BEFORE UPDATE` trigger rejecting changes to those columns would make
  it a hard guarantee instead of a convention).
- **Pipelines pin `source_commit` / `container_image`.** A pipeline
  *name* is not reproducible; a specific git commit or, better, a
  container image digest is. Use whichever is verifiable for your setup.
- **`run.parameters` / `analysis.parameters` are `jsonb`, deliberately.**
  Instrument settings and CLI args vary too much by assay/pipeline to be
  fixed columns. Anything you'll routinely filter or join on should be a
  real column instead - `jsonb` is for the long tail, not an excuse to
  avoid modeling.
- **Every row records who and when.** The `auditable` mixin
  (`created_at/by`, `updated_at/by`) is on every entity table.

## Privacy by design

`subject` intentionally has no name, date of birth, MRN, or address -
only `external_id` (a de-identified code the study team assigns, e.g.
`SUBJ-014`) and research-relevant covariates (`species`, `sex`, `cohort`,
`age_at_enrollment_years` - age, not a birth date). If you need to
re-identify a subject, keep that mapping in a separate, access-restricted
system outside this schema. This keeps the research database safe to share
broadly within a study team without itself being a store of personal data.

## Raw data in Storage

File bytes are never in Postgres - `raw_file`/`derived_file` are pointers
(`storage_bucket` + `storage_path` + checksum) into Supabase Storage.
Installing this app provisions two private buckets:

- `raw-instrument-data` - instrument output, pointed to by `raw_file`
- `derived-data` - pipeline output, pointed to by `derived_file`

**Path convention (enforced by the storage access policy, not the
database):** every object key must start with `<study_id>/`, e.g.
`raw-instrument-data/<study_id>/<run_id>/sample.raw`. Whatever uploads a
file has to know the study id up front - which it already does, since it
has to create the `run` row (which requires `study_id`) before it can link
a `raw_file` to it anyway.

## Access control

Membership-based, via `study_member` (`study_id`, `user_id`, `role`) and a
`biomed.can_access_study(study_id)` helper function. A user sees a study's
`study`/`subject`/`specimen`/`run`/`raw_file` rows - and can up-/download
objects in the two Storage buckets under that study's prefix - if and only
if they have a `study_member` row for it. Everyone else, including
unauthenticated (`anon`) requests, gets nothing: `anon` isn't even granted
`USAGE` on the `biomed` schema, so it's denied before RLS is ever
evaluated.

**v1 scope, on purpose:**
- Any role (`owner`/`contributor`/`viewer`) currently has the same
  read/write access - the column is there for later, not enforced yet.
- Reference/shared tables (`protocol`, `instrument`, `pipeline`,
  `ontology_term`) and downstream tables without a direct `study_id`
  (`analysis`, `derived_file`) have no RLS at all: any authenticated user
  can read and write them. Scoping `derived_file` to its study would mean
  walking `derived_file → analysis → analysis_input → raw_file → run →
  study_id`, which is easy to add (another `can_access_study_via_*`
  function, same pattern as `can_access_study_via_run`) but left out for
  now to keep v1 legible.

## Controlled vocabulary (optional)

`specimen_type`, `assay_type`, etc. are free text so the schema is usable
immediately. `ontology_term` + `entity_term_tag` let you progressively tag
any row with a real term (UBERON, NCIT, SNOMED, ...) without migrating
those columns to hard foreign keys later:

```sql
insert into biomed.entity_term_tag (entity_table, entity_id, ontology_term_id)
values ('specimen', '<specimen.id>', '<ontology_term.id for UBERON:0000178 "blood">');
```

## Dashboard

`dashboards/overview.yml` defines a "Biomedical studies overview" Metabase
dashboard: active study count, specimen/run volume, a pending-analysis
backlog indicator, and a per-study rollup table - all native SQL against
`biomed.*`, no manual clicking-through Metabase required. Apply it (and
the schema first, if you haven't) with:

```sh
sh scripts/apply_schema.sh apps/biomedical-studies
python3 scripts/apply_dashboards.py apps/biomedical-studies
```

then open Metabase and look for it under "Our analytics". Add more cards
by editing the YAML and re-running - see `apps/README.md` for the format.

## Extending this

- **Per-role write policies**: split each `study_members_all` (`FOR ALL`)
  policy into `FOR SELECT` (any role) / `FOR INSERT, UPDATE, DELETE`
  (`role in ('owner','contributor')`) once viewer-only access matters.
- **Study-scope `analysis`/`derived_file`**: add
  `can_access_study_via_analysis(analysis_id)` mirroring
  `can_access_study_via_run`, and a matching `policies:` entry.
- **Enforce immutability**: a `BEFORE UPDATE` trigger on `raw_file` /
  `derived_file` rejecting changes to `storage_path`/`checksum_sha256`.
- **New study types**: this schema is deliberately generic
  (subject/specimen/run/file) rather than assay-specific. A new assay
  type is usually just a new `assay_type` value plus whatever goes in
  `run.parameters` - not a new table.
