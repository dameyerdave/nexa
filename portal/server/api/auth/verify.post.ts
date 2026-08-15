export default defineEventHandler(async (event) => {
  const body = await readBody<{ loginId?: string; code?: string; recoveryCode?: string }>(event);
  const loginId = body?.loginId;
  if (!loginId) {
    throw createError({ statusCode: 400, statusMessage: "loginId is required" });
  }

  const pending = getPendingLogin(loginId);
  if (!pending) {
    throw createError({ statusCode: 404, statusMessage: "This sign-in has expired - start again" });
  }

  let recoveryCodes: string[] | undefined;
  const ip = getRequestIP(event, { xForwardedFor: true });

  if (body?.recoveryCode) {
    const ok = await redeemRecoveryCode(pending.userId, body.recoveryCode);
    if (!ok) {
      await auditEvent("LOGIN_2FA_FAILURE", pending.email, { method: "recovery_code", ip });
      throw createError({ statusCode: 401, statusMessage: "Invalid or already-used recovery code" });
    }
    await auditEvent("LOGIN_RECOVERY_CODE_USED", pending.email, { ip });
  } else {
    const code = body?.code?.trim();
    if (!code) {
      throw createError({ statusCode: 400, statusMessage: "code is required" });
    }

    if (pending.pendingTotpSecret) {
      // First-time enrollment - the QR code isn't committed to storage
      // until proven scannable, so a bad scan can't lock the user out.
      if (!verifyTotpCode(pending.pendingTotpSecret, code)) {
        await auditEvent("LOGIN_2FA_ENROLL_FAILURE", pending.email, { ip });
        throw createError({
          statusCode: 401,
          statusMessage: "Incorrect code - check your authenticator app and try again",
        });
      }
      recoveryCodes = generateRecoveryCodes();
      await commitTotpEnrollment(pending.userId, pending.email, pending.pendingTotpSecret, recoveryCodes);
      await auditEvent("LOGIN_2FA_ENROLLED", pending.email, { ip });
    } else {
      const secret = await getTotpSecret(pending.userId);
      if (!secret || !verifyTotpCode(secret, code)) {
        await auditEvent("LOGIN_2FA_FAILURE", pending.email, { method: "totp", ip });
        throw createError({ statusCode: 401, statusMessage: "Incorrect code" });
      }
    }
  }

  for (const cookie of pending.setCookies) {
    appendResponseHeader(event, "set-cookie", cookie);
  }
  deletePendingLogin(loginId);
  await auditEvent("LOGIN_SUCCESS", pending.email, { ip });

  return { status: "ok" as const, recoveryCodes };
});
