export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  const { user, ready, init } = useAuth();
  if (!ready.value) {
    await init();
  }

  const publicPaths = ["/login", "/register"];
  if (!user.value && !publicPaths.includes(to.path)) {
    return navigateTo("/login");
  }

  if (user.value && publicPaths.includes(to.path)) {
    return navigateTo("/");
  }
});
