export default defineEventHandler(async (event) => {
  const token = getCookie(event, METABASE_COOKIE);
  if (token) {
    await metabaseLogout(token);
  }
  deleteCookie(event, METABASE_COOKIE);
  return { status: "ok" as const };
});
