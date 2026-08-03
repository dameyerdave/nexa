#!/usr/bin/env python3
"""
Compiles an app's YAML schema (apps/<app>/schema/*.yml) into SQL migration
files (apps/<app>/migrations/*.sql).

Usage:
    python3 scripts/compile_schema.py apps/biomedical-studies

The YAML DSL is intentionally small - see apps/README.md for the full
reference. In short, each schema/*.yml file may define:

    mixins:
      <mixin_name>:
        columns: [<column>, ...]

    tables:
      - name: <table_name>
        description: <text>
        mixins: [<mixin_name>, ...]
        columns: [<column>, ...]
        unique: [[<col>, <col>], ...]
        indexes: [[<col>], ...]
        checks: ["<sql bool expr>", ...]

    functions:
      - name: <function_name>
        sql: |
          create or replace function ... $$ ... $$;

    policies:
      - table: <table_name>
        enable_rls: true                        # default true
        rules:
          - name: <policy_name>
            command: all | select | insert | update | delete
            using: "<sql bool expr>"
            check: "<sql bool expr>"             # defaults to `using`

    raw_sql:
      - |
        grant usage on schema biomed to authenticated;
        -- escape hatch for anything not covered above (GRANTs, one-off DDL)

Column shape:
    name: <text>
    type: <postgres type, e.g. uuid, text, timestamptz, jsonb>
    primary_key: true|false
    nullable: true|false            # default true
    unique: true|false
    default: "<sql expression>"
    references: "<table>.<column>", "<schema>.<table>.<column>", or
                "self.<column>" for a self-referencing FK inside a mixin
    on_delete: cascade|restrict|set null

Tables/files must be ordered so a table is declared after anything it
references (foreign keys are not topologically sorted). `policies:` is a
separate top-level list (not nested under `tables:`) specifically so
policies can live in a later file than the tables/functions they depend on.
"""

import sys
from pathlib import Path

import yaml


def load_app(app_dir: Path):
    app_yml = yaml.safe_load((app_dir / "app.yml").read_text())
    schema_files = sorted((app_dir / "schema").glob("*.yml"))
    return app_yml, schema_files


def col_sql(col: dict, own_schema: str) -> str:
    parts = [f'"{col["name"]}" {col["type"]}']
    if col.get("primary_key"):
        parts.append("PRIMARY KEY")
    if col.get("nullable") is False:
        parts.append("NOT NULL")
    if "default" in col:
        parts.append(f'DEFAULT {col["default"]}')
    if col.get("unique"):
        parts.append("UNIQUE")
    if "references" in col:
        ref_parts = col["references"].split(".")
        if len(ref_parts) == 2:
            ref_schema = own_schema
            ref_table, ref_col = ref_parts
        elif len(ref_parts) == 3:
            ref_schema, ref_table, ref_col = ref_parts
        else:
            raise ValueError(f"bad references value: {col['references']!r}")
        ref_sql = f'REFERENCES "{ref_schema}"."{ref_table}"("{ref_col}")'
        if col.get("on_delete"):
            ref_sql += f' ON DELETE {col["on_delete"].upper()}'
        parts.append(ref_sql)
    return " ".join(parts)


def expand_columns(table: dict, mixins: dict) -> list:
    """Expand mixins into concrete columns, resolving `references: self.*`
    (used by mixins so a self-referencing FK works no matter which table
    the mixin is applied to) to the table's own name."""
    columns = []
    for mixin_name in table.get("mixins", []):
        columns.extend(mixins[mixin_name]["columns"])
    columns.extend(table.get("columns", []))

    resolved = []
    for c in columns:
        c = dict(c)
        if c.get("references", "").startswith("self."):
            c["references"] = table["name"] + c["references"][len("self"):]
        resolved.append(c)
    return resolved


