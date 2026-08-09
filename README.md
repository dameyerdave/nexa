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
```

Before the first `docker compose up -d`, set `METABASE_ADMIN_EMAIL` /
`METABASE_ADMIN_PASSWORD` in `.env` to whatever you want your own admin
login to be (they default to placeholders - change them). On first boot the
portal creates that exact account in Metabase for you (as a superuser) via
Metabase's own one-time setup API - see
`portal/server/plugins/bootstrap-metabase-admin.ts` - so there's no manual
setup wizard to click through, and no need to ever publish Metabase's port
directly (its sign-in stays blocked there by design - see "Authentication"
below). It's a no-op on every boot after the first.

```sh
docker compose up -d
```

Sign in at the portal with that admin account (enrolling in 2FA on first
login, same as any account), then create a group named `Editors` (or
whatever you set `METABASE_EDITOR_GROUP` to) under Metabase's own
**Admin > People > Groups** - reachable right there in the embedded
dashboards view, since you're already signed in as a Metabase superuser.
Add whichever users should get read/write dashboards plus Supabase Studio
and Import Excel to it; everyone else gets read-only dashboards.

From here on, new users create their own account at the portal's
**Register** page (email/name/password + 2FA enrollment, all up front), and
you approve them - picking which group(s) they land in - from
**Registrations** in the portal itself. See "Authentication" below for the
full flow.

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
> `createMetabaseUser` - and, separately, the `/api/session/properties`
> `setup-token` field plus `POST /api/setup` body shape in
> `portal/server/plugins/bootstrap-metabase-admin.ts` (used to auto-create
> the initial admin account - see "Quick start") - are based on Metabase's
> documented/source behavior, not confirmed against a live instance (no
> Docker available while building this). If any of them don't match your
> Metabase version, the affected call fails loudly (a "Metabase error: ..."
> from approval, or a logged error from the bootstrap plugin, which just
> leaves the admin account to be created by hand through Metabase's normal
> setup wizard on its own port as a fallback) rather than silently
> producing a broken account - check the message against your Metabase
> version's actual API if you hit it.

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

## Audit log

Every row change to any table in the `public` schema (except the portal's
own `portal_*` bookkeeping tables) is logged to `audit_log` - who changed
what, when, and the old/new row data - regardless of whether the change
came from Import Excel or directly from an editor poking around in the
embedded Studio. Admins can browse it at **Audit log** in the portal
header (`portal/pages/admin/audit.vue`) - filterable by table, operation
(insert/update/delete), who made the change, a date range, and free-text
search across the before/after row data, with pagination (`GET
/api/admin/audit`, `portal/server/api/admin/audit.get.ts`). The free-text
search relies on PostgREST's ability to cast a jsonb column to text inside
an `or=(...)` filter (`old_data::text.ilike.*term*`) - unverified against
a live instance like the other PostgREST specifics on this page; if it
turns out not to be supported, that one filter errors out rather than the
rest of the page breaking.

**Schema side** (`volumes/db/audit.sql`, self-healing copy in
`portal/server/utils/audit-store.ts` for deployments that predate this
feature - see below): a trigger on every table writes each INSERT/UPDATE/DELETE
into `audit_log`, and a database event trigger auto-attaches that same
trigger to any table created afterwards (Import Excel or Studio's own
"New table"), so nothing has to remember to wire a new table up by hand.

**Attributing a change to a real person** is the interesting part, since
every write - whether from the portal or from Studio - ultimately reaches
Postgres via the same shared `service_role` credential, which Postgres
itself can't tell apart:

* For writes the **portal** makes on a user's behalf (Import Excel), the
  portal already knows who's calling and attaches an `X-User-Email` header
  to its own PostgREST request.
* For edits made **directly in the embedded Studio**, an `X-User-Email`
  header wouldn't otherwise exist - Studio talks to PostgREST/pg-meta
  using the same shared credentials every editor shares, with no
  per-request identity of its own. To fix that, Kong's `meta` and
  `rest-v1`/`rest-v1-openapi` routes (`volumes/api/kong.yml`) no longer
  point straight at `pg-meta`/PostgREST - they're routed through a small
  identity-resolving proxy in the portal
  (`portal/server/utils/studio-proxy.ts`, `server/api/proxy/meta/[...path].ts`,
  `server/api/proxy/rest/[...path].ts`) that reads the browser's
  `metabase.SESSION` cookie (already present on these requests, since
  portal/Studio/Metabase share a hostname and cookies aren't port-scoped),
  resolves it to an email (cached ~60s so Studio's rapid clicking doesn't
  hammer Metabase), stamps `X-User-Email`, and forwards the request
  byte-for-byte to the real service. A shared-secret header
  (`X-Kong-Proxy-Secret`, reusing `SERVICE_ROLE_KEY` - Kong injects it via
  `request-transformer`) stops someone from reaching that proxy by hitting
  the portal's own published port directly, bypassing Kong's key-auth/acl.
* Either way, the header lands in Postgres via PostgREST's
  `PGRST_DB_PRE_REQUEST` hook (`public.pgrst_pre_request()`), which copies
  it into a session-local GUC (`app.current_user_email`, set with
  `set_config(..., true)` - transaction-scoped, since PostgREST pools
  connections across different callers and a plain session-wide `SET`
  would risk one user's identity leaking onto another's write on a reused
  connection) that the audit trigger reads. No cookie, no header, or a
  request that never touches PostgREST at all (a raw `psql` connection,
  say) just logs `changed_by = 'unknown'`.

> **Trade-off worth knowing:** routing `rest-v1`/`rest-v1-openapi` through
> the portal means the portal is now a required hop for the *entire*
> public REST API, not just Studio's traffic - if the portal is down, REST
> calls that used to work independently of it no longer do. Non-Studio
> callers (no Metabase cookie) aren't otherwise affected - they just get
> `changed_by = 'unknown'` in the audit log.
>
> **Unverified assumptions**, same caveat as elsewhere in this doc (no
> Docker available while building this): PostgREST's `request.headers` GUC
> shape and `PGRST_DB_PRE_REQUEST` hook behavior, and that Studio's Table
> Editor / SQL Editor genuinely call `/rest/v1/*` and `/pg/*` directly from
> the browser (rather than proxying through Studio's own Next.js backend,
> which this design wouldn't intercept). If Studio's actual traffic
> pattern differs, its own audit entries would keep showing `'unknown'`
> rather than a real email - check your browser's network tab against
> `volumes/api/kong.yml`'s routes to confirm if you rely on this.

**On an already-running deployment**, `volumes/db/audit.sql` won't retroactively
apply (Postgres only runs `docker-entrypoint-initdb.d` scripts once, against
a brand-new `volumes/db/data`) - `portal/server/plugins/bootstrap-audit.ts`
applies the identical, idempotent SQL on every portal boot instead, so the
feature reaches existing deployments on their next restart without a
volume wipe. One consequence: right after upgrading, there's a brief
window (until the portal finishes that one-time boot step) where
`PGRST_DB_PRE_REQUEST` points at a function that doesn't exist yet, and
REST API calls may error until it does - self-healing, typically a matter
of seconds.

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
* `audit_log` (see "Audit log") has no retention or pruning - it grows
  forever. Fine at self-hosted scale, but if you import/edit a lot of data
  over a long period, periodically archiving or trimming old rows is on
  you; nothing in this stack does it automatically.
