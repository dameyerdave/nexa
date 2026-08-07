export default defineEventHandler(async (event) => {
  await requireDbAdmin(event);

  const config = useRuntimeConfig();
  const credential = await fetchStudioCredential();
  const url = new URL(config.public.supabaseUrl);
  url.username = encodeURIComponent(credential.username);
  url.password = encodeURIComponent(credential.password);
  return { url: url.toString() };
});
