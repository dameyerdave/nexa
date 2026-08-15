/** Fixed-window failure-count limiter, shared by password login and 2FA
 * verification - both are exactly what a brute-force/credential-stuffing
 * attempt targets, and neither had any throttling before this (a real gap
 * found in review: a 6-digit TOTP code is only 1,000,000 combinations,
 * and nothing was stopping unlimited guesses against it). Blocks further
 * attempts for a key once it's failed too many times within the window,
 * resetting on success. Same in-memory, single-process, sweep-on-write
 * pattern as the rest of this codebase's caches (see
 * server/utils/import-cache.ts) - won't survive a restart or scale beyond
 * one portal replica, a known, already-documented limitation shared by
 * every cache here, not new. */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

const attempts = new Map<string, Entry>();

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if ((entry.blockedUntil ?? entry.windowStart + WINDOW_MS) < now) attempts.delete(key);
  }
}

/** Throws (429) if `key` is currently locked out - call before attempting
 * the real check (password/TOTP), not after. */
export function checkRateLimit(key: string): void {
  sweep();
  const entry = attempts.get(key.toLowerCase());
  if (entry?.blockedUntil && entry.blockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.blockedUntil - Date.now()) / 60_000);
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed attempts - try again in ${minutes} minute${minutes === 1 ? "" : "s"}`,
    });
  }
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const normalized = key.toLowerCase();
  const entry = attempts.get(normalized);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(normalized, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + WINDOW_MS;
}

export function recordSuccess(key: string): void {
  attempts.delete(key.toLowerCase());
}
