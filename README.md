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
(`portal/composables/useAuth.ts`) already exposes `signInWithGoogle()`; wire
a button to it (or to a new `signInWithOAuth('<provider>')` call) in
`portal/pages/login.vue` to surface it in the UI.

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
  `DASHBOARD_PASSWORD`), independent of end-user auth. This is the standard,
  supported self-hosted Supabase security model and is intentionally kept
  separate, since Studio is a schema/data administration tool typically
  limited to a small set of operators rather than every portal user. Treat
  the dashboard credentials as an admin secret and share them out of band
  with whoever needs schema access.

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
