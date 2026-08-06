export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  if (!user.roles.includes("dbadmin") && !user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "dbadmin role required" });
  }

  const config = useRuntimeConfig();
  const credential = await fetchStudioCredential();
  const url = new URL(config.public.supabaseUrl);
  url.username = encodeURIComponent(credential.username);
  url.password = encodeURIComponent(credential.password);
  return { url: url.toString() };
});
