export default defineEventHandler(async (event) => {
  await requireUser(event);

  const id = getRouterParam(event, "id")!;
  const pending = getPendingImport(id);
  if (!pending) {
    throw createError({ statusCode: 404, statusMessage: "This import has expired - upload the file again" });
  }

  const columnTypes = inferColumnTypes(pending.rows, pending.columnNames.length);
  const columns = pending.columnNames.map((name, i) => ({ name, sqlType: columnTypes[i] }));

  await dropTable("public", pending.tableName);
  await createTable("public", pending.tableName, columns);
  const records = pending.rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]])));
  await restInsert(pending.tableName, records);

  deletePendingImport(id);
  return { status: "replaced", table: pending.tableName, columns: pending.columnNames, rowCount: pending.rows.length };
});
