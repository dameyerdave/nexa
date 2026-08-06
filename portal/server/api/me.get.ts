export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  return { email: user.email, roles: user.roles, isAdmin: user.isAdmin };
});
