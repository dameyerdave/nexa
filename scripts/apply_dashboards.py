#!/usr/bin/env python3
"""
Applies an app's dashboards/*.yml to a running Metabase, via its REST API.

Usage:
    python3 scripts/apply_dashboards.py apps/biomedical-studies

Requires the stack to be running and .env present at the repo root. On a
brand new Metabase instance this also completes the first-run setup wizard
(creating the METABASE_ADMIN_* account from .env) - no manual click-through
required.

Every apply sends the *complete* desired state for each card and dashboard
(cards are matched/updated by name; a dashboard's card layout is fully
replaced with what the YAML describes), so re-running after editing the
YAML converges the dashboard to match rather than accumulating duplicates.
See apps/README.md for the dashboards/*.yml format.
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml


def load_dotenv(path: Path) -> dict:
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        values[key] = val
    return values


class Metabase:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = None

    def request(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.session:
            req.add_header("X-Metabase-Session", self.session)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()}")

    def ensure_session(self, email, password, first_name, last_name):
        props = self.request("GET", "/api/session/properties")
        # `setup-token` stays populated even after setup completes - the
        # actual "is this instance already set up" flag is has-user-setup.
        if not props.get("has-user-setup"):
            print(f"Metabase not yet set up - bootstrapping admin account {email} ...")
            resp = self.request(
                "POST",
                "/api/setup",
                {
                    "token": props["setup-token"],
                    "user": {
                        "first_name": first_name,
                        "last_name": last_name,
                        "email": email,
                        "password": password,
                    },
                    "prefs": {"site_name": "Nexa", "allow_tracking": False},
                },
            )
        else:
            resp = self.request("POST", "/api/session", {"username": email, "password": password})
        self.session = resp["id"]

    def ensure_database(self, name: str, engine: str, details: dict) -> int:
        for db in self.request("GET", "/api/database")["data"]:
            if db["name"] == name:
                return db["id"]
        print(f"  creating database connection '{name}'")
        db = self.request(
            "POST", "/api/database", {"engine": engine, "name": name, "details": details, "is_full_sync": True}
        )
        return db["id"]

    def find_card_id(self, name: str):
        for c in self.request("GET", "/api/card"):
            if c["name"] == name and not c.get("archived"):
                return c["id"]
        return None

    def upsert_card(self, name, description, display, query, database_id, visualization_settings) -> int:
        payload = {
            "name": name,
            "description": description,
            "display": display,
            "visualization_settings": visualization_settings or {},
            "dataset_query": {"type": "native", "native": {"query": query}, "database": database_id},
        }
        card_id = self.find_card_id(name)
        if card_id:
            print(f"  card '{name}': updating (id {card_id})")
            self.request("PUT", f"/api/card/{card_id}", payload)
        else:
            print(f"  card '{name}': creating")
            card_id = self.request("POST", "/api/card", payload)["id"]
        return card_id

    def find_dashboard_id(self, name: str):
        for d in self.request("GET", "/api/dashboard"):
            if d["name"] == name and not d.get("archived"):
                return d["id"]
        return None

    def upsert_dashboard(self, name: str, description: str, dashcards: list) -> int:
        dash_id = self.find_dashboard_id(name)
        if dash_id is None:
            print(f"  dashboard '{name}': creating")
            dash_id = self.request("POST", "/api/dashboard", {"name": name, "description": description})["id"]
        else:
            print(f"  dashboard '{name}': updating (id {dash_id})")
        self.request(
            "PUT", f"/api/dashboard/{dash_id}", {"name": name, "description": description, "dashcards": dashcards}
        )
        return dash_id


def apply_app(app_dir: Path, env: dict):
    base_url = env.get("METABASE_PUBLIC_URL", "http://localhost:3200")
    mb = Metabase(base_url)
    mb.ensure_session(
        env["METABASE_ADMIN_EMAIL"],
        env["METABASE_ADMIN_PASSWORD"],
        env.get("METABASE_ADMIN_FIRST_NAME", "Admin"),
        env.get("METABASE_ADMIN_LAST_NAME", "User"),
    )

    for f in sorted((app_dir / "dashboards").glob("*.yml")):
        doc = yaml.safe_load(f.read_text()) or {}
        print(f"{f.relative_to(app_dir)}:")

        db_cfg = doc["database"]
        details = {
            "host": "db",
            "port": 5432,
            "dbname": env.get("POSTGRES_DB", "postgres"),
            "user": "postgres",
            "password": env["POSTGRES_PASSWORD"],
            "schema-filters-type": "inclusion",
            "schema-filters-patterns": db_cfg["schema"],
        }
        database_id = mb.ensure_database(db_cfg["name"], db_cfg.get("engine", "postgres"), details)

        card_ids = {}
        for card in doc.get("cards", []):
            card_ids[card["name"]] = mb.upsert_card(
                card["name"],
                card.get("description", ""),
                card.get("display", "table"),
                card["query"],
                database_id,
                card.get("visualization_settings"),
            )

        for dash in doc.get("dashboards", []):
            # Placeholder ids for new dashcards must be negative *and
            # unique within the request* - Metabase rejects a batch of
            # otherwise-identical -1 ids.
            dashcards = [
                {
                    "id": -(i + 1),
                    "card_id": card_ids[item["card"]],
                    "row": item["y"],
                    "col": item["x"],
                    "size_x": item["w"],
                    "size_y": item["h"],
                }
                for i, item in enumerate(dash["layout"])
            ]
            mb.upsert_dashboard(dash["name"], dash.get("description", ""), dashcards)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: apply_dashboards.py <app_dir>", file=sys.stderr)
        sys.exit(1)

    repo_root = Path(__file__).resolve().parent.parent
    env_path = repo_root / ".env"
    if not env_path.exists():
        raise SystemExit("No .env found - copy .env.example to .env first.")

    apply_app(Path(sys.argv[1]), load_dotenv(env_path))
    print("Done.")
