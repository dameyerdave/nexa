/** Whether a Metabase session belongs to an editor - cached like
 * user-email-cache.ts's email lookups, since checking group membership
 * makes two Metabase admin API calls (isMetabaseEditor) and Studio's shell
 * (see studio-proxy.ts's proxyStudioShellRequest) can fire dozens of these
 * per page load for its own JS/CSS/asset requests. */

const TTL_MS = 60 * 1000;

interface CacheEntry {
  isEditor: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

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

  const user = await metabaseUserFromSession(token);
  const isEditor = user ? await isMetabaseEditor(user.userId) : false;
  cache.set(token, { isEditor, expiresAt: Date.now() + TTL_MS });
  return isEditor;
}
