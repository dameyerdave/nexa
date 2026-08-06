export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const id = getRouterParam(event, "id");
  const body = await readBody<{ roles?: string[] }>(event);
  const roles = body.roles ?? [];

  const config = useRuntimeConfig();
  const gotrueUser = await $fetch<{ id: string; email: string }>(
    `${config.public.supabaseUrl}/auth/v1/admin/users/${id}`,
    {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    },
  );

  const updated = await updatePortalUserRoles(gotrueUser.email, {
    dbadmin: roles.includes("dbadmin"),
    dashboardadmin: roles.includes("dashboardadmin"),
  });

  try {
    await syncMetabaseDashboardAdmin(updated.email, updated.dashboardadmin);
  } catch (err) {
    console.error(`Metabase group sync failed for ${updated.email}:`, err);
  }

  return {
    id: gotrueUser.id,
    email: updated.email,
    roles: [...(updated.dbadmin ? ["dbadmin"] : []), ...(updated.dashboardadmin ? ["dashboardadmin"] : [])],
  };
});
