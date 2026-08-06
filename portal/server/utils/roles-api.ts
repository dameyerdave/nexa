export interface PortalUserRoles {
  email: string;
  is_admin: boolean;
  dbadmin: boolean;
  dashboardadmin: boolean;
}

function rolesApiHeaders(): Record<string, string> {
  const config = useRuntimeConfig();
  return { Authorization: `Bearer ${config.rolesApiToken}` };
}

/** Looks up (and lazily creates, defaulted to no roles) a user's role row. */
export async function fetchPortalUser(email: string): Promise<PortalUserRoles> {
  const config = useRuntimeConfig();
  return $fetch<PortalUserRoles>(`${config.rolesApiUrl}/api/portal-users/${encodeURIComponent(email.toLowerCase())}/`, {
    headers: rolesApiHeaders(),
  });
}

export async function listPortalUsers(): Promise<PortalUserRoles[]> {
  const config = useRuntimeConfig();
  return $fetch<PortalUserRoles[]>(`${config.rolesApiUrl}/api/portal-users/`, {
    headers: rolesApiHeaders(),
  });
}

export async function updatePortalUserRoles(
  email: string,
  roles: { dbadmin: boolean; dashboardadmin: boolean },
): Promise<PortalUserRoles> {
  const config = useRuntimeConfig();
  return $fetch<PortalUserRoles>(`${config.rolesApiUrl}/api/portal-users/${encodeURIComponent(email.toLowerCase())}/`, {
    method: "PATCH",
    headers: rolesApiHeaders(),
    body: roles,
  });
}

export async function fetchStudioCredential(): Promise<{ username: string; password: string }> {
  const config = useRuntimeConfig();
  return $fetch<{ username: string; password: string }>(`${config.rolesApiUrl}/api/studio-credential/`, {
    headers: rolesApiHeaders(),
  });
}