def table_sql(table: dict, mixins: dict, schema: str) -> str:
    name = table["name"]
    qualified = f'"{schema}"."{name}"'
    columns = expand_columns(table, mixins)

    body_lines = [f"  {col_sql(c, schema)}" for c in columns]
    for uniq in table.get("unique", []):
        cols = ", ".join(f'"{c}"' for c in uniq)
        body_lines.append(f"  UNIQUE ({cols})")
    for check in table.get("checks", []):
        body_lines.append(f"  CHECK ({check})")

    sql = [f"CREATE TABLE IF NOT EXISTS {qualified} (\n" + ",\n".join(body_lines) + "\n);"]

    if table.get("description"):
        desc = table["description"].strip().replace("'", "''")
        sql.append(f"COMMENT ON TABLE {qualified} IS '{desc}';")
    for c in columns:
        if c.get("description"):
            desc = c["description"].strip().replace("'", "''")
            sql.append(f'COMMENT ON COLUMN {qualified}."{c["name"]}" IS \'{desc}\';')

    for idx_cols in table.get("indexes", []):
        idx_name = f"idx_{name}_" + "_".join(idx_cols)
        cols = ", ".join(f'"{c}"' for c in idx_cols)
        sql.append(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {qualified} ({cols});")

    return "\n".join(sql)


def policy_sql(entry: dict, schema: str) -> str:
    """Top-level `policies:` entries (as opposed to per-table `rls:`) so
    policies can be declared in a later file than the tables/functions they
    depend on - important since a policy's USING clause often calls a
    function that queries a membership table, both of which must already
    exist."""
    table = entry["table"]
    qualified = f'"{schema}"."{table}"'
    sql = []
    if entry.get("enable_rls", True):
        sql.append(f"ALTER TABLE {qualified} ENABLE ROW LEVEL SECURITY;")
    for rule in entry.get("rules", []):
        pname = rule["name"]
        command = rule.get("command", "all").upper()
        using = rule.get("using")
        check = rule.get("check", using)
        sql.append(f'DROP POLICY IF EXISTS "{pname}" ON {qualified};')
        stmt = f'CREATE POLICY "{pname}" ON {qualified} FOR {command}'
        if using:
            stmt += f"\n  USING ({using})"
        if command in ("ALL", "INSERT", "UPDATE") and check:
            stmt += f"\n  WITH CHECK ({check})"
        sql.append(stmt + ";")
    return "\n".join(sql)


def compile_app(app_dir: Path):
    app_yml, schema_files = load_app(app_dir)
    schema = app_yml["schema_namespace"]

    mixins: dict = {}
    for f in schema_files:
        doc = yaml.safe_load(f.read_text()) or {}
        mixins.update(doc.get("mixins", {}))

    migrations_dir = app_dir / "migrations"
    migrations_dir.mkdir(exist_ok=True)
    for old in migrations_dir.glob("*.sql"):
        old.unlink()

    migration_index = 1
    first_output = True
    for f in schema_files:
        doc = yaml.safe_load(f.read_text()) or {}
        tables = doc.get("tables", [])
        functions = doc.get("functions", [])
        policies = doc.get("policies", [])
        raw_sql = doc.get("raw_sql", [])
        if not tables and not functions and not policies and not raw_sql:
            continue

        chunks = []
        if first_output:
            chunks.append(f'CREATE SCHEMA IF NOT EXISTS "{schema}";')
            first_output = False

        for fn in functions:
            chunks.append(fn["sql"].strip())

        for table in tables:
            chunks.append(table_sql(table, mixins, schema))

        for entry in policies:
            chunks.append(policy_sql(entry, schema))

        for stmt in raw_sql:
            chunks.append(stmt.strip())

        out_path = migrations_dir / f"{migration_index:04d}_{f.stem}.sql"
        header = (
            f"-- Generated from {f.relative_to(app_dir)} by scripts/compile_schema.py\n"
            "-- Do not edit by hand - edit the YAML source and recompile.\n\n"
        )
        out_path.write_text(header + "\n\n".join(chunks) + "\n")
        print(f"wrote {out_path}")
        migration_index += 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: compile_schema.py <app_dir>", file=sys.stderr)
        sys.exit(1)
    compile_app(Path(sys.argv[1]))
