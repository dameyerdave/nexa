export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event);
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: "Username and password are required" });
  }

  const result = await metabaseLogin(username, password);
  if (!result) {
    throw createError({ statusCode: 401, statusMessage: "Incorrect username or password" });
  }

  const enrolled = await hasTotpEnrolled(result.userId);
  const loginId = savePendingLogin({ userId: result.userId, email: result.email, setCookies: result.setCookies });

  if (enrolled) {
    return { status: "verify" as const, loginId };
  }

  // First time this user has ever signed in through the portal - enroll
  // 2FA now, before their session is usable for anything.
  const secret = generateTotpSecret();
  updatePendingLogin(loginId, { pendingTotpSecret: secret });
  const qr = await totpQrCodeDataUrl(totpEnrollmentUri(result.email, secret));
  return { status: "enroll" as const, loginId, qr, secret };
});
