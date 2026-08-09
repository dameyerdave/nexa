/** Resolves a Metabase session token to an email, for stamping onto
 * Studio's proxied requests (see studio-proxy.ts) - short-TTL cached so
 * Studio's rapid-fire clicking around doesn't turn into a Metabase
 * /api/user/current call on every single request. Same in-memory,
 * single-process, sweep-on-write pattern as import-cache.ts /
 * pending-login-cache.ts. */

const TTL_MS = 60 * 1000;

interface CacheEntry {
  email: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(token);
  }
}

export async function resolveEmailForSession(token: string): Promise<string | null> {
  sweep();
  const cached = cache.get(token);
  if (cached) return cached.email;

  const user = await metabaseUserFromSession(token);
  const email = user?.email ?? null;
  cache.set(token, { email, expiresAt: Date.now() + TTL_MS });
  return email;
}
