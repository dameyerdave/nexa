export default defineEventHandler(async (event) => {
  await requireUser(event);

  const config = useRuntimeConfig();
  const url = new URL(config.public.supabaseUrl);
  url.username = encodeURIComponent(config.dashboardUsername);
  url.password = encodeURIComponent(config.dashboardPassword);
  return { url: url.toString() };
});
