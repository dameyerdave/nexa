# Nexdata

A self-hosted data stack behind a single, minimalistic front door.

* **Supabase** - Postgres, Auth, REST/GraphQL API, Realtime, Storage, and the
  Studio dashboard (self-hosted, official Docker images).
* **Metabase** - dashboards and BI on top of your data.
* **Portal** - a small Nuxt app that hides the tech stack behind two plain
  labels, **"Data Model"** and **"Data Analytics"**, and gates both behind a
  login.

Everything is defined in [`docker-compose.yml`](./docker-compose.yml) and
configured entirely through a single `.env` file.

## Architecture

```
                    ┌─────────────┐
   user ──────────▶ │   portal    │  Sign in (Supabase Auth: email/password
                    │  (Nuxt 3)   │  today, Google SSO ready to enable)
                    └──────┬──────┘
                           │ after sign-in, two tiles:
              ┌────────────┴────────────┐
              ▼                         ▼
        "Data Model"              "Data Analytics"
              │                         │
              ▼                         ▼
      ┌───────────────┐         ┌───────────────┐
      │  kong (:8000) │         │   metabase    │
      │  -> studio    │         │ (Google sign- │
      │  -> rest/auth │         │  in with the  │
      │  -> realtime  │         │  same client) │
      │  -> storage   │         └───────┬───────┘
      └───────┬───────┘                 │
              ▼                         ▼
              └────────────┬────────────┘
                            ▼
                    ┌───────────────┐
                    │   supabase    │  metabase's own app data (dashboards,
                    │   postgres    │  questions, users) lives here too, in
                    │               │  its own `metabase` database - one
                    └───────────────┘  Postgres instance total, no second db
```

## Prerequisites

* Docker and Docker Compose v2

## Quick start

```sh
cp .env.example .env
sh scripts/generate-keys.sh --update-env   # fills in all secrets/keys
docker compose up -d
```

The portal signs users in with **email + password** out of the box (new
accounts are auto-confirmed, no SMTP required) - visit the portal, click
"No account yet? Create one", and sign up. Google SSO is wired up and ready
to enable whenever you want it (see below).

Once healthy:

| URL                              | What                                             |
| --------------------------------- | ------------------------------------------------ |
| `http://localhost:3100`           | Portal - start here                               |
| `http://localhost:8000`           | Supabase API / Studio ("Data Model", HTTP Basic Auth) |
| `http://localhost:3200`           | Metabase ("Data Analytics")                       |

Change the published ports via `PORTAL_PORT`, `KONG_HTTP_PORT`, and
`METABASE_PORT` in `.env`.

## Google SSO setup (optional)

The portal works today with plain email/password accounts. Enabling Google
additionally lets Metabase reuse the same OAuth client for its native Google
Sign-In, so users authenticate with the same Google account for both
destinations.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Web application**.
2. Add an authorized redirect URI for Supabase Auth:
   `http://localhost:8000/auth/v1/callback` (replace the host with your real
   domain in production - it must match `API_EXTERNAL_URL` + `/callback`).
3. Copy the **Client ID** and **Client secret** into `.env`:
   ```
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_SECRET=xxxxxxxx
   ```
4. (Optional) Set `GOOGLE_AUTH_ALLOWED_DOMAIN` to restrict Metabase
   auto-provisioning to a Google Workspace domain.
5. Restart: `docker compose up -d`.

### Adding more identity providers

