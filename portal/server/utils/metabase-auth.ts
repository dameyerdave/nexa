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
export async function metabaseUserFromSession(sessionToken: string): Promise<{ userId: number; email: string } | null> {
  const config = useRuntimeConfig();
  const res = await fetch(`${config.metabaseInternalUrl}/api/user/current`, {
    headers: metabaseHeaders(sessionToken),
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: number; email: string };
  return { userId: user.id, email: user.email };
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

async function metabaseAdminSession(): Promise<string> {
  const config = useRuntimeConfig();
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
  return body.id;
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
