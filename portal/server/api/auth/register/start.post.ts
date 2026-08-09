const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }>(event);

  const email = body?.email?.trim().toLowerCase();
  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  const password = body?.password;

  if (!email || !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: "A valid email address is required" });
  }
  if (!firstName || !lastName) {
    throw createError({ statusCode: 400, statusMessage: "First and last name are required" });
  }
  if (!password || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: "Password must be at least 8 characters" });
  }

  if (await findActiveRegistrationByEmail(email)) {
    throw createError({
      statusCode: 409,
      statusMessage: "An account with this email is already registered or awaiting approval",
    });
  }

  const passwordEnc = encryptSecret(password);
  const totpSecret = generateTotpSecret();
  const registration = await createRegistration({ email, firstName, lastName, passwordEnc, totpSecret });

  const qr = await totpQrCodeDataUrl(totpEnrollmentUri(email, totpSecret));
  return { registrationId: registration.id, qr, secret: totpSecret };
});
