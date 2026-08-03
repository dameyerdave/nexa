# nexa

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
   user ──────────▶ │   portal    │  Sign in with Google (Supabase Auth)
                    │  (Nuxt 3)   │
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
        ┌───────────┐            ┌──────────────┐
        │  supabase  │           │  metabase-db │
        │  postgres  │           │  (app db)    │
        └───────────┘            └──────────────┘
```

## Prerequisites

* Docker and Docker Compose v2
* A Google Cloud OAuth 2.0 client (see below)

## Quick start

```sh
cp .env.example .env
sh scripts/generate-keys.sh --update-env   # fills in all secrets/keys
# then edit .env: set GOOGLE_CLIENT_ID / GOOGLE_SECRET (see next section)
docker compose up -d
```

Once healthy:

| URL                              | What                                             |
| --------------------------------- | ------------------------------------------------ |
| `http://localhost:3100`           | Portal - start here                               |
| `http://localhost:8000`           | Supabase API / Studio ("Data Model", HTTP Basic Auth) |
| `http://localhost:3200`           | Metabase ("Data Analytics")                       |

Change the published ports via `PORTAL_PORT`, `KONG_HTTP_PORT`, and
`METABASE_PORT` in `.env`.

## Google SSO setup

Supabase Auth (GoTrue) is used as the identity provider for the portal, and
its Google OAuth client is reused for Metabase's native Google Sign-In - so
users authenticate with the same Google account for both destinations.

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
for the full list and per-provider setup steps. To surface a new provider's
button in the portal UI, add a call to
`supabase.auth.signInWithOAuth({ provider: '<name>' })` next to the existing
Google button in `portal/pages/login.vue`.

### SSO model and its limits

* **Portal -> Supabase Auth**: the portal itself is fully gated by a real
  Supabase Auth session (Google OAuth via `@supabase/supabase-js`).
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

## Repository layout

```
docker-compose.yml       Full stack definition
.env.example              All configuration - copy to .env
scripts/generate-keys.sh  Generates JWT/DB/Metabase secrets into .env
volumes/                  Supabase self-hosting config (Kong routes, DB init SQL, ...)
portal/                   Nuxt 3 portal app (Dockerfile included)
```

## Production notes

* Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of
  `portal`, `kong`, and `metabase`, and update `SITE_URL`, `API_EXTERNAL_URL`,
  `SUPABASE_PUBLIC_URL`, `ADDITIONAL_REDIRECT_URLS`, and `METABASE_PUBLIC_URL`
  in `.env` to your real HTTPS domains (and update the Google OAuth redirect
  URI to match).
* Configure real SMTP (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/...) if you want
  Supabase's email flows (password recovery, invites) to work; without it
  only OAuth sign-in (Google) works.
* Back up `volumes/db/data` (Supabase Postgres) and the `metabase-db-data`
  Docker volume (Metabase's app database).
