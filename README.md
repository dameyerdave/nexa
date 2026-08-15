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

> **Confirmed live, and fixed:** creating a table via pg-meta and
> immediately inserting into it via PostgREST (exactly what an import
> does) can otherwise 502 with `PGRST205` ("Could not find the table ...
> in the schema cache") - PostgREST doesn't pick up schema changes made
> through a different connection (pg-meta's) instantly, even with an
> explicit `notify pgrst, 'reload schema'` right after the DDL (confirmed
> that alone isn't synchronous - it took ~100-200ms to take effect in
> testing). `portal/server/utils/postgrest.ts` retries once or twice, a
> beat apart, specifically on that error code, which was enough to make
> the race unhittable in testing. The same notify is fired after every
> portal-driven schema change (`pg-meta.ts`'s `createTable`/`dropTable`/
> `ensureUniqueConstraint`, and each `ensure*Table*` bootstrap) so the
> window is as small as possible in the first place.

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

> Confirmed against a live instance (Metabase v0.53.13): the
> `PUT /api/user/:id/password` admin password-set call,
> `PUT /api/user/:id` for updating email, the single-membership
> `POST /api/permissions/membership` shape (`{group_id, user_id}`), and the
> `/api/session/properties` `setup-token` + `POST /api/setup` shape all work
> exactly as documented above. One real gotcha found this way: **Metabase
> rejects new passwords it considers too common**, checked against its own
> blocklist independent of length or character mix - `change-me-too` (an
> earlier default here) was one such rejection, which silently prevented
> the initial admin account from ever being created. `.env.example`'s
> placeholder is a password confirmed to pass; if the bootstrap plugin
> still doesn't create the account, check `docker compose logs portal` for
> `[bootstrap-metabase-admin]`, which now logs Metabase's actual rejection
> reason instead of a generic error.

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

### How Studio and Metabase are embedded

Both Studio and Metabase refuse to be framed by default, and Metabase's
frontend needs one more thing on top: two real bugs, both confirmed
against a live stack rather than assumed:

1. **Both send frame-busting response headers.** Studio sends
   `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
   'none'`; Metabase sends the same CSP. Browsers refuse to render either
   in an `<iframe>` at all otherwise. `volumes/api/kong.yml`'s `dashboard`
   (Studio) and `metabase` routes now strip both headers with a
   `response-transformer` plugin before the response reaches the browser.
2. **Full interactive embedding of Metabase specifically is an
   Enterprise/Pro-only feature** - confirmed live: enabling
   `enable-embedding-interactive` succeeds, but setting
   `embedding-app-origins-interactive` (the allowed-origins list, required
   for the CSP to actually relax) fails outright with "feature :embedding
   is not available" on the open-source image this stack uses. There's no
   config path to a working `frame-ancestors` from Metabase's own settings
   - stripping the header at Kong is the only way to embed it at all on
   this edition. This is a deliberate choice to embed our own self-hosted,
   AGPL-licensed instance for our own authenticated users, through the
   same reverse proxy already in front of it - not something Metabase
   Inc.'s embedding product is involved in, since none of its actual
   features (JWT SSO tokens, the embedding SDK, official support) are
   used here.

**Studio's original access control doesn't survive browsers either.** The
first design here (matching Studio's original self-hosted docs) had Kong
protect it with HTTP Basic Auth and the portal build an iframe `src` with
credentials embedded in the URL (`https://user:pass@host/`) so users
weren't prompted separately. Confirmed live that this is silently blocked:
modern browsers refuse credentialed subresource requests for a
cross-origin `<iframe src>` (the portal and Studio are on the same
hostname but different ports here, which still counts as cross-origin),
so the iframe just failed to load with no useful error. Kong's `dashboard`
route no longer uses Basic Auth at all - it's routed through the portal
instead (`http://portal:3000/api/proxy/studio/`, same pattern as the
`meta`/`rest-v1` routes added for the audit log), and
`server/utils/studio-proxy.ts`'s `proxyStudioShellRequest` requires a
*real, editor-level* Metabase session (checked from the browser's own
`metabase.SESSION` cookie, cached ~60s since Studio's SPA can fire dozens
of asset requests per page load) before forwarding anything - this matters
more than it might look, since Studio's frontend bundle embeds the
`service_role` key for its own use, so anyone who can load the shell at
all effectively gets full, unrestricted database access regardless of
what they click on. Verified live: an account with no group membership
(a viewer) gets a 403 hitting Studio at all, while an editor gets the real
page.

One Nitro-specific gotcha hit while building this, worth knowing if you
touch the proxy routes: a catch-all route file (`[...path].ts`) does
*not* match its own parent path with zero segments (confirmed live -
`/api/proxy/studio/foo` matches, `/api/proxy/studio/` doesn't, silently
falling through to the SPA instead of 403ing). Since Kong's root request
for Studio's own homepage hits exactly that empty-path case, each proxy
directory also has a plain `index.ts` sibling handling it explicitly.

## Admin CLI

For provisioning accounts without going through the web registration/approval
flow - e.g. scripting a bunch of accounts, or handing someone a fully working
login (password + 2FA already set up) without them ever visiting the portal -
there's a small `nexa` CLI baked into the portal image
(`portal/cli/nexa.mjs`). Run it from the host via the [`nexa`](./nexa) wrapper
script at the repo root, which finds the repo, checks the portal container
is up, and runs the real thing inside it
(`docker compose exec portal nexa ...` - works too, the wrapper is just
shorter and gives a clearer error if the stack isn't running):

```sh
./nexa user add jane@example.com --first-name Jane --last-name Doe --group Editors
./nexa user password jane@example.com
./nexa user 2fa get jane@example.com
./nexa user 2fa reset jane@example.com
./nexa db backup
./nexa db restore nexa-2026-08-15T14-05-00-000Z.sql --yes
```

* **`user add <email>`** - creates the Metabase account directly (optional
  `--first-name`/`--last-name`, repeatable `--group NAME` to assign
  group(s) at creation, `--password` to set one explicitly). Prints a
  generated password if `--password` isn't given. Unlike the portal's own
  registration-approval UI, this can assign *any* group, including
  Administrators - it's a lower-level, more trusted tool than the web
  dashboard, gated only by shell access to the portal container.
* **`user password <email>`** - sets/resets a Metabase password the same
  way (`PUT /api/user/:id/password` as the portal's own admin session -
  see "Authentication").
* **`user 2fa get <email>`** - shows a user's current 2FA info as an ASCII
  QR code right there in the terminal (`qrcode-terminal`) plus the manual
  entry code. If they haven't enrolled yet, it generates a fresh TOTP
  secret and recovery codes first, writing them straight into
  `portal_2fa`/`portal_2fa_recovery_codes` (the same tables the web
  enrollment flow uses) - a user provisioned this way skips straight to
  entering a 6-digit code on their first real portal login, no separate
  enrollment step. If they're already enrolled, it just reads back the
  existing secret (harmless to re-show - scanning it into another
  authenticator app doesn't invalidate anything), but *not* recovery
  codes, since only their SHA-256 hash is ever stored - `2fa reset` first
  if a user needs a new set.
* **`user 2fa reset <email>`** - clears a user's enrollment (`portal_2fa`
  row and its cascaded recovery codes), so they're prompted to enroll
  again next time they sign in, or so an admin can immediately run
  `2fa get` again.
* **`db backup [filename]`** - dumps the *entire Postgres cluster*
  (`pg_dumpall --clean --if-exists`, all databases - `postgres`,
  `metabase`, `_supabase` - and roles, not just one) to
  `./backups/<filename>` on the host (a bind-mounted volume, so it
  survives the container being recreated), or a timestamped name if you
  don't give one.
* **`db restore <filename> [--yes]`** - restores a backup made with
  `db backup`, overwriting the entire cluster with its contents. Prompts
  for confirmation on a real terminal (`--yes` skips that non-interactively).
  Connects as `supabase_admin`, not `postgres` - confirmed live that
  `postgres` isn't actually a superuser on Supabase's hardened image
  (`supabase_admin` is, with the same password), and restoring as
  `postgres` cascades into failures throughout (objects owned by
  `supabase_admin` can't be recreated, role-membership grants get
  rejected as touching "reserved roles", etc.). Also runs *without*
  `-v ON_ERROR_STOP=1` deliberately - confirmed live that a handful of
  pg_dumpall's statements are *expected* to fail when restoring onto an
  already-initialized cluster (dropping the role/database the restoring
  session is itself connected as, re-creating roles Supabase's image
  already created via its own init and marks "reserved") - stopping on
  the first one aborts almost immediately, before the real data restore
  even starts. Verified end-to-end in an isolated throwaway container
  (never against this repo's own live data): backed up the real running
  stack, restored it into a fresh `supabase/postgres` container, and
  confirmed the actual tables/rows landed correctly despite ~90 lines of
  expected "already exists" noise in the output.

Every subcommand above writes an entry to `audit_log` too (`table_name =
"admin_cli"`, visible in the **Audit log** admin page like everything
else) - `changed_by` is whoever ran the host [`nexa`](./nexa) wrapper
(reads `$USER`, passed through via `docker compose exec -e`), or
`nexa-cli` if you called `docker compose exec portal nexa` directly.

Standalone by design - `cli/nexa.mjs` doesn't import the Nitro-coupled
`server/utils/*` files (they rely on `useRuntimeConfig()`/`createError()`,
which only exist inside a request), it re-implements the same Metabase
admin API calls and table writes directly, reading the same `NUXT_METABASE_*`/
`NUXT_REST_INTERNAL_URL`/`NUXT_SERVICE_ROLE_KEY` env vars already set on the
portal container. All four subcommands verified end-to-end against a live
stack, including a full login through 2FA verification with a
CLI-provisioned account.

## Audit log

Every row change to any table in the `public` schema (except the portal's
own `portal_*` bookkeeping tables) is logged to `audit_log` - who changed
what, when, and the old/new row data - regardless of whether the change
came from Import Excel or directly from an editor poking around in the
embedded Studio. The same table also carries discrete application events
that aren't a row change at all: every login attempt (success and
failure), 2FA enrollment/verification (success and failure), logout,
recovery-code use, registration submitted/2FA-confirmed/approved/rejected
(`table_name = "auth"`, written directly by `portal/server/api/auth/*.ts`
and the registration-approval endpoints via
`portal/server/utils/auth-audit.ts` - includes the caller's IP), and every
`nexa` CLI admin action (`table_name = "admin_cli"` - see "Admin CLI"
above). Failed logins are logged under the *attempted* username, not a
resolved user, so credential-stuffing/brute-force attempts against
nonexistent accounts show up too, not just ones against real accounts.

Admins can browse all of it at **Audit log** in the portal header
(`portal/pages/admin/audit.vue`) - filterable by table, operation
(insert/update/delete - the auth/CLI event names like `LOGIN_FAILURE` or
`USER_2FA_RESET` aren't in that checkbox list, but still show up whenever
no operation filter is applied, and are reachable by filtering to the
`auth`/`admin_cli` table or by search), who made the change, a date
range, and free-text search across the before/after row data, with
pagination (`GET /api/admin/audit`, `portal/server/api/admin/audit.get.ts`).
The free-text
search runs through a `search_audit_log(term)` database function
(`public.search_audit_log`, defined in both `volumes/db/audit.sql` and
`portal/server/utils/audit-store.ts`) called via PostgREST's `/rpc/`
endpoint, rather than a plain URL filter - confirmed live that PostgREST's
filter syntax can't cast a jsonb column to text for `ilike` (it errors with
"operator does not exist: jsonb ~~\* unknown" even with an explicit
`::text` cast on the column), while a SQL function doing the same cast
works fine, and PostgREST supports layering the ordinary `table`/`operation`/
date-range filters and pagination on top of an RPC that returns `setof
audit_log`, same as querying the table directly.

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
> Confirmed live: PostgREST's `request.headers` GUC shape and
> `PGRST_DB_PRE_REQUEST` hook work exactly as described - a portal-driven
> write (Import Excel) showed up in `audit_log` with the real signed-in
> user's email, not `'unknown'`. Still genuinely unverified: whether
> Studio's Table Editor / SQL Editor actually call `/rest/v1/*` and `/pg/*`
> directly from the browser (rather than proxying through Studio's own
> Next.js backend, which this design wouldn't intercept) - that part needs
> exercising the embedded Studio UI itself to confirm, which wasn't done
> here. If Studio's actual traffic pattern differs, its own audit entries
> would keep showing `'unknown'` rather than a real email - check your
> browser's network tab against `volumes/api/kong.yml`'s routes to confirm
> if you rely on this.

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
nexa                      Host wrapper for the nexa admin CLI - see "Admin CLI"
backups/                  `nexa db backup`/`restore` dump files (gitignored)
volumes/                  Supabase self-hosting config (Kong routes, DB init SQL, ...)
portal/                   Nuxt 3 portal app (Dockerfile included)
```

## Production notes

* Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of
  `portal`, `kong` (`:8000`), and Kong's Metabase listener (`:8002`), and
  update `SUPABASE_PUBLIC_URL` and `METABASE_PUBLIC_URL` in `.env` to your
  real HTTPS domains. If you add another proxy layer of your own in front
  of Kong, make sure it doesn't reintroduce `X-Frame-Options`/CSP
  `frame-ancestors` headers on the way through - Kong already strips both
  from Studio's and Metabase's own responses (see "How Studio and Metabase
  are embedded"), but a well-meaning security header added at your outer
  proxy would break embedding the same way the original headers did.
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
