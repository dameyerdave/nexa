interface GoTrueUser {
  id: string;
  email: string;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const config = useRuntimeConfig();
  const [gotrue, portalUsers] = await Promise.all([
    $fetch<{ users: GoTrueUser[] }>(`${config.public.supabaseUrl}/auth/v1/admin/users`, {
      query: { per_page: 200 },
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    }),
    listPortalUsers(),
  ]);

  const rolesByEmail = new Map(portalUsers.map((u) => [u.email.toLowerCase(), u]));

  return gotrue.users
    .map((u) => {
      const roles = rolesByEmail.get(u.email.toLowerCase());
      return {
        id: u.id,
        email: u.email,
        roles: [...(roles?.dbadmin ? ["dbadmin"] : []), ...(roles?.dashboardadmin ? ["dashboardadmin"] : [])],
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
});
