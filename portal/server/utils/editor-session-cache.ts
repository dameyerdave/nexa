/** Whether a Metabase session belongs to an editor - cached like
 * user-email-cache.ts's email lookups, since checking group membership
 * makes two Metabase admin API calls (isMetabaseEditor) and Studio's shell
 * (see studio-proxy.ts's proxyStudioShellRequest) can fire dozens of these
 * per page load for its own JS/CSS/asset requests. Also de-duplicates
 * concurrent lookups for the same not-yet-cached token - confirmed live
 * that without this, a burst of parallel requests on first page load
 * (before anything is cached) fires that many redundant lookups at once,
 * which was enough to cause real, intermittent failures. */

const TTL_MS = 60 * 1000;

interface CacheEntry {
  isEditor: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<boolean>>();

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(token);
  }
}

export async function resolveIsEditorForSession(token: string): Promise<boolean> {
  sweep();
  const cached = cache.get(token);
  if (cached) return cached.isEditor;

  const inFlight = pending.get(token);
  if (inFlight) return inFlight;

  const lookup = (async () => {
    const user = await metabaseUserFromSession(token);
    const isEditor = user ? await isMetabaseEditor(user.userId) : false;
    cache.set(token, { isEditor, expiresAt: Date.now() + TTL_MS });
    return isEditor;
  })();
  pending.set(token, lookup);

  try {
    return await lookup;
  } finally {
    pending.delete(token);
  }
}
