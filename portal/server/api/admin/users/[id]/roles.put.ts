export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const id = getRouterParam(event, "id");
  const body = await readBody<{ roles?: string[] }>(event);
  const roles = (body.roles ?? []).filter((r) => ALLOWED_ROLES.includes(r));

  const config = useRuntimeConfig();
  const updated = await $fetch<{ id: string; email: string; app_metadata?: { roles?: string[] } }>(
    `${config.public.supabaseUrl}/auth/v1/admin/users/${id}`,
    {
      method: "PUT",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      body: { app_metadata: { roles } },
    },
  );

  try {
    await syncMetabaseDashboardAdmin(updated.email, roles.includes("dashboardadmin"));
  } catch (err) {
    console.error(`Metabase group sync failed for ${updated.email}:`, err);
  }

  return { id: updated.id, email: updated.email, roles };
});
