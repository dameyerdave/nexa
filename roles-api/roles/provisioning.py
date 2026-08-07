"""What actually happens when a dbadmin creates a project from the
portal's /admin/projects page: a new Postgres schema (granted to
`authenticated`, matching the raw_sql grant pattern every apps/<id>
package hand-writes - see apps/README.md) and a matching Metabase database
connection scoped to just that schema. No starter tables - an admin adds
those afterwards via Studio, or later graduates the project into a real
apps/<id> YAML package if it needs RLS policies or dashboards."""

import json
import re
import urllib.error
import urllib.request

import psycopg2
from django.conf import settings


class ProvisioningError(Exception):
    """Raised for anything that should surface as an error to the portal -
    an invalid/colliding name, or a downstream Postgres failure."""


def slugify_schema_name(raw: str) -> str:
    name = raw.strip().lower()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        raise ProvisioningError("Project name must contain at least one letter or digit.")
    if name[0].isdigit():
        name = f"p_{name}"
    return name[:63]


def _pg_connect():
    try:
        return psycopg2.connect(
            host=settings.POSTGRES_HOST,
            port=settings.POSTGRES_PORT,
            dbname=settings.POSTGRES_DB,
            user="postgres",
            password=settings.POSTGRES_SUPERUSER_PASSWORD,
        )
    except psycopg2.Error as e:
        raise ProvisioningError(f"Could not reach Postgres: {e}") from e


def _create_schema(schema_name: str) -> None:
    with _pg_connect() as conn:
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("select 1 from pg_namespace where nspname = %s", (schema_name,))
                if cur.fetchone():
                    raise ProvisioningError(f"A Postgres schema named '{schema_name}' already exists.")
                # Identifiers can't be parameterized, but schema_name only
                # ever contains [a-z0-9_] (see slugify_schema_name above) -
                # it's never raw user input by the time it gets here.
                cur.execute(f'create schema "{schema_name}"')
                cur.execute(f'grant usage on schema "{schema_name}" to authenticated')
                cur.execute(
                    f'grant select, insert, update, delete on all tables in schema "{schema_name}" to authenticated'
                )
                cur.execute(
                    f'alter default privileges in schema "{schema_name}" '
                    "grant select, insert, update, delete on tables to authenticated"
                )
        except psycopg2.Error as e:
            raise ProvisioningError(f"Postgres error while creating schema '{schema_name}': {e}") from e
        finally:
            conn.close()


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
