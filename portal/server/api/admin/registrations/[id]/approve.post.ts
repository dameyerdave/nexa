export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event);

  const id = Number(getRouterParam(event, "id"));
  const body = await readBody<{ groupIds?: number[] }>(event);
  const groupIds = Array.isArray(body?.groupIds) ? body.groupIds.filter((n) => Number.isInteger(n)) : [];

  const registration = await getRegistration(id);
  if (!registration || registration.status !== "pending") {
    throw createError({ statusCode: 404, statusMessage: "This registration is no longer pending" });
  }
  if (!registration.totp_enrolled) {
    throw createError({
      statusCode: 400,
      statusMessage: "This user hasn't finished setting up two-factor authentication yet",
    });
  }

  const password = decryptSecret(registration.password_enc);
  const userId = await createMetabaseUser({
    email: registration.email,
    firstName: registration.first_name,
    lastName: registration.last_name,
    password,
    groupIds,
  });

  await commitTotpEnrollmentHashed(
    userId,
    registration.email,
    registration.totp_secret!,
    registration.recovery_code_hashes,
  );

  await decideRegistration(id, "approved", admin.email);

  return { status: "approved" as const, userId };
});
