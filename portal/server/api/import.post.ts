import ExcelJS from "exceljs";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB - a soft cap on the buffered file, not a streaming limit

export default defineEventHandler(async (event) => {
  await requireUser(event);

  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.filename);
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: "No file uploaded" });
  }
  if (filePart.data.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `File too large - max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` });
  }
  const requestedName = parts?.find((p) => p.name === "tableName")?.data.toString("utf-8").trim();

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(filePart.data);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Could not read that file - is it a valid .xlsx workbook?" });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "The workbook needs a header row plus at least one data row",
    });
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cell.value ? String(cell.value) : `column_${colNumber}`;
  });

  const rows: ReturnType<typeof cellToValue>[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values = headers.map((_, i) => cellToValue(row.getCell(i + 1)));
    if (values.every((v) => v === null)) continue; // skip fully-blank rows
    rows.push(values);
  }
  if (rows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No data rows found below the header" });
  }

  const columnNames = slugifyUnique(headers);
  const columnTypes = inferColumnTypes(rows, columnNames.length);
  const columns = columnNames.map((name, i) => ({ name, sqlType: columnTypes[i] }));

  const baseName = requestedName || filePart.filename!.replace(/\.[^.]+$/, "");
  const tableName = slugify(baseName, "import");

  await createTable("public", tableName, columns);

  const records = rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]])));
  await restInsert(tableName, records);

  return { table: tableName, columns: columnNames, rowCount: rows.length };
});
