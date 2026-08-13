/** Self-registration is admin-gated: a signup lands here as a `pending`
 * row - including its own 2FA enrollment, done up front so approval is a
 * single step later - and only becomes a real, sign-in-capable Metabase
 * account once an admin approves it (server/api/admin/registrations/[id]/approve.post.ts).
 * Same visibility model as portal_2fa: `public` schema, no grants to
 * anon/authenticated, reachable only via the portal's own service-role
 * PostgREST calls. */

export type RegistrationStatus = "pending" | "approved" | "rejected";

export interface Registration {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  /** AES-256-GCM ciphertext (see secret-box.ts) - decrypted only once, at
   * approval time, to become the new Metabase account's real password. */
  password_enc: string;
  totp_secret: string | null;
  totp_enrolled: boolean;
  recovery_code_hashes: string[];
  status: RegistrationStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

let tableEnsured = false;

export async function ensureRegistrationTable(): Promise<void> {
  if (tableEnsured) return;
  await pgMetaQuery(`
    create table if not exists "public"."portal_registrations" (
      id bigint generated always as identity primary key,
      email text not null,
      first_name text not null,
      last_name text not null,
      password_enc text not null,
      totp_secret text,
      totp_enrolled boolean not null default false,
      recovery_code_hashes jsonb not null default '[]'::jsonb,
      status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
      requested_at timestamptz not null default now(),
      decided_at timestamptz,
      decided_by text
    );
    notify pgrst, 'reload schema';
  `);
  tableEnsured = true;
}

/** A signup with the same email already awaiting or past approval - used
 * to reject a duplicate registration attempt. Rejected attempts don't
 * block a retry. */
export async function findActiveRegistrationByEmail(email: string): Promise<Registration | null> {
  await ensureRegistrationTable();
  const rows = await restSelect<Registration>(
    "portal_registrations",
    `email=eq.${encodeURIComponent(email)}&status=in.(pending,approved)&limit=1`,
  );
  return rows[0] ?? null;
}

export async function createRegistration(input: {
  email: string;
  firstName: string;
  lastName: string;
  passwordEnc: string;
  totpSecret: string;
}): Promise<Registration> {
  await ensureRegistrationTable();
  const [row] = await restInsertReturning<Registration>("portal_registrations", [
    {
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      password_enc: input.passwordEnc,
      totp_secret: input.totpSecret,
    },
  ]);
  return row;
}

export async function getRegistration(id: number): Promise<Registration | null> {
  await ensureRegistrationTable();
  const rows = await restSelect<Registration>("portal_registrations", `id=eq.${id}&limit=1`);
  return rows[0] ?? null;
}

export async function commitRegistrationTotp(id: number, recoveryCodeHashes: string[]): Promise<void> {
  await restUpdate("portal_registrations", `id=eq.${id}`, {
    totp_enrolled: true,
    recovery_code_hashes: recoveryCodeHashes,
  });
}

export async function listPendingRegistrations(): Promise<Registration[]> {
  await ensureRegistrationTable();
  return restSelect<Registration>("portal_registrations", "status=eq.pending&order=requested_at.asc");
}

/** Marks the final decision and, on approval, wipes the now-unnecessary
 * encrypted password - the real Metabase account is the source of truth
 * for it from this point on. */
export async function decideRegistration(
  id: number,
  status: "approved" | "rejected",
  decidedBy: string,
): Promise<void> {
  await restUpdate("portal_registrations", `id=eq.${id}`, {
    status,
    decided_at: new Date().toISOString(),
    decided_by: decidedBy,
    ...(status === "approved" ? { password_enc: "" } : {}),
  });
}
