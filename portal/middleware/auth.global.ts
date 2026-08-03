export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  const { session, ready, init } = useAuth();
  if (!ready.value) {
    await init();
  }

  const isAuthRoute = to.path === "/login" || to.path.startsWith("/auth/");

  if (!session.value && !isAuthRoute) {
    return navigateTo("/login");
  }

  if (session.value && to.path === "/login") {
    return navigateTo("/");
  }
});
