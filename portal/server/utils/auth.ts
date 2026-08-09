import type { H3Event } from "h3";

export const METABASE_COOKIE = "metabase.SESSION";

export interface PortalUser {
  id: number;
  email: string;
  isAdmin: boolean;
}

/**
 * Metabase is the portal's identity provider (see README.md
 * "Authentication") - the browser's own metabase.SESSION cookie (set by
 * server/api/auth/verify.post.ts once both password and 2FA pass) is
 * checked directly against Metabase itself, the same way the old version
 * of this function asked GoTrue whether a Supabase Auth token was valid.
 */
export async function getUserFromEvent(event: H3Event): Promise<PortalUser | null> {
  const token = getCookie(event, METABASE_COOKIE);
  if (!token) return null;
  const user = await metabaseUserFromSession(token);
  return user ? { id: user.userId, email: user.email, isAdmin: user.isSuperuser } : null;
}

export async function requireUser(event: H3Event): Promise<PortalUser> {
  const user = await getUserFromEvent(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not signed in" });
  }
  return user;
}

/** Gates the features reserved for Metabase's editor group (read/write
 * dashboards, plus Supabase Studio and Import Excel in the portal) -
 * separate from requireUser so a plain "am I signed in" check never pays
 * for the extra group-membership lookup. */
export async function requireEditor(event: H3Event): Promise<PortalUser> {
  const user = await requireUser(event);
  if (!(await isMetabaseEditor(user.id))) {
    throw createError({ statusCode: 403, statusMessage: "Editor access required" });
  }
  return user;
}

/** Gates the registration-approval dashboard - a Metabase superuser, not
 * just an editor, since approving an account and handing it group
 * membership is more sensitive than ordinary read/write dashboard access. */
export async function requireAdmin(event: H3Event): Promise<PortalUser> {
  const user = await requireUser(event);
  if (!user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Admin access required" });
  }
  return user;
}
