import { randomBytes, createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Nexdata";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpEnrollmentUri(email: string, base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  return totp.toString();
}

export function totpQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

/** window: 1 tolerates the code from one step before/after now (~30s each
 * way), covering ordinary clock drift between the server and an
 * authenticator app without meaningfully widening the guessable window. */
export function verifyTotpCode(base32Secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(base32Secret) });
  return totp.validate({ token: code.trim(), window: 1 }) !== null;
}

/** Recovery codes are high-entropy random tokens, not user-chosen
 * passwords, so a plain fast hash (not bcrypt/scrypt) is fine here -
 * there's no low-entropy secret to protect against offline brute-forcing. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}
