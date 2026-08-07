export default defineEventHandler(async (event) => {
  await requireDbAdmin(event);
  return listProjects();
});
