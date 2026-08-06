export function useApi() {
  const { session } = useAuth();

  function apiFetch<T>(url: string, opts: Record<string, unknown> = {}) {
    const headers = { ...(opts.headers as Record<string, string> | undefined) };
    if (session.value?.access_token) {
      headers.Authorization = `Bearer ${session.value.access_token}`;
    }
    return $fetch<T>(url, { ...opts, headers });
  }

  return { apiFetch };
}
