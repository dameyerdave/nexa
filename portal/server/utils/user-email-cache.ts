/** Resolves a Metabase session token to an email, for stamping onto
 * Studio's proxied requests (see studio-proxy.ts) - short-TTL cached so
 * Studio's rapid-fire clicking around doesn't turn into a Metabase
 * /api/user/current call on every single request. Same in-memory,
 * single-process, sweep-on-write pattern as import-cache.ts /
 * pending-login-cache.ts. Also de-duplicates concurrent lookups for the
 * same not-yet-cached token - see editor-session-cache.ts for why this
 * matters under a burst of parallel requests. */

const TTL_MS = 60 * 1000;

interface CacheEntry {
  email: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();

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

  const inFlight = pending.get(token);
  if (inFlight) return inFlight;

  const lookup = (async () => {
    const user = await metabaseUserFromSession(token);
    const email = user?.email ?? null;
    cache.set(token, { email, expiresAt: Date.now() + TTL_MS });
    return email;
  })();
  pending.set(token, lookup);

  try {
    return await lookup;
  } finally {
    pending.delete(token);
  }
}
