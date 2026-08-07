import type { H3Event } from "h3";

export interface PortalUser {
  id: string;
  email: string;
  roles: string[];
  isAdmin: boolean;
}

/**
 * Verifies the caller's Supabase access token by asking GoTrue itself
 * (the source of truth for token validity/expiry/rotation) rather than
 * re-implementing JWT verification here, then looks up their portal roles
 * from roles-api - Supabase Auth owns identity, roles-api owns authorization.
 */
export async function getUserFromEvent(event: H3Event): Promise<PortalUser | null> {
  const authHeader = getHeader(event, "authorization");
  const token = authHeader?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;

  const config = useRuntimeConfig();
  let supabaseUser: { id: string; email: string };
  try {
    supabaseUser = await $fetch<{ id: string; email: string }>(`${config.public.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.public.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return null;
  }

  const portalRoles = await fetchPortalUser(supabaseUser.email);
  const roles: string[] = [];
  if (portalRoles.dbadmin) roles.push("dbadmin");
  if (portalRoles.dashboardadmin) roles.push("dashboardadmin");

  return { id: supabaseUser.id, email: supabaseUser.email, roles, isAdmin: portalRoles.is_admin };
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
  if (!user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Admin access required" });
  }
  return user;
}

export async function requireDbAdmin(event: H3Event): Promise<PortalUser> {
  const user = await requireUser(event);
  if (!user.isAdmin && !user.roles.includes("dbadmin")) {
    throw createError({ statusCode: 403, statusMessage: "dbadmin role required" });
  }
  return user;
}
