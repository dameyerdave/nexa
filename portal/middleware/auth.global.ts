export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  const { user, ready, init } = useAuth();
  if (!ready.value) {
    await init();
  }

  if (!user.value && to.path !== "/login") {
    return navigateTo("/login");
  }

  if (user.value && to.path === "/login") {
    return navigateTo("/");
  }
});
