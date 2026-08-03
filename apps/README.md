# Apps

An "app" here is what a Splunk app is to Splunk: a self-contained folder of
*configuration* - not code - that adds a capability to the platform. Install
one and you get a Postgres schema (tables, relationships, access rules) and,
eventually, a set of Metabase dashboards, all defined in plain YAML.

```
apps/
  <app-id>/
    app.yml                # manifest: id, name, version, description, schema_namespace
    schema/
      00_core.yml           # mixins - shared column bundles
      10_something.yml      # tables, in the order they must be created
      ...
      90_access_control.yml # functions + RLS policies + grants (see below)
    migrations/              # generated SQL - committed, never hand-edited
      0001_10_something.sql
      ...
    dashboards/               # (future) Metabase dashboards-as-code
    README.md                 # what this app's data model actually means
```

Only `app.yml` and `schema/*.yml` are hand-written. `migrations/*.sql` is
compiler output - see [`apps/biomedical-studies`](./biomedical-studies) for
a complete real example.

## Workflow

```sh
# after editing any schema/*.yml:
python3 scripts/compile_schema.py apps/<app-id>

# apply to a running stack:
sh scripts/apply_schema.sh apps/<app-id>

# make the new schema visible over the REST API and in Studio's table editor:
# add its schema_namespace to PGRST_DB_SCHEMAS in .env, then:
docker compose up -d rest studio
```

Migrations are generated fresh each time (the `migrations/` directory is
wiped and rewritten by the compiler) and use `CREATE TABLE IF NOT EXISTS`,
so re-applying is safe but **schema changes after first install need a real
migration story** - this compiler is a from-scratch installer, not an
altering migrator. Today, changing a table means editing the YAML, then
hand-writing an `ALTER TABLE ...` migration for existing installs (or
recreating the schema, if there's no data to lose yet). That's a known,
deliberate limitation - see "What this doesn't do" below.

## The YAML DSL

Every `schema/*.yml` file may define any of these top-level keys. Files are
processed in filename order, and *within* that order top-to-bottom - that
ordering is also the only dependency resolution there is, which is why
files are numbered (`00_`, `10_`, `20_`, ...): put things before whatever
references them.

### `mixins:` (typically only in `00_core.yml`)

A named, reusable bundle of columns. Give a table `mixins: [auditable]` and
its columns are prepended before the table's own `columns:`.

```yaml
mixins:
  auditable:
    columns:
      - {name: created_at, type: timestamptz, nullable: false, default: "now()"}
      - {name: created_by, type: uuid, references: "auth.users.id"}
```

### `tables:`

```yaml
tables:
  - name: study
    description: "Shown as a SQL COMMENT ON TABLE - visible in Studio."
    mixins: [auditable]
    columns:
      - name: id
        type: uuid
        primary_key: true
        default: "gen_random_uuid()"
      - name: investigation_id
        type: uuid
        nullable: false
        references: "investigation.id"     # same-schema table
      - name: created_by
        type: uuid
        references: "auth.users.id"        # schema.table.column, fully qualified
      - name: parent_id
        type: uuid
        references: "self.id"              # self-referencing FK, resolved to this table's own name
    unique: [[investigation_id, code]]      # composite unique constraints
    indexes: [[investigation_id]]
    checks: ["end_date is null or end_date >= start_date"]
```

Column keys: `name`, `type` (a real Postgres type name - no abstraction
layer), `primary_key`, `nullable` (default `true`), `unique`, `default` (a
raw SQL expression), `references`, `on_delete`, `description` (becomes a
`COMMENT ON COLUMN`).

### `functions:`

An escape hatch for anything the table DSL can't express - almost always a
small `SECURITY DEFINER` helper used by RLS policies. The `sql` value is
emitted verbatim.

```yaml
functions:
  - name: can_access_study
    sql: |
      create or replace function biomed.can_access_study(p_study_id uuid)
      returns boolean language sql security definer stable
      set search_path = biomed, pg_temp
      as $$ select exists (...) $$;
```

### `policies:`

Deliberately **not** nested under `tables:`, so RLS policies can live in a
later file than the tables/functions they depend on (a policy's `using`
clause typically calls a function that queries a membership table - both
need to exist first).

```yaml
policies:
  - table: study
    enable_rls: true          # default true
    rules:
      - name: study_members_all
        command: all           # all | select | insert | update | delete
        using: "biomed.can_access_study(id)"
        # check: defaults to `using` for insert/update
```

### `raw_sql:`

The final escape hatch - a list of raw SQL blocks emitted as-is. Used for
things that are neither a table, function, nor policy - almost always
`GRANT`/`ALTER DEFAULT PRIVILEGES` statements, since **RLS only restricts
which rows a role can see - the role also needs a base `GRANT` on the
schema and table to touch it at all.** Forgetting this is the single
easiest mistake to make with this DSL (ask me how I know - see git log).

```yaml
raw_sql:
  - |
    grant usage on schema biomed to authenticated;
    grant select, insert, update, delete on all tables in schema biomed to authenticated;
    alter default privileges in schema biomed
      grant select, insert, update, delete on tables to authenticated;
```

## What this doesn't do

On purpose, to stay a small tool rather than a framework:

- **No topological sort.** Table order in the YAML is the creation order.
- **No ALTER-based schema evolution.** Compiling only ever emits
  `CREATE ... IF NOT EXISTS`; changing an existing column's type/nullability
  on a live database needs a hand-written migration.
- **No dashboards yet.** `dashboards/` is reserved for a future
  Metabase-as-code layer (dashboard/question definitions in YAML, applied
  via the Metabase API) - not built yet.
- **No per-role write policies.** Where an app has a `role` column (e.g.
  `study_member.role`), it may not yet be enforced differently for
  `viewer` vs `contributor` - check the individual app's README for its
  actual v1 scope.
