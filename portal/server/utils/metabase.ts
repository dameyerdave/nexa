const DASHBOARD_ADMINS_GROUP = "Dashboard Admins";

async function metabaseSession(): Promise<string> {
  const config = useRuntimeConfig();
  const res = await $fetch<{ id: string }>(`${config.public.dataAnalyticsUrl}/api/session`, {
    method: "POST",
    body: { username: config.metabaseAdminEmail, password: config.metabaseAdminPassword },
  });
  return res.id;
}

async function mb<T>(sessionId: string, method: string, path: string, body?: unknown): Promise<T> {
  const config = useRuntimeConfig();
  return $fetch<T>(`${config.public.dataAnalyticsUrl}${path}`, {
    method: method as "GET",
    headers: { "X-Metabase-Session": sessionId },
    body,
  });
}

async function ensureDashboardAdminsGroupId(sessionId: string): Promise<number> {
  const groups = await mb<Array<{ id: number; name: string }>>(sessionId, "GET", "/api/permissions/group");
  const existing = groups.find((g) => g.name === DASHBOARD_ADMINS_GROUP);
  if (existing) return existing.id;
  const created = await mb<{ id: number }>(sessionId, "POST", "/api/permissions/group", {
    name: DASHBOARD_ADMINS_GROUP,
  });
  return created.id;
}

/**
 * Adds or removes a Metabase user from the "Dashboard Admins" group so its
 * collection-permission grants (see scripts/setup_metabase_permissions.py)
 * take effect. Silently does nothing if the user hasn't signed into
 * Metabase yet (no Metabase account exists for their email until they do,
 * e.g. via Google Sign-In auto-provisioning).
 */
export async function syncMetabaseDashboardAdmin(email: string, shouldBeMember: boolean): Promise<void> {
  const sessionId = await metabaseSession();
  const groupId = await ensureDashboardAdminsGroupId(sessionId);

  const users = await mb<{ data: Array<{ id: number; email: string }> }>(
    sessionId,
    "GET",
    `/api/user?query=${encodeURIComponent(email)}`,
  );
  const mbUser = users.data.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!mbUser) return;

  const memberships = await mb<Record<string, Array<{ membership_id: number; group_id: number }>>>(
    sessionId,
    "GET",
    "/api/permissions/membership",
  );
  const userMemberships = memberships[String(mbUser.id)] ?? [];
  const current = userMemberships.find((m) => m.group_id === groupId);

  if (shouldBeMember && !current) {
    await mb(sessionId, "POST", "/api/permissions/membership", { group_id: groupId, user_id: mbUser.id });
  } else if (!shouldBeMember && current) {
    await mb(sessionId, "DELETE", `/api/permissions/membership/${current.membership_id}`);
  }
}