Supabase Auth supports a wide range of providers out of the box (GitHub,
Azure/Microsoft Entra ID, GitLab, Bitbucket, Discord, Facebook, X/Twitter,
Apple, Slack, Spotify, LinkedIn, Notion, WorkOS, Zoom, and enterprise SSO via
SAML). Google is wired up as the reference implementation; `docker-compose.yml`
has commented-out `GOTRUE_EXTERNAL_GITHUB_*` / `GOTRUE_EXTERNAL_AZURE_*`
blocks (in the `auth` service) and matching commented variables in
`.env.example` to show the pattern - uncomment and fill in credentials for
any provider you want to add. See the
[Supabase social login docs](https://supabase.com/docs/guides/auth/social-login)
and [enterprise SSO / SAML docs](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)
for the full list and per-provider setup steps. `useAuth()`
(`portal/composables/useAuth.ts`) exposes `signInWithGoogle()`, already wired
to a "Sign in with Google" button on the login page that appears
automatically once `GOOGLE_ENABLED=true` (see `portal/pages/login.vue`) - for
another provider, add a matching `signInWithOAuth('<provider>')` call and
button following the same pattern.

### SSO model and its limits

* **Portal -> Supabase Auth**: the portal itself is fully gated by a real
  Supabase Auth session (email/password via `@supabase/supabase-js` today;
  Google OAuth is implemented in `useAuth()` and ready to enable).
* **Portal -> Metabase**: real SSO via a *shared identity provider*. Metabase
  (open source) doesn't support OIDC/SAML/JWT single sign-on - only Google
  Sign-In natively - so it's configured with the same Google OAuth client as
  Supabase Auth. Users see one Google account picker, not a second app
  password.
* **Portal -> Supabase Studio**: self-hosted Studio has no built-in SSO of
  its own; Kong protects it with HTTP Basic Auth (`DASHBOARD_USERNAME` /
  `DASHBOARD_PASSWORD`). Rather than share that admin secret out of band,
  the portal grants it on the user's behalf - see "Roles and access
  control" below.

## Roles and access control

Every portal user can sign in, but two roles unlock more:

* **`dbadmin`** - the portal's "Data Model" tile becomes clickable and opens
  Supabase Studio with the shared Basic Auth credential embedded in the
  URL, so the user isn't prompted for it (`portal/server/api/studio-link.get.ts`).
  Users without the role don't see the tile at all.
* **`dashboardadmin`** - the user is added to a "Dashboard Admins" Metabase
  group that can create/edit dashboards and questions. Everyone else only
  gets view access. Metabase itself still requires its own sign-in
  (email/password, or Google if enabled) - this only changes what a
  signed-in Metabase user is allowed to do.

### roles-api

Role assignments and the Studio credential are **not** environment
variables - they live in **roles-api**, a small internal Django + Django
REST Framework service with its own SQLite database (separate from the
Supabase/Metabase Postgres instance), deployed alongside the rest of the
stack. It's the source of truth the portal calls into
(`portal/server/utils/roles-api.ts`) whenever it needs to check or change
someone's roles.

The **only** admin identity configured via environment variables is the one
bootstrap superuser: `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD`.
Log into roles-api's own Django admin as that user to:

* promote other users to **portal admin** (`is_admin`) - who can then
  assign `dbadmin`/`dashboardadmin` to anyone from the portal's own
  `/admin/users` page, no Django login needed for that day-to-day part;
* view or rotate the shared **Studio credential** (seeded once from
  `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` so it starts in sync with
  Kong's own consumer - see the comment on `StudioCredential` in
  `roles-api/roles/models.py` for the one caveat: because Kong runs
  DB-less from a declarative config baked at deploy time, rotating the
  credential here also needs a matching redeploy for Kong to accept it).

roles-api has no public route (no Ingress/Kong entry) - reach its Django
admin with:

```sh
kubectl port-forward svc/roles-api 8000:8000 -n nexa   # then open http://localhost:8000/admin/
```

or, with `docker compose`, it's published locally at `${ROLES_API_PORT:-3102}`.

`dashboardadmin` group membership is synced to Metabase automatically on
every role change, but the *permissions* the "Dashboard Admins" group and
"All Users" group actually have on Metabase's collections are a one-time
setup - run this once against a fresh Metabase (safe to re-run, it
converges rather than duplicating):

```sh
python3 scripts/setup_metabase_permissions.py
```

## Data model apps

The actual Postgres schema (tables, relationships, RLS) and Metabase
dashboards are not hand-built through the UI - they're defined as YAML
"apps" under [`apps/`](./apps), each a self-contained config package
(think Splunk app, but for a Supabase schema + Metabase dashboards). See
[`apps/README.md`](./apps/README.md) for the format, and
[`apps/biomedical-studies`](./apps/biomedical-studies) for a full worked
example (biomedical study/specimen/instrument-run metadata, with raw data
in Supabase Storage and full provenance from subject to result, plus a
ready-made overview dashboard).

```sh
python3 scripts/compile_schema.py apps/biomedical-studies   # YAML -> SQL
sh scripts/apply_schema.sh apps/biomedical-studies           # apply schema to the running stack
python3 scripts/apply_dashboards.py apps/biomedical-studies  # apply dashboards to Metabase
```

## Repository layout

```
docker-compose.yml       Full stack definition
.env.example              All configuration - copy to .env
scripts/generate-keys.sh  Generates JWT/DB/Metabase secrets into .env
scripts/compile_schema.py Compiles an apps/<app> YAML schema into SQL migrations
scripts/apply_schema.sh   Applies a compiled app's migrations to the running stack
scripts/apply_dashboards.py Applies an apps/<app> YAML dashboard to Metabase
volumes/                  Supabase self-hosting config (Kong routes, DB init SQL, ...)
portal/                   Nuxt 3 portal app (Dockerfile included)
roles-api/                Django + DRF role/access-control service (Dockerfile included)
apps/                     Config-package data model apps (schema + dashboards)
deploy/                   Kubernetes: Helm chart + CI/CD (see deploy/README.md)
```

## Deploying to Kubernetes

For a Kubernetes deployment instead of (or alongside) `docker compose`,
there's a Helm chart at [`deploy/helm/nexa`](./deploy/helm/nexa) and a
GitHub Actions pipeline that builds the portal image and deploys it on
every push to `main`. See [`deploy/README.md`](./deploy/README.md) for the
full list of GitHub Actions secrets/variables to configure, and
[`deploy/helm/nexa/README.md`](./deploy/helm/nexa/README.md) for how the
chart itself is put together and its known limitations.

## Production notes

* Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of
  `portal`, `kong`, and `metabase`, and update `SITE_URL`, `API_EXTERNAL_URL`,
  `SUPABASE_PUBLIC_URL`, `ADDITIONAL_REDIRECT_URLS`, and `METABASE_PUBLIC_URL`
  in `.env` to your real HTTPS domains (and update the Google OAuth redirect
  URI to match).
* Configure real SMTP (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/...) if you want
  Supabase's email flows (password recovery, invites) to work; without it
  only OAuth sign-in (Google) works.
* Back up `volumes/db/data` (Supabase Postgres) - this now holds Metabase's
  own app data too, in its `metabase` database.
