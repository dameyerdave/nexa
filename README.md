# Nexdata

A self-hosted Supabase stack with its database UI embedded directly inside
a Nuxt app, behind a real login.

* **Supabase** - Postgres, Auth, REST/GraphQL API, Realtime, Storage, and the
  Studio dashboard (self-hosted, official Docker images).
* **Portal** - a small Nuxt app: sign in / register, then Supabase Studio
  appears embedded in the page (not a separate tab) as the main view. A
  small "Import Excel" tool lets you turn a spreadsheet into a new table
  without touching SQL.

Everything is defined in [`docker-compose.yml`](./docker-compose.yml) and
configured entirely through a single `.env` file.

## Architecture

```
                    ┌─────────────┐
   user ──────────▶ │   portal    │  Sign in (Supabase Auth: email/password
                    │  (Nuxt 3)   │  today, Google SSO ready to enable)
                    └──────┬──────┘
                           │ after sign-in: Studio embedded in an <iframe>,
                           │ credentials attached server-side
                           ▼
                    ┌───────────────┐
                    │  kong (:8000) │
                    │  -> studio    │  HTTP Basic Auth (DASHBOARD_USERNAME/
                    │  -> rest/auth │  PASSWORD), embedded by the portal so
                    │  -> realtime  │  users aren't prompted separately
                    │  -> storage   │
                    │  -> pg-meta   │  used by "Import Excel" to create
                    └───────┬───────┘  tables from a spreadsheet's header row
                            ▼
                    ┌───────────────┐
                    │   supabase    │
                    │   postgres    │
                    └───────────────┘
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

| URL                      | What                                        |
| ------------------------- | -------------------------------------------- |
| `http://localhost:3100`   | Portal - sign in, then Studio is embedded here |
| `http://localhost:8000`   | Supabase API / Studio directly (HTTP Basic Auth) |

Change the published ports via `PORTAL_PORT` and `KONG_HTTP_PORT` in `.env`.

## Importing a spreadsheet

Once signed in, click **"Import Excel"** in the portal header:

1. Pick a `.xlsx` file. The first row is treated as column headers, every
   row after that as data.
2. Optionally name the table - defaults to the filename.
3. Submit. The portal infers a Postgres type per column (`double precision`,
   `boolean`, `timestamptz`, or `text` - text is the fallback whenever a
   column mixes types) and creates the table via pg-meta (the same service
   Studio's own SQL editor uses), then bulk-inserts every row via
   PostgREST.

The new table lands in the `public` schema, so it's immediately visible in
the embedded Studio view and queryable over the REST API - no restart
needed. See `portal/server/api/import.post.ts` for the exact logic
(`portal/server/utils/slug.ts` for name sanitizing,
`portal/server/utils/pg-meta.ts` for the pg-meta client). This is a v1: no
column-type overrides, no update/append to an existing table, no chunking
for very large workbooks.

## Google SSO setup (optional)

The portal works today with plain email/password accounts.

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
4. Restart: `docker compose up -d`.

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

### How Studio is embedded

Self-hosted Studio has no built-in SSO of its own; Kong protects it with
HTTP Basic Auth (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`, see the
`dashboard` route in `volumes/api/kong.yml`). Rather than prompt a second
time, `portal/server/api/studio-link.get.ts` builds the Studio URL with
those credentials embedded (`https://user:pass@host/`) after verifying the
caller has a valid Supabase Auth session, and the portal renders that URL
in an `<iframe>` (`portal/pages/index.vue`) - so from the user's point of
view, signing into the portal is the only login step. Every signed-in
portal user currently gets Studio access; there's no separate role/admin
tier in this build.

## Repository layout

```
docker-compose.yml       Full stack definition
.env.example              All configuration - copy to .env
scripts/generate-keys.sh  Generates JWT/DB secrets into .env
volumes/                  Supabase self-hosting config (Kong routes, DB init SQL, ...)
portal/                   Nuxt 3 portal app (Dockerfile included)
```

## Production notes

* Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of
  `portal` and `kong`, and update `SITE_URL`, `API_EXTERNAL_URL`,
  `SUPABASE_PUBLIC_URL`, and `ADDITIONAL_REDIRECT_URLS` in `.env` to your
  real HTTPS domains (and update the Google OAuth redirect URI to match).
  Note that embedding Studio in an `<iframe>` only works if neither Studio
  itself nor anything in front of it (Kong, a reverse proxy) sends
  `X-Frame-Options`/CSP `frame-ancestors` headers that block framing - Kong's
  own config here doesn't add any, but this hasn't been verified against a
  running Studio container (no Docker available while building this), so
  check the browser console for a blocked-frame error on first run; if
  Studio does send one, the fix is either stripping that response header at
  Kong (a `response-transformer` plugin on the `dashboard` route) or falling
  back to opening Studio in a new tab instead of embedding it.
* Configure real SMTP (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/...) if you want
  Supabase's email flows (password recovery, invites) to work; without it
  only OAuth sign-in (Google) works.
* Back up `volumes/db/data` (Supabase Postgres) - it holds every table,
  including ones created via "Import Excel".
