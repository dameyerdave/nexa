import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Symmetric encryption for the one secret the portal must round-trip in
 * plaintext: a self-registered user's chosen password, held only from
 * signup until an admin approves the account, at which point it's handed
 * to Metabase's own admin API to become that user's real Metabase
 * password (Metabase does its own hashing - a one-way hash stored here
 * would be useless for that handoff). The key is derived from the
 * existing service-role key (already a portal-only secret, never exposed
 * to the browser) via SHA-256, so this needs no secret of its own. */
function key(): Buffer {
  return createHash("sha256").update(useRuntimeConfig().serviceRoleKey).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
