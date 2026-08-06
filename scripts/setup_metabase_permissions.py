#!/usr/bin/env python3
"""
One-time (idempotent) Metabase permission setup for the dbadmin/dashboardadmin
role model described in README.md "Roles and access control".

Ensures:
  - a "Dashboard Admins" permission group exists (the portal adds/removes
    users from it automatically as their `dashboardadmin` role changes -
    see portal/server/utils/metabase.ts)
  - the root collection (and everything in it) is view-only ("read") for
    "All Users" and editable ("write"/curate) for "Dashboard Admins"

Requires the stack to be running and .env present at the repo root, same as
scripts/apply_dashboards.py. Safe to re-run at any time.

Usage:
    python3 scripts/setup_metabase_permissions.py
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

DASHBOARD_ADMINS_GROUP = "Dashboard Admins"
ALL_USERS_GROUP = "All Users"


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

    def sign_in(self, email, password):
        resp = self.request("POST", "/api/session", {"username": email, "password": password})
        self.session = resp["id"]

    def ensure_group(self, name: str) -> int:
        for g in self.request("GET", "/api/permissions/group"):
            if g["name"] == name:
                return g["id"]
        print(f"  creating group '{name}'")
        return self.request("POST", "/api/permissions/group", {"name": name})["id"]

    def find_group_id(self, name: str) -> int:
        for g in self.request("GET", "/api/permissions/group"):
            if g["name"] == name:
                return g["id"]
        raise SystemExit(f"Built-in group '{name}' not found")


def main():
    repo_root = Path(__file__).resolve().parent.parent
    env_path = repo_root / ".env"
    if not env_path.exists():
        raise SystemExit("No .env found - copy .env.example to .env first.")
    env = load_dotenv(env_path)

    mb = Metabase(env.get("METABASE_PUBLIC_URL", "http://localhost:3200"))
    mb.sign_in(env["METABASE_ADMIN_EMAIL"], env["METABASE_ADMIN_PASSWORD"])

    dashboard_admins_id = mb.ensure_group(DASHBOARD_ADMINS_GROUP)
    all_users_id = mb.find_group_id(ALL_USERS_GROUP)

    graph = mb.request("GET", "/api/collection/graph")
    groups = graph["groups"]
    groups.setdefault(str(all_users_id), {})["root"] = "read"
    groups.setdefault(str(dashboard_admins_id), {})["root"] = "write"

    print("Setting collection permissions: All Users -> read, Dashboard Admins -> write")
    mb.request("PUT", "/api/collection/graph", {"revision": graph["revision"], "groups": groups})
    print("Done.")


if __name__ == "__main__":
    main()
