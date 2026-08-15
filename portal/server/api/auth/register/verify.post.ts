export default defineEventHandler(async (event) => {
  const body = await readBody<{ registrationId?: number; code?: string }>(event);
  const registrationId = body?.registrationId;
  const code = body?.code?.trim();
  if (!registrationId || !code) {
    throw createError({ statusCode: 400, statusMessage: "registrationId and code are required" });
  }

  const registration = await getRegistration(registrationId);
  if (!registration || registration.status !== "pending") {
    throw createError({ statusCode: 404, statusMessage: "This registration no longer exists - sign up again" });
  }
  if (registration.totp_enrolled) {
    throw createError({ statusCode: 400, statusMessage: "Two-factor authentication is already confirmed" });
  }
  checkRateLimit(registration.email);
  if (!registration.totp_secret || !verifyTotpCode(registration.totp_secret, code)) {
    recordFailure(registration.email);
    throw createError({
      statusCode: 401,
      statusMessage: "Incorrect code - check your authenticator app and try again",
    });
  }
  recordSuccess(registration.email);

  const recoveryCodes = generateRecoveryCodes();
  await commitRegistrationTotp(registrationId, recoveryCodes.map(hashRecoveryCode));
  await auditEvent("REGISTRATION_2FA_CONFIRMED", registration.email);

  return { status: "ok" as const, recoveryCodes };
});
