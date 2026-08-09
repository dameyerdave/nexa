export interface CurrentUser {
  email: string;
  isEditor: boolean;
}

/** Auth state is entirely cookie-based now (Metabase's own session cookie,
 * set by server/api/auth/verify.post.ts) - there's no client-side token to
 * hold, just "does the browser currently have a valid one", answered by
 * asking the portal's own /api/me. The multi-step login itself (password,
 * then 2FA) is handled directly in pages/login.vue, not here - it's
 * page-specific flow state, not app-wide auth state. */
export function useAuth() {
  const user = useState<CurrentUser | null>("auth-user", () => null);
  const ready = useState<boolean>("auth-ready", () => false);

  async function refresh() {
    try {
      user.value = await $fetch<CurrentUser>("/api/me");
    } catch {
      user.value = null;
    }
  }

  async function init() {
    if (ready.value) return;
    await refresh();
    ready.value = true;
  }

  async function signOut() {
    await $fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    user.value = null;
  }

  return { user, ready, init, refresh, signOut };
}
