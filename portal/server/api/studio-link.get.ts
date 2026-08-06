export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  if (!user.roles.includes("dbadmin") && !isAdmin(user)) {
    throw createError({ statusCode: 403, statusMessage: "dbadmin role required" });
  }

  const config = useRuntimeConfig();
  const url = new URL(config.public.supabaseUrl);
  url.username = encodeURIComponent(config.dashboardUsername);
  url.password = encodeURIComponent(config.dashboardPassword);
  return { url: url.toString() };
});
