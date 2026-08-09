/** Per-user TOTP secrets and recovery codes. Lives in `public` (so the
 * portal can reach it through the same PostgREST/service-role path as
 * everything else) but deliberately carries no `grant ... to
 * authenticated/anon` - Supabase's own default-privilege bootstrap
 * (roles.sql) already grants service_role full access to every table in
 * this schema regardless, so leaving anon/authenticated ungranted is
 * enough to keep this unreachable from anywhere but the portal's own
 * server-side, service-role-key calls. */

let tablesEnsured = false;

export async function ensureTwoFactorTables(): Promise<void> {
  if (tablesEnsured) return;
  await pgMetaQuery(`
    create table if not exists "public"."portal_2fa" (
      metabase_user_id bigint primary key,
      email text not null,
      totp_secret text not null,
      enrolled_at timestamptz not null default now()
    );
    create table if not exists "public"."portal_2fa_recovery_codes" (
      id bigint generated always as identity primary key,
      metabase_user_id bigint not null references "public"."portal_2fa"(metabase_user_id) on delete cascade,
      code_hash text not null,
      used_at timestamptz
    );
  `);
  tablesEnsured = true;
}

export async function getTotpSecret(userId: number): Promise<string | null> {
  await ensureTwoFactorTables();
  const rows = await restSelect<{ totp_secret: string }>(
    "portal_2fa",
    `select=totp_secret&metabase_user_id=eq.${userId}&limit=1`,
  );
  return rows[0]?.totp_secret ?? null;
}

export async function hasTotpEnrolled(userId: number): Promise<boolean> {
  return (await getTotpSecret(userId)) !== null;
}

/** Commits a first-time enrollment: the secret plus a fresh batch of
 * hashed recovery codes, replacing any previous ones for this user (there
 * should never be any, but re-enrollment after an admin resets a user's
 * 2FA is exactly the case where there might be). Shared by the ordinary
 * first-login enrollment flow (plaintext codes, hashed here) and
 * registration approval (already-hashed codes carried over from
 * registration-store.ts, since the plaintext was only ever shown once to
 * the user at signup time and was never persisted). */
async function insertEnrollment(
  userId: number,
  email: string,
  secret: string,
  recoveryCodeHashes: string[],
): Promise<void> {
  await ensureTwoFactorTables();
  await restInsert("portal_2fa", [{ metabase_user_id: userId, email, totp_secret: secret }], {
    onConflict: "metabase_user_id",
  });
  await restDelete("portal_2fa_recovery_codes", `metabase_user_id=eq.${userId}`);
  await restInsert(
    "portal_2fa_recovery_codes",
    recoveryCodeHashes.map((code_hash) => ({ metabase_user_id: userId, code_hash })),
  );
}

export async function commitTotpEnrollment(
  userId: number,
  email: string,
  secret: string,
  recoveryCodes: string[],
): Promise<void> {
  await insertEnrollment(userId, email, secret, recoveryCodes.map(hashRecoveryCode));
}

export async function commitTotpEnrollmentHashed(
  userId: number,
  email: string,
  secret: string,
  recoveryCodeHashes: string[],
): Promise<void> {
  await insertEnrollment(userId, email, secret, recoveryCodeHashes);
}

/** Consumes one unused recovery code for this user, if the given code
 * matches one. Each code works exactly once. */
export async function redeemRecoveryCode(userId: number, code: string): Promise<boolean> {
  await ensureTwoFactorTables();
  const hash = hashRecoveryCode(code);
  const rows = await restSelect<{ id: number }>(
    "portal_2fa_recovery_codes",
    `select=id&metabase_user_id=eq.${userId}&code_hash=eq.${hash}&used_at=is.null&limit=1`,
  );
  const match = rows[0];
  if (!match) return false;
  await restUpdate("portal_2fa_recovery_codes", `id=eq.${match.id}`, { used_at: new Date().toISOString() });
  return true;
}
