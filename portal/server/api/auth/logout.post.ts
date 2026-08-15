export default defineEventHandler(async (event) => {
  const token = getCookie(event, METABASE_COOKIE);
  if (token) {
    // Resolved before invalidating the session below, not after.
    const user = await metabaseUserFromSession(token);
    await metabaseLogout(token);
    if (user) await auditEvent("LOGOUT", user.email, { ip: getRequestIP(event, { xForwardedFor: true }) });
  }
  deleteCookie(event, METABASE_COOKIE);
  return { status: "ok" as const };
});
