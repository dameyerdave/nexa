#!/usr/bin/env node
/** `nexa` - admin CLI for user management, meant to run inside the portal
 * container (`docker compose exec portal nexa ...`), which already has
 * network access to Metabase and PostgREST over the internal Docker
 * network and the same NUXT_* env vars the portal app itself uses.
 *
 * Deliberately standalone (plain Node, no Nitro/Nuxt runtime) - it talks
 * to the same Metabase admin API and portal_2fa/portal_2fa_recovery_codes
 * tables as portal/server/utils/metabase-auth.ts and
 * portal/server/utils/two-factor-store.ts, re-implemented here rather
 * than imported, since those files rely on Nitro's auto-imported
 * useRuntimeConfig()/createError() which don't exist outside a request. */

import * as OTPAuth from "otpauth";
import qrcodeTerminal from "qrcode-terminal";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const BACKUP_DIR = "/backups";

const METABASE_URL = process.env.NUXT_METABASE_INTERNAL_URL;
const REST_URL = process.env.NUXT_REST_INTERNAL_URL;
const SERVICE_ROLE_KEY = process.env.NUXT_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.NUXT_METABASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.NUXT_METABASE_ADMIN_PASSWORD;
// Set by the host-side ./nexa wrapper (the shell user who ran the
// command) - falls back to this generic marker for anyone calling
// `docker compose exec portal nexa ...` directly instead.
const OPERATOR = process.env.NEXA_OPERATOR || "nexa-cli";

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!METABASE_URL || !REST_URL || !SERVICE_ROLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  die("Missing configuration - this command must run inside the portal container: docker compose exec portal nexa ...");
}

