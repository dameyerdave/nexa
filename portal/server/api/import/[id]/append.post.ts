export default defineEventHandler(async (event) => {
  await requireUser(event);

  const id = getRouterParam(event, "id")!;
  const pending = getPendingImport(id);
  if (!pending) {
    throw createError({ statusCode: 404, statusMessage: "This import has expired - upload the file again" });
  }

  const body = await readBody<{ keyColumn?: string }>(event);
  const keyColumn = body?.keyColumn;
  if (!keyColumn || !pending.columnNames.includes(keyColumn)) {
    throw createError({ statusCode: 400, statusMessage: "keyColumn must be one of the uploaded workbook's columns" });
  }

  // Requires every existing value in this column to already be unique -
  // ensureUniqueConstraint surfaces a clear error via pgMetaQuery if not,
  // rather than silently treating everything as a fresh row.
  await ensureUniqueConstraint("public", pending.tableName, keyColumn);

  const existingKeys = new Set((await restSelectColumn(pending.tableName, keyColumn)).map(String));
  const keyIndex = pending.columnNames.indexOf(keyColumn);

  const duplicateKeys = new Set<string>();
  let newCount = 0;
  for (const row of pending.rows) {
    const key = String(row[keyIndex]);
    if (existingKeys.has(key)) duplicateKeys.add(key);
    else newCount++;
  }

  updatePendingImport(id, { keyColumn });
  return { status: "needs-resolution", importId: id, keyColumn, newCount, duplicateKeys: [...duplicateKeys] };
});
