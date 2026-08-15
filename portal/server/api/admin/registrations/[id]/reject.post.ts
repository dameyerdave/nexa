export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event);

  const id = Number(getRouterParam(event, "id"));
  const registration = await getRegistration(id);
  if (!registration || registration.status !== "pending") {
    throw createError({ statusCode: 404, statusMessage: "This registration is no longer pending" });
  }

  await decideRegistration(id, "rejected", admin.email);
  await auditEvent("REGISTRATION_REJECTED", admin.email, { email: registration.email });
  return { status: "rejected" as const };
});
