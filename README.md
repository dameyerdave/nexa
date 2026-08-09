# Nexdata

A self-hosted Supabase stack with its database UI embedded directly inside
a Nuxt app, behind Metabase-backed login and portal-side 2FA.

* **Supabase** - Postgres, Auth, REST/GraphQL API, Realtime, Storage, and the
  Studio dashboard (self-hosted, official Docker images).
* **Metabase** - the portal's identity provider and the dashboarding tool.
  Admin-provisioned accounts, group-based access (editor vs. viewer), locked
  down so it can only be reached through the portal (see "Authentication").
* **Portal** - a small Nuxt app: register + 2FA enrollment, an admin
  approval step, then sign in (against Metabase) + a 2FA check, and
  Metabase dashboards appear embedded as the main view. Editors also get
  Supabase Studio and a small "Import Excel" tool that turns a spreadsheet
  into a new table without touching SQL.

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
4. Undo step 1 (remove the temporary port mapping) and
   `docker compose up -d` again, so Metabase's sign-in is only reachable
   through the portal.

From here on, new users create their own account at the portal's
**Register** page (email/name/password + 2FA enrollment, all up front) and
an admin approves them - and picks which group(s) they land in - from
**Registrations** in the portal itself. See "Authentication" below for the
full flow. You (the admin) still sign in with the account from step 2.

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
sign-in, no OAuth. The portal adds its own TOTP-based 2FA on top, and gates
every new account behind admin approval: anyone can register, but nobody
can sign in until an admin approves them and picks their group(s).

**Registration flow** (`portal/pages/register.vue`, `portal/server/api/auth/register/`):

1. **Details.** Name, email, and a password - collected by the portal, not
   Metabase (no Metabase account exists yet). The password is encrypted
   (AES-256-GCM, key derived from `SERVICE_ROLE_KEY` - see
   `portal/server/utils/secret-box.ts`) and held in a new
   `portal_registrations` row with `status = 'pending'`, alongside a fresh
   TOTP secret.
2. **2FA enrollment**, right away, as part of signing up rather than at
   first login - a QR code to scan, then one valid code to confirm it. A
   set of one-time recovery codes is generated and shown once (hashed at
   rest, same as ordinary 2FA - see `portal/server/utils/registration-store.ts`).
3. The user sees a "pending approval" screen. They cannot sign in yet -
   there is no Metabase account for them until an admin approves the
   registration, so a login attempt just fails like a wrong password
   would.

**Approval** (`portal/pages/admin/registrations.vue`, restricted to Metabase
superusers - see "Admin dashboard" below): the admin sees every pending
registration, picks which Metabase group(s) to assign, and clicks Approve
(or Reject). On approve, the portal:

1. Creates the real Metabase account (`POST /api/user`) and sets its
   password directly to the one chosen at registration
   (`PUT /api/user/:id/password`, using the portal's admin session -
   Metabase lets a superuser set another user's password this way without
   the target's old password), then adds it to the chosen group(s)
   (`POST /api/permissions/membership` per group).
2. Migrates the already-hashed recovery codes and TOTP secret from the
   registration row into the ordinary 2FA tables
   (`commitTotpEnrollmentHashed`), so the user's authenticator app keeps
   working unchanged - no re-enrollment after approval.
3. Marks the registration `approved` and wipes its now-unneeded encrypted
   password.

Rejecting a registration just marks it `rejected`; no Metabase account is
ever created for it. Rejected emails can register again.

> **Unverified assumption:** the `PUT /api/user/:id/password` admin
> password-set call and the single-membership `POST /api/permissions/membership`
> shape (`{group_id, user_id}`) in `portal/server/utils/metabase-auth.ts`'s
> `createMetabaseUser` are based on Metabase's documented/source behavior,
> not confirmed against a live instance (no Docker available while building
> this). If either doesn't match your Metabase version, approving a
> registration will fail loudly with a "Metabase error: ..." message
> instead of silently creating a broken account - check that message
> against your Metabase version's actual API if you hit it.

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

**Known limitation:** the pending-login cache (sign-in step 1-2 above) and
the Excel re-import cache are in-memory and single-process - they won't
survive a portal restart mid-flow, or work correctly if `portal` is ever
scaled beyond one replica. Pending *registrations*, unlike pending logins,
are durable (a Postgres row) and unaffected by this.

### Admin dashboard

Whoever created the first Metabase account during setup (Metabase's setup
wizard always makes it a superuser) sees a **Registrations** link in the
portal header - `portal/pages/admin/registrations.vue`, gated by
`requireAdmin` (Metabase `is_superuser`, not the editor group - approving
accounts and handing out group membership is more sensitive than ordinary
read/write dashboard access). Promoting another user to superuser stays a
manual step in Metabase's own admin UI; this dashboard only ever assigns
ordinary groups.

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
  codes and pending registrations.
* Don't rotate `SERVICE_ROLE_KEY` while any registration is still pending
  approval - a pending registration's password is encrypted with a key
  derived from it (see "Authentication"), so rotating invalidates any
  password not yet approved (approval will fail decryption; the user just
  registers again).
