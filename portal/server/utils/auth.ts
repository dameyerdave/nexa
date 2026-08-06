import type { H3Event } from "h3";

export interface PortalUser {
  id: string;
  email: string;
  roles: string[];
}

const ALLOWED_ROLES = ["dbadmin", "dashboardadmin"];

function getRoles(appMetadata: Record<string, unknown> | undefined): string[] {
  const roles = appMetadata?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => ALLOWED_ROLES.includes(r)) : [];
}

function isAdminEmail(email: string): boolean {
  const config = useRuntimeConfig();
  const allowlist = config.portalAdminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

/**
 * Verifies the caller's Supabase access token by asking GoTrue itself
 * (the source of truth for token validity/expiry/rotation) rather than
 * re-implementing JWT verification here.
 */
export async function getUserFromEvent(event: H3Event): Promise<PortalUser | null> {
  const authHeader = getHeader(event, "authorization");
  const token = authHeader?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;

  const config = useRuntimeConfig();
  try {
    const user = await $fetch<{ id: string; email: string; app_metadata?: Record<string, unknown> }>(
      `${config.public.supabaseUrl}/auth/v1/user`,
      {
        headers: {
          apikey: config.public.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return { id: user.id, email: user.email, roles: getRoles(user.app_metadata) };
  } catch {
    return null;
  }
}

export function isAdmin(user: PortalUser): boolean {
  return isAdminEmail(user.email);
}

export async function requireUser(event: H3Event): Promise<PortalUser> {
  const user = await getUserFromEvent(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not signed in" });
  }
  return user;
}

export async function requireAdmin(event: H3Event): Promise<PortalUser> {
  const user = await requireUser(event);
  if (!isAdmin(user)) {
    throw createError({ statusCode: 403, statusMessage: "Admin access required" });
  }
  return user;
}

export { ALLOWED_ROLES };
