export default defineEventHandler(async (event) => {
  await requireUser(event);

  const id = getRouterParam(event, "id")!;
  const pending = getPendingImport(id);
  if (!pending?.keyColumn) {
    throw createError({ statusCode: 404, statusMessage: "This import has expired - upload the file again" });
  }
  const keyColumn = pending.keyColumn;
  const keyIndex = pending.columnNames.indexOf(keyColumn);

  const body = await readBody<{ overwriteKeys?: string[]; overwriteAll?: boolean }>(event);
  const overwriteAll = body?.overwriteAll === true;
  const overwriteKeys = new Set((body?.overwriteKeys ?? []).map(String));

  const existingKeys = new Set((await restSelectColumn(pending.tableName, keyColumn)).map(String));

  // Rows to actually submit: every non-duplicate row, plus duplicates the
  // caller chose to overwrite. Keyed by the row's key value so that if the
  // workbook itself repeats a key, the last matching row wins rather than
  // sending PostgREST two rows that conflict with each other in one batch.
  const toSubmit = new Map<string, (typeof pending.rows)[number]>();
  let skippedCount = 0;
  for (const row of pending.rows) {
    const key = String(row[keyIndex]);
    const isDuplicate = existingKeys.has(key);
    if (isDuplicate && !overwriteAll && !overwriteKeys.has(key)) {
      skippedCount++;
      continue;
    }
    toSubmit.set(key, row);
  }

  const records = [...toSubmit.values()].map((row) =>
    Object.fromEntries(pending.columnNames.map((name, i) => [name, row[i]])),
  );
  if (records.length > 0) {
    await restInsert(pending.tableName, records, { onConflict: keyColumn });
  }

  deletePendingImport(id);
  return { status: "appended", table: pending.tableName, upsertedCount: records.length, skippedCount };
});
