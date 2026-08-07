export default defineEventHandler(async (event) => {
  await requireDbAdmin(event);

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: "invalid project id" });
  }

  return retryProjectMetabase(id);
});
