interface GoTrueUser {
  id: string;
  email: string;
  app_metadata?: { roles?: string[] };
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const config = useRuntimeConfig();
  const res = await $fetch<{ users: GoTrueUser[] }>(`${config.public.supabaseUrl}/auth/v1/admin/users`, {
    query: { per_page: 200 },
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
  });

  return res.users
    .map((u) => ({ id: u.id, email: u.email, roles: u.app_metadata?.roles ?? [] }))
    .sort((a, b) => a.email.localeCompare(b.email));
});
