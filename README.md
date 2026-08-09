# Nexdata

A self-hosted Supabase stack with its database UI embedded directly inside
a Nuxt app, behind Metabase-backed login and portal-side 2FA.

* **Supabase** - Postgres, Auth, REST/GraphQL API, Realtime, Storage, and the
  Studio dashboard (self-hosted, official Docker images).
* **Metabase** - the portal's identity provider and the dashboarding tool.
  Admin-provisioned accounts, group-based access (editor vs. viewer), locked
  down so it can only be reached through the portal (see "Authentication").
* **Portal** - a small Nuxt app: sign in (against Metabase) + a 2FA step,
  then Metabase dashboards appear embedded as the main view. Editors also
  get Supabase Studio and a small "Import Excel" tool that turns a
  spreadsheet into a new table without touching SQL.

Everything is defined in [`docker-compose.yml`](./docker-compose.yml) and
configured entirely through a single `.env` file.

## Architecture

```
                    ┌─────────────┐
   user ──────────▶ │   portal    │  1. password -> checked against Metabase
                    │  (Nuxt 3)   │  2. TOTP code -> checked by the portal
                    └──────┬──────┘  Only after both pass: Metabase's own
                           │         session cookie is released to the browser
                           │ signed-in: Metabase dashboards embedded in an
                           │ <iframe>; editors also get Studio + Import Excel
                           ▼
                    ┌───────────────┐        ┌─────────────────────────┐
                    │  kong (:8000) │        │  kong (:8002, metabase) │
                    │  -> studio    │        │  -> metabase            │
                    │  -> rest/auth │        │     (direct /api/session│
                    │  -> realtime  │        │      sign-in blocked -  │
                    │  -> storage   │        │      portal only, over  │
                    │  -> pg-meta   │        │      the internal net)  │
                    └───────┬───────┘        └────────────┬────────────┘
                            ▼                              ▼
                    ┌────────────────────────────────────────┐
                    │              supabase postgres          │
                    │   (also holds the metabase database)    │
                    └──────────────────────────────────────────┘
```

## Prerequisites

* Docker and Docker Compose v2

## Quick start

```sh
cp .env.example .env
sh scripts/generate-keys.sh --update-env   # fills in all secrets/keys
docker compose up -d
```

Metabase needs a one-time setup before the portal can use it as an identity
provider:

1. Temporarily publish Metabase's port (e.g. `docker compose port metabase
   3000`, or add a `ports:` mapping) and open it directly, or run
   `docker compose exec metabase` tooling - Metabase's own sign-in endpoint
   is blocked on the public Kong port (`:8002`) by design (see
   "Authentication" below).
2. Walk through Metabase's setup wizard to create the **admin account**.
   Put its email/password into `METABASE_ADMIN_EMAIL` /
   `METABASE_ADMIN_PASSWORD` in `.env` - the portal uses this account
   server-to-server (never exposed to the browser) to look up group
   membership.
3. Under **Admin > People > Groups**, create a group named `Editors` (or
   whatever you set `METABASE_EDITOR_GROUP` to) and add whichever users
   should get read/write dashboards plus Supabase Studio and Import Excel.
   Everyone else gets read-only dashboards.
4. Create one Metabase account per real user under **Admin > People** -
   there's no self-service sign-up.
5. Undo step 1 (remove the temporary port mapping) and
   `docker compose up -d` again, so Metabase's sign-in is only reachable
   through the portal.

Once set up, visit the portal and sign in with a Metabase account's
credentials, then enroll in 2FA (a QR code for any TOTP authenticator app)
on first login - see "Authentication" below for the full flow.

Once healthy:

| URL                      | What                                        |
| ------------------------- | -------------------------------------------- |
| `http://localhost:3100`   | Portal - sign in, then dashboards are embedded here |
| `http://localhost:8000`   | Supabase API / Studio directly (HTTP Basic Auth) |
| `http://localhost:8002`   | Metabase, proxied by Kong (sign-in blocked here - portal only) |

Change the published ports via `PORTAL_PORT`, `KONG_HTTP_PORT`, and
`KONG_METABASE_PORT` in `.env`.

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
column-type overrides, no chunking for very large workbooks.

### Re-importing into an existing table

Uploading a file whose table name already exists doesn't silently fail or
overwrite - the portal asks what to do:

* **Override** - drops and recreates the table from this file, so it ends
  up with exactly this file's rows and columns.
* **Append** - you pick which uploaded column uniquely identifies a row
  (an ID, an email, whatever's actually unique in your data - there's no
  business key otherwise, only the table's internal auto-generated
  `row_id`). The portal adds a `UNIQUE` constraint on that column if it's
  not already there, checks which incoming rows collide with existing ones
  on that column, and shows you the list: choose which duplicates to
  overwrite (individually, or "all"/"none"), and everything else - new
  rows plus the duplicates you picked - is written in one upsert
  (PostgREST's `on_conflict` + `merge-duplicates`, so it's a single native
  Postgres `INSERT ... ON CONFLICT DO UPDATE`, not a per-row loop). Rows
  you don't select are left untouched.

