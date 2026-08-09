import { randomUUID } from "node:crypto";

/** Holds a login between "password verified against Metabase" and "2FA
 * code verified" - the browser doesn't get Metabase's session cookie
 * until both steps pass, so a stolen/guessed password alone is never
 * enough. Same in-memory, single-process, short-TTL pattern as
 * import-cache.ts, applied to a login instead of a data import. */
export interface PendingLogin {
  userId: number;
  email: string;
  setCookies: string[];
  /** Set only while a first-time enrollment's QR code is on screen but not
   * yet confirmed with a real code - never persisted until confirmed. */
  pendingTotpSecret?: string;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000; // a login should complete quickly
const cache = new Map<string, PendingLogin>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of cache) {
    if (entry.createdAt < cutoff) cache.delete(id);
  }
}

export function savePendingLogin(data: Omit<PendingLogin, "createdAt">): string {
  sweep();
  const id = randomUUID();
  cache.set(id, { ...data, createdAt: Date.now() });
  return id;
}

export function getPendingLogin(id: string): PendingLogin | undefined {
  sweep();
  return cache.get(id);
}

export function updatePendingLogin(id: string, patch: Partial<PendingLogin>): void {
  const entry = cache.get(id);
  if (entry) cache.set(id, { ...entry, ...patch });
}

export function deletePendingLogin(id: string): void {
  cache.delete(id);
}