function usage() {
  console.log(`Usage:
  nexa user add <email> [--first-name NAME] [--last-name NAME] [--group NAME]... [--password PW]
      Creates a Metabase account. Prints a generated password if --password isn't given.

  nexa user password <email> [--password PW]
      Sets/resets a user's Metabase password. Prints a generated one if --password isn't given.

  nexa user 2fa reset <email>
      Clears a user's 2FA enrollment - they're prompted to enroll again next time they sign in.

  nexa user 2fa get <email>
      Shows a user's current 2FA info (QR code, manual entry code) - generating it first if they
      haven't enrolled yet (also prints recovery codes in that case), or reading back their existing
      secret if they have. Re-showing an existing secret is harmless (it doesn't invalidate anything),
      but recovery codes are only ever stored hashed, so existing ones can't be shown again - use
      "2fa reset" first if a user needs a fresh set.

  nexa db backup [filename]
      Dumps the entire Postgres cluster (every database, every role - not just one database) via
      pg_dumpall to ${BACKUP_DIR}/<filename>, or ${BACKUP_DIR}/nexa-<timestamp>.sql if omitted.
      A relative filename is resolved under ${BACKUP_DIR}; an absolute one is used as-is.

  nexa db restore <filename> [--yes]
      Restores a backup made with "db backup", OVERWRITING THE ENTIRE CLUSTER - every database,
      every table, every role, replaced with the backup's contents. Cannot be undone. Prompts for
      confirmation on a real terminal; pass --yes to skip that in a non-interactive context.`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      const hasValue = next !== undefined && !next.startsWith("--");
      if (key === "group") {
        (flags.group ??= []).push(hasValue ? next : true);
      } else {
        flags[key] = hasValue ? next : true;
      }
      if (hasValue) i++;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

function hashRecoveryCode(code) {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}

async function metabaseAdminSession() {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) die(`Could not authenticate as the Metabase admin (${res.status}): ${await res.text()}`);
  return (await res.json()).id;
}

async function metabaseFetch(session, path, opts = {}) {
  const res = await fetch(`${METABASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Metabase-Session": session, ...opts.headers },
  });
  if (!res.ok) die(`Metabase API error (${res.status}) on ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function findUserByEmail(session, email) {
  const result = await metabaseFetch(session, `/api/user?query=${encodeURIComponent(email)}`);
  return result.data.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

async function listGroups(session) {
  return metabaseFetch(session, "/api/permissions/group");
}

function restHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function restFetch(path, opts = {}) {
  const res = await fetch(`${REST_URL}${path}`, { ...opts, headers: restHeaders(opts.headers) });
  if (!res.ok) die(`PostgREST error (${res.status}) on ${path}: ${await res.text()}`);
  return res.headers.get("content-length") === "0" || res.status === 204 ? null : res.json();
}

/** Records a CLI-driven admin action in the same audit_log table the
 * portal's own row-change triggers and auth events (see
 * server/api/auth/*.ts) write to - best-effort, using a raw fetch rather
 * than restFetch() since that calls die() (process.exit) on failure,
 * which a try/catch here can't stop - a logging hiccup must never take
 * down the actual command that already succeeded. changedBy defaults to
 * whoever ran the host ./nexa wrapper (see OPERATOR above). */
async function auditLog(operation, detail, changedBy = OPERATOR) {
  try {
    const res = await fetch(`${REST_URL}/audit_log`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify([{ table_name: "admin_cli", operation, changed_by: changedBy, new_data: detail ?? null }]),
    });
    if (!res.ok) console.error(`Warning: failed to write audit log entry (${res.status})`);
  } catch (err) {
    console.error(`Warning: failed to write audit log entry: ${err.message}`);
  }
}

async function cmdUserAdd(args) {
  const { flags, positional } = parseFlags(args);
  const email = positional[0];
  if (!email) die("Usage: nexa user add <email> [--first-name NAME] [--last-name NAME] [--group NAME]... [--password PW]");

  const session = await metabaseAdminSession();
  if (await findUserByEmail(session, email)) die(`A Metabase user with email ${email} already exists.`);

  const password = flags.password && flags.password !== true ? flags.password : generatePassword();
  const user = await metabaseFetch(session, "/api/user", {
    method: "POST",
    body: JSON.stringify({
      email,
      first_name: flags["first-name"] && flags["first-name"] !== true ? flags["first-name"] : null,
      last_name: flags["last-name"] && flags["last-name"] !== true ? flags["last-name"] : null,
    }),
  });
  await metabaseFetch(session, `/api/user/${user.id}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });

  const groupNames = flags.group ?? [];
  if (groupNames.length) {
    const groups = await listGroups(session);
    for (const name of groupNames) {
      const group = groups.find((g) => g.name === name);
      if (!group) die(`No Metabase group named "${name}" - existing groups: ${groups.map((g) => g.name).join(", ")}`);
      await metabaseFetch(session, "/api/permissions/membership", {
        method: "POST",
        body: JSON.stringify({ group_id: group.id, user_id: user.id }),
      });
    }
  }

  console.log(`Created ${email} (id ${user.id})${groupNames.length ? `, groups: ${groupNames.join(", ")}` : ""}`);
  if (flags.password === undefined) console.log(`Generated password: ${password}`);
  console.log(`2FA isn't set up yet - run: nexa user 2fa get ${email}`);

  await auditLog("USER_ADD", { email, groups: groupNames });
}

async function cmdUserPassword(args) {
  const { flags, positional } = parseFlags(args);
  const email = positional[0];
  if (!email) die("Usage: nexa user password <email> [--password PW]");

  const session = await metabaseAdminSession();
  const user = await findUserByEmail(session, email);
  if (!user) die(`No Metabase user found with email ${email}`);

  const password = flags.password && flags.password !== true ? flags.password : generatePassword();
  await metabaseFetch(session, `/api/user/${user.id}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });

  console.log(`Password updated for ${email}`);
  if (flags.password === undefined) console.log(`Generated password: ${password}`);

  await auditLog("USER_PASSWORD_RESET", { email });
}

async function cmdUser2faReset(args) {
  const { positional } = parseFlags(args);
  const email = positional[0];
  if (!email) die("Usage: nexa user 2fa reset <email>");

  const session = await metabaseAdminSession();
  const user = await findUserByEmail(session, email);
  if (!user) die(`No Metabase user found with email ${email}`);

  // portal_2fa_recovery_codes cascades on delete (FK to portal_2fa) - one delete clears both.
  await restFetch(`/portal_2fa?metabase_user_id=eq.${user.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  console.log(`2FA reset for ${email} - they'll be prompted to enroll again next time they sign in,`);
  console.log(`or run: nexa user 2fa get ${email}`);

  await auditLog("USER_2FA_RESET", { email });
}

async function cmdUser2faGet(args) {
  const { positional } = parseFlags(args);
  const email = positional[0];
  if (!email) die("Usage: nexa user 2fa get <email>");

  const session = await metabaseAdminSession();
  const user = await findUserByEmail(session, email);
  if (!user) die(`No Metabase user found with email ${email}`);

  const existing = await restFetch(`/portal_2fa?select=totp_secret&metabase_user_id=eq.${user.id}&limit=1`);
  const isNew = existing.length === 0;

  // The TOTP secret is stored in plaintext (it has to be, to check codes
  // against it later), so an existing enrollment's secret/QR can just be
  // read back and re-shown - harmless, since scanning the same secret
  // into another authenticator app doesn't invalidate anything. Recovery
  // codes are the opposite: only ever stored as a SHA-256 hash, so an
  // existing enrollment's codes genuinely can't be retrieved again.
  const secret = isNew ? new OTPAuth.Secret({ size: 20 }).base32 : existing[0].totp_secret;
  const totp = new OTPAuth.TOTP({ issuer: "Nexdata", label: email, secret: OTPAuth.Secret.fromBase32(secret) });
  const uri = totp.toString();

  let recoveryCodes = null;
  if (isNew) {
    recoveryCodes = generateRecoveryCodes();
    await restFetch(`/portal_2fa?on_conflict=metabase_user_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ metabase_user_id: user.id, email, totp_secret: secret }]),
    });
    await restFetch(`/portal_2fa_recovery_codes?metabase_user_id=eq.${user.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await restFetch("/portal_2fa_recovery_codes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(recoveryCodes.map((code) => ({ metabase_user_id: user.id, code_hash: hashRecoveryCode(code) }))),
    });
  }

  console.log(`2FA ${isNew ? "setup" : "info"} for ${email}${isNew ? "" : " (existing enrollment)"}\n`);
  console.log(`Manual entry code: ${secret}\n`);
  console.log("Scan this with an authenticator app:\n");
  qrcodeTerminal.generate(uri, { small: true }, (qr) => console.log(qr));
  if (recoveryCodes) {
    console.log("Recovery codes (save these - shown only once):");
    for (const code of recoveryCodes) console.log(`  ${code}`);
  } else {
    console.log("Recovery codes aren't retrievable - they were only ever shown once, at enrollment.");
    console.log(`To issue new ones: nexa user 2fa reset ${email} && nexa user 2fa get ${email}`);
  }

  await auditLog(isNew ? "USER_2FA_ENROLL" : "USER_2FA_VIEW", { email });
}

function resolveBackupPath(filename) {
  if (!filename) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    filename = `nexa-${stamp}.sql`;
  }
  return path.isAbsolute(filename) ? filename : path.join(BACKUP_DIR, filename);
}

/** Prompts on a real terminal; on a non-interactive one (e.g. piped, or
 * `docker compose exec -T`) there's no way to ask, so the caller must
 * pass --yes instead - never silently assumes consent. */
async function confirmDestructive(message) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${message} Type "yes" to continue: `, resolve));
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

function run(cmd, args, { stdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", stdout ? "pipe" : "inherit", "inherit"] });
    let streamFinished = Promise.resolve();
    if (stdout) {
      child.stdout.pipe(stdout);
      // Waited on below alongside process exit, so the file is guaranteed
      // fully flushed to disk before this resolves - piping alone doesn't
      // guarantee the write stream has finished by the time the child
      // process exits.
      streamFinished = new Promise((res, rej) => {
        stdout.on("finish", res);
        stdout.on("error", rej);
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`${cmd} exited with code ${code}`));
      streamFinished.then(resolve, reject);
    });
  });
}

async function cmdDbBackup(args) {
  const { positional } = parseFlags(args);
  await mkdir(BACKUP_DIR, { recursive: true });
  const filePath = resolveBackupPath(positional[0]);

  console.log(`Backing up the whole Postgres cluster (all databases + roles) to ${filePath} ...`);
  const out = createWriteStream(filePath);
  try {
    // --clean --if-exists: the restore side (below) drops each object
    // before recreating it, so restoring into an already-populated
    // cluster doesn't fail on "already exists".
    await run("pg_dumpall", ["--clean", "--if-exists"], { stdout: out });
  } catch (err) {
    die(`Backup failed: ${err.message}`);
  }
  console.log(`Backup complete: ${filePath}`);

  await auditLog("DB_BACKUP", { file: filePath });
}

async function cmdDbRestore(args) {
  const { flags, positional } = parseFlags(args);
  const filename = positional[0];
  if (!filename) die("Usage: nexa db restore <filename> [--yes]");
  const filePath = resolveBackupPath(filename);
  if (!existsSync(filePath)) die(`No such backup file: ${filePath}`);

  console.log(`This will OVERWRITE THE ENTIRE Postgres cluster - every database, every table, every`);
  console.log(`role - with the contents of ${filePath}. This cannot be undone.`);
  const confirmed = flags.yes === true || (await confirmDestructive("Continue?"));
  if (!confirmed) die('Aborted - re-run with --yes to skip confirmation in a non-interactive context.');

  // Logged before running, not just after - a full-cluster restore is the
  // single most destructive thing this CLI can do, so there should be a
  // record that it was *attempted* even if it fails partway through.
  await auditLog("DB_RESTORE_STARTED", { file: filePath });

  console.log(`Restoring from ${filePath} ...`);
  console.log(
    "Expect a lot of red ERROR lines below for roles/schemas/tables that already exist, or are\n" +
      '"reserved" on Supabase\'s hardened image - confirmed live these are normal noise when restoring\n' +
      "onto an already-initialized cluster (this project's own db init already created them fresh);\n" +
      "the actual data still restores underneath them. Scroll for anything that doesn't look like that.",
  );
  try {
    // Deliberately no -v ON_ERROR_STOP=1: confirmed live that stopping on
    // the first error aborts almost immediately, since a handful of
    // pg_dumpall's statements are *expected* to fail on an
    // already-initialized cluster (dropping the role/database the
    // restoring session is itself connected as, re-creating roles
    // Supabase's image marks "reserved" and already created via its own
    // init, etc.) - psql's default behavior (report and keep going) is
    // the correct one here, same as PostgreSQL's own docs recommend for
    // restoring pg_dumpall output onto a non-empty cluster.
    //
    // Connects to template1, not postgres/supabase_admin's default db -
    // pg_dumpall's output can't drop the database the restoring session
    // is itself connected to, and template1 always exists untouched.
    await run("psql", ["-d", "template1", "-f", filePath]);
  } catch (err) {
    die(`Restore failed: ${err.message}`);
  }
  console.log("Restore complete.");

  await auditLog("DB_RESTORE_COMPLETE", { file: filePath });
}

const [resource, action, ...rest] = process.argv.slice(2);

if (resource === "user" && action === "add") await cmdUserAdd(rest);
else if (resource === "user" && action === "password") await cmdUserPassword(rest);
else if (resource === "user" && action === "2fa") {
  const [subaction, ...rest2] = rest;
  if (subaction === "reset") await cmdUser2faReset(rest2);
  else if (subaction === "get") await cmdUser2faGet(rest2);
  else usage();
} else if (resource === "db" && action === "backup") await cmdDbBackup(rest);
else if (resource === "db" && action === "restore") await cmdDbRestore(rest);
else usage();
