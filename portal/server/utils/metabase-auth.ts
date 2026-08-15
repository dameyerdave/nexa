/** Metabase is the portal's identity provider (see README.md "Authentication").
 * A real end-user login always happens server-to-server, over the internal
 * Docker network - never through Kong's published Metabase listener, which
 * blocks POST /api/session outright (see kong.yml) so nobody can create a
 * session except by going through the portal's own 2FA-gated login route. */

interface MetabaseSessionResult {
  /** Every Set-Cookie header Metabase's response carried - relayed
   * verbatim onto the browser's own response once 2FA also passes, rather
   * than reconstructed, so none of Metabase's own cookie attributes get
   * second-guessed here. */
  setCookies: string[];
  userId: number;
  email: string;
}

export interface MetabaseGroup {
  id: number;
  name: string;
}

function metabaseHeaders(sessionToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionToken) headers["X-Metabase-Session"] = sessionToken;
  return headers;
}

async function getSetCookies(res: Response): Promise<string[]> {
  // getSetCookie() (Node 18.14+/undici) returns each Set-Cookie header
  // distinctly - Headers.get() would incorrectly comma-join multiple
  // Set-Cookie values into one string, corrupting their own attributes.
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** Logs a real end user in with their own credentials. Returns null on
 * bad credentials rather than throwing - a login failure is an expected
 * outcome here, not a server error. */
export async function metabaseLogin(username: string, password: string): Promise<MetabaseSessionResult | null> {
  const config = useRuntimeConfig();
  const res = await fetch(`${config.metabaseInternalUrl}/api/session`, {
    method: "POST",
    headers: metabaseHeaders(),
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;

  const setCookies = await getSetCookies(res);
  const body = (await res.json()) as { id?: string };
  if (setCookies.length === 0 || !body.id) return null;

  const me = await metabaseUserFromSession(body.id);
  return me ? { setCookies, userId: me.userId, email: me.email } : null;
}

/** Validates a session token (as forwarded by the browser's
 * metabase.SESSION cookie, or a fresh one just obtained from login) and
 * returns who it belongs to, or null if invalid/expired. */
export async function metabaseUserFromSession(
  sessionToken: string,
): Promise<{ userId: number; email: string; isSuperuser: boolean } | null> {
  const config = useRuntimeConfig();
  const res = await fetch(`${config.metabaseInternalUrl}/api/user/current`, {
    headers: metabaseHeaders(sessionToken),
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: number; email: string; is_superuser?: boolean };
  return { userId: user.id, email: user.email, isSuperuser: !!user.is_superuser };
}

export async function metabaseLogout(sessionToken: string): Promise<void> {
  const config = useRuntimeConfig();
  await fetch(`${config.metabaseInternalUrl}/api/session`, {
    method: "DELETE",
    headers: metabaseHeaders(sessionToken),
    body: JSON.stringify({}),
    // Best-effort - the browser's own cookie is what the caller actually
    // clears; a lingering server-side Metabase session just expires on
    // its own later if this fails.
  }).catch(() => {});
}

/** Cached and de-duplicated - confirmed live that leaving this uncached
 * (a fresh admin login on every call) causes real failures under load:
 * Studio's SPA fires a burst of parallel requests on mount, each
 * independently needing an editor check (see editor-session-cache.ts),
 * and enough concurrent admin logins racing each other made some of them
 * fail outright. Metabase sessions are long-lived by default (weeks), so
 * a much shorter local TTL here just bounds how stale a revoked admin
 * session could be, not real cache-correctness risk. */
let cachedAdminSession: { token: string; expiresAt: number } | null = null;
let pendingAdminSession: Promise<string> | null = null;
const ADMIN_SESSION_TTL_MS = 10 * 60 * 1000;

async function metabaseAdminSession(): Promise<string> {
  if (cachedAdminSession && cachedAdminSession.expiresAt > Date.now()) return cachedAdminSession.token;
  if (pendingAdminSession) return pendingAdminSession;

  const config = useRuntimeConfig();
  pendingAdminSession = (async () => {
    const res = await fetch(`${config.metabaseInternalUrl}/api/session`, {
      method: "POST",
      headers: metabaseHeaders(),
      body: JSON.stringify({ username: config.metabaseAdminEmail, password: config.metabaseAdminPassword }),
    });
    if (!res.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: "Could not authenticate the portal's own Metabase admin account",
      });
    }
    const body = (await res.json()) as { id: string };
    cachedAdminSession = { token: body.id, expiresAt: Date.now() + ADMIN_SESSION_TTL_MS };
    return body.id;
  })();

  try {
    return await pendingAdminSession;
  } finally {
    pendingAdminSession = null;
  }
}

/** True if this Metabase user belongs to the configured editor group -
 * the only group that unlocks Supabase Studio / Import Excel in the
 * portal, alongside read/write dashboard access in Metabase itself.
 * Looked up via the portal's own admin session, since a regular user's
 * session isn't allowed to see group membership at all, only its own. */
export async function isMetabaseEditor(userId: number): Promise<boolean> {
  const config = useRuntimeConfig();
  const adminSession = await metabaseAdminSession();

  const groups = await $fetch<Array<{ id: number; name: string }>>(
    `${config.metabaseInternalUrl}/api/permissions/group`,
    { headers: metabaseHeaders(adminSession) },
  );
  const editorGroup = groups.find((g) => g.name === config.metabaseEditorGroup);
  if (!editorGroup) return false;

  const membership = await $fetch<Record<string, Array<{ group_id: number }>>>(
    `${config.metabaseInternalUrl}/api/permissions/membership`,
    { headers: metabaseHeaders(adminSession) },
  );
  const userMemberships = membership[String(userId)] ?? [];
  return userMemberships.some((m) => m.group_id === editorGroup.id);
}

/** Calls a Metabase admin-only endpoint with the portal's admin session,
 * surfacing Metabase's own 4xx (e.g. "email already exists") to the
 * caller instead of flattening everything to a generic 502. */
async function metabaseAdminFetch<T>(path: string, opts: { method: string; body?: unknown }): Promise<T> {
  const config = useRuntimeConfig();
  const adminSession = await metabaseAdminSession();
  try {
    return await $fetch<T>(`${config.metabaseInternalUrl}${path}`, {
      method: opts.method as any,
      headers: metabaseHeaders(adminSession),
      body: opts.body,
    });
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.data?.message || err?.data?.errors || err?.message || String(err);
    throw createError({
      statusCode: status && status < 500 ? status : 502,
      statusMessage: `Metabase error: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    });
  }
}

/** Every group an approving admin can assign a newly-registered user to -
 * excludes Metabase's built-in "All Users" (automatic for everyone) and
 * "Administrators" (granting Metabase superuser stays a manual action in
 * Metabase's own admin UI, not something this approval flow hands out). */
export async function listAssignableGroups(): Promise<MetabaseGroup[]> {
  const groups = await metabaseAdminFetch<MetabaseGroup[]>("/api/permissions/group", { method: "GET" });
  return groups.filter((g) => g.name !== "All Users" && g.name !== "Administrators");
}

/** Creates a real Metabase account for an approved registration: the
 * user, its password (set directly by the portal's admin session - see
 * README.md "Authentication" for why this is safe here and the one part
 * of this integration that couldn't be verified against a live Metabase
 * instance while building it), and its group memberships. */
export async function createMetabaseUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  groupIds: number[];
}): Promise<number> {
  const user = await metabaseAdminFetch<{ id: number }>("/api/user", {
    method: "POST",
    body: { email: input.email, first_name: input.firstName, last_name: input.lastName },
  });

  await metabaseAdminFetch(`/api/user/${user.id}/password`, {
    method: "PUT",
    body: { password: input.password },
  });

  for (const groupId of input.groupIds) {
    await metabaseAdminFetch("/api/permissions/membership", {
      method: "POST",
      body: { group_id: groupId, user_id: user.id },
    });
  }

  return user.id;
}
