export default defineEventHandler(async (event) => {
  const user = await requireDbAdmin(event);

  const body = await readBody<{ name?: string }>(event);
  const name = (body?.name || "").trim();
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "name is required" });
  }

  try {
    return await createProject(name, user.email);
  } catch (err: any) {
    // roles-api returns 409 with {detail} on a name/schema collision or a
    // Postgres connectivity failure - surface that message instead of a
    // generic 500.
    if (err?.statusCode === 409) {
      throw createError({ statusCode: 409, statusMessage: err.data?.detail || "Could not create project" });
    }
    throw err;
  }
});
