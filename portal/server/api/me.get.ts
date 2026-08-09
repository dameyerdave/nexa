export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const isEditor = await isMetabaseEditor(user.id);
  return { email: user.email, isEditor };
});
