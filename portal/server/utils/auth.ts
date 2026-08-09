import type { H3Event } from "h3";

export interface PortalUser {
  id: string;
  email: string;
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
    const supabaseUser = await $fetch<{ id: string; email: string }>(`${config.public.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.public.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
    return { id: supabaseUser.id, email: supabaseUser.email };
  } catch {
    return null;
  }
}

export async function requireUser(event: H3Event): Promise<PortalUser> {
  const user = await getUserFromEvent(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not signed in" });
  }
  return user;
}
