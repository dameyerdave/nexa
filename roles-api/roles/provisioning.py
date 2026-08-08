"""What actually happens when a dbadmin creates a project from the
portal's /admin/projects page: a new Postgres schema (granted to
`authenticated`, matching the raw_sql grant pattern every apps/<id>
package hand-writes - see apps/README.md) and a matching Metabase database
connection scoped to just that schema. No starter tables - an admin adds
those afterwards via Studio, or later graduates the project into a real
apps/<id> YAML package if it needs RLS policies or dashboards.

Schema creation goes through pg-meta (the same internal service Supabase
Studio's own SQL editor uses - see deployment-meta.yaml) rather than a
direct Postgres connection of roles-api's own, so this service doesn't
need a Postgres client library or its own DB session handling. Metabase
still needs a real `host`/`port`/`dbname`/`password` connection (pg-meta
has no bearing on that), which is why POSTGRES_* settings are still read
below - only for building that `details` payload, never to connect
directly."""

import json
import re
import urllib.error
import urllib.request

from django.conf import settings


class ProvisioningError(Exception):
    """Raised for anything that should surface as an error to the portal -
    an invalid/colliding name, or a downstream Postgres/Metabase failure."""


def slugify_schema_name(raw: str) -> str:
    name = raw.strip().lower()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        raise ProvisioningError("Project name must contain at least one letter or digit.")
    if name[0].isdigit():
        name = f"p_{name}"
    return name[:63]


def _meta_query(sql: str):
    req = urllib.request.Request(
        f"{settings.PG_META_URL.rstrip('/')}/query",
        data=json.dumps({"query": sql}).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            detail = json.loads(body).get("error", body)
        except json.JSONDecodeError:
            detail = body
        raise ProvisioningError(f"Postgres error: {detail}") from e
    except urllib.error.URLError as e:
        raise ProvisioningError(f"Could not reach Postgres (via pg-meta): {e.reason}") from e


def _create_schema(schema_name: str) -> None:
    # No pre-check for an existing schema of this name - `create schema`
    # (no IF NOT EXISTS) fails loudly via pg-meta if it's already taken,
    # which _meta_query turns into a ProvisioningError. pg-meta runs the
    # whole query string as one implicit transaction, so a failure on any
    # later statement rolls back the schema creation too.
    #
    # Identifiers can't be parameterized, but schema_name only ever
    # contains [a-z0-9_] (see slugify_schema_name above) - it's never raw
    # user input by the time it gets here.
    _meta_query(
        f'create schema "{schema_name}"; '
        f'grant usage on schema "{schema_name}" to authenticated; '
        f'grant select, insert, update, delete on all tables in schema "{schema_name}" to authenticated; '
        f'alter default privileges in schema "{schema_name}" '
        "grant select, insert, update, delete on tables to authenticated;"
    )


class _Metabase:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = None

    def _request(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.session:
            req.add_header("X-Metabase-Session", self.session)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise ProvisioningError(f"Metabase {method} {path} failed: HTTP {e.code}") from e
        except urllib.error.URLError as e:
            raise ProvisioningError(f"Could not reach Metabase: {e.reason}") from e

    def ensure_session(self) -> None:
        if self.session:
            return
        resp = self._request(
            "POST",
            "/api/session",
            {"username": settings.METABASE_ADMIN_EMAIL, "password": settings.METABASE_ADMIN_PASSWORD},
        )
        self.session = resp["id"]

    def create_database(self, name: str, schema_name: str) -> int:
        self.ensure_session()
        details = {
            "host": settings.POSTGRES_HOST,
            "port": int(settings.POSTGRES_PORT),
            "dbname": settings.POSTGRES_DB,
            "user": "postgres",
            "password": settings.POSTGRES_SUPERUSER_PASSWORD,
            "schema-filters-type": "inclusion",
            "schema-filters-patterns": schema_name,
        }
        db = self._request(
            "POST",
            "/api/database",
            {"engine": "postgres", "name": name, "details": details, "is_full_sync": True},
        )
        return db["id"]


def create_project(name: str, created_by: str):
    """Creates the schema (raising ProvisioningError on a name/schema
    collision) and returns (project, metabase_error). A Metabase failure
    doesn't roll back the schema - it's cheap to keep and re-provisioning
    would just collide with it - the project is still created with
    metabase_database_id=None so the portal can offer a retry."""

    from .models import Project

    schema_name = slugify_schema_name(name)
    if Project.objects.filter(schema_name=schema_name).exists():
        raise ProvisioningError(f"A project already maps to schema '{schema_name}' - choose a different name.")

    _create_schema(schema_name)

    metabase_database_id = None
    metabase_error = None
    try:
        metabase_database_id = _Metabase(settings.METABASE_URL).create_database(name.strip(), schema_name)
    except ProvisioningError as e:
        metabase_error = str(e)

    project = Project.objects.create(
        name=name.strip(),
        schema_name=schema_name,
        metabase_database_id=metabase_database_id,
        created_by=created_by,
    )
    return project, metabase_error


def retry_metabase(project) -> str | None:
    """Re-attempts just the Metabase half for a project whose schema
    already exists but metabase_database_id is still None. Returns an
    error message on failure, or None on success (project is saved)."""

    try:
        project.metabase_database_id = _Metabase(settings.METABASE_URL).create_database(
            project.name, project.schema_name
        )
    except ProvisioningError as e:
        return str(e)
    project.save(update_fields=["metabase_database_id"])
    return None