The upload is parsed once and held in memory on the portal server between
these steps (`portal/server/utils/import-cache.ts`) so choosing
override/append doesn't require re-uploading the file - it expires after
15 minutes if abandoned. This only works as long as there's one portal
container; it won't survive a restart or be visible to a second replica if
you ever scale `portal` beyond one instance.

## Authentication

Metabase is the portal's identity provider - there's no Supabase Auth
sign-in, no self-service sign-up, no OAuth. Accounts and group membership
are entirely admin-provisioned in Metabase (see "Quick start" above), and
the portal adds its own TOTP-based 2FA on top.

**Sign-in flow** (`portal/pages/login.vue`):

1. **Password.** The portal posts the entered username/password to
   Metabase's own `POST /api/session`, but server-to-server over the
   internal Docker network (`http://metabase:3000`, see
   `portal/server/utils/metabase-auth.ts`) - never through the public Kong
   port. On success it gets a real Metabase session token, which it stashes
   server-side (`portal/server/utils/pending-login-cache.ts`, a short-lived
   in-memory cache keyed by a random login ID handed to the browser) rather
   than releasing it as a cookie yet.
2. **2FA.** If this is the user's first login, the portal generates a TOTP
   secret (`portal/server/utils/totp.ts`, backed by `otpauth`) and shows a
   QR code to scan with any authenticator app, then requires one valid code
   to confirm enrollment before issuing a set of one-time recovery codes
   (shown once, hashed with SHA-256 at rest -
   `portal/server/utils/two-factor-store.ts`). Returning users are just
   asked for their next 6-digit code (or a recovery code, if they've lost
   their device).
3. Only once the 2FA step also succeeds does the portal release Metabase's
   real session cookie to the browser (relaying its raw `Set-Cookie`
   header(s) verbatim - see `portal/server/api/auth/verify.post.ts`). From
   that point on the browser talks to Metabase directly (dashboards
   `<iframe>`) using that same cookie.

**Why Metabase's own sign-in is blocked on its public port:** without that,
anyone could skip the portal's 2FA step entirely by hitting Metabase
directly. `volumes/api/kong.yml`'s `metabase-session-block` route returns
403 on `POST /api/session` on the published Metabase port (`:8002`); the
portal's server-to-server login in step 1 above is unaffected because it
never goes through Kong at all.

**Editor vs. viewer:** the portal holds a separate Metabase *admin* account
(`METABASE_ADMIN_EMAIL` / `METABASE_ADMIN_PASSWORD`, used only
server-to-server, never exposed to a real user) purely to answer "which
group is this user in" via Metabase's `/api/permissions/*` endpoints
(`portal/server/utils/metabase-auth.ts`'s `isMetabaseEditor`). Members of
the `METABASE_EDITOR_GROUP` group (default `Editors`) get Supabase Studio
and Import Excel in addition to read/write Metabase dashboards; everyone
else gets read-only dashboards only.

**Known limitation:** both the pending-login cache (step 1-2 above) and the
Excel re-import cache are in-memory and single-process - they won't survive
a portal restart mid-flow, or work correctly if `portal` is ever scaled
beyond one replica.

### How Studio is embedded

Self-hosted Studio has no built-in SSO of its own; Kong protects it with
HTTP Basic Auth (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`, see the
`dashboard` route in `volumes/api/kong.yml`). Rather than prompt a second
time, `portal/server/api/studio-link.get.ts` builds the Studio URL with
those credentials embedded (`https://user:pass@host/`) after verifying the
caller is signed in *and* in the editor group, and the portal renders that
URL in an `<iframe>` (`portal/pages/index.vue`) - so from the user's point
of view, signing into the portal is the only login step. Viewers never see
this option.

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
  `portal`, `kong` (`:8000`), and Kong's Metabase listener (`:8002`), and
  update `SUPABASE_PUBLIC_URL` and `METABASE_PUBLIC_URL` in `.env` to your
  real HTTPS domains. Note that embedding Studio/Metabase in an `<iframe>`
  only works if neither service itself nor anything in front of it (Kong, a
  reverse proxy) sends `X-Frame-Options`/CSP `frame-ancestors` headers that
  block framing - Kong's own config here doesn't add any, but this hasn't
  been verified against running Studio/Metabase containers (no Docker
  available while building this), so check the browser console for a
  blocked-frame error on first run; if either service sends one, the fix is
  either stripping that response header at Kong (a `response-transformer`
  plugin on the relevant route) or falling back to opening it in a new tab
  instead of embedding it.
* Metabase's session cookie is relayed by the portal onto its own response
  (see "Authentication" above) rather than proxied through a shared origin,
  so the portal and Metabase's public URL need to share the same hostname
  (differing only by port, as in the local defaults) for the browser to
  treat it as a first-party cookie once it lands.
* Back up `volumes/db/data` (Supabase Postgres) - it holds every table,
  including ones created via "Import Excel", plus the `metabase` database
  (dashboards, users, groups) and the portal's own 2FA secrets/recovery
  codes.
