import ExcelJS from "exceljs";

interface ColumnDef {
  name: string;
  sqlType: string;
}

function cellToValue(cell: ExcelJS.Cell): string | number | boolean | Date | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text: string }>).map((r) => r.text).join("");
    }
    if ("result" in obj) {
      const r = obj.result;
      return r instanceof Date || typeof r === "number" || typeof r === "boolean" || typeof r === "string"
        ? r
        : String(r);
    }
    if ("text" in obj) return String(obj.text);
    return String(v);
  }
  return v as string | number | boolean;
}

function inferSqlType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";
  if (nonNull.every((v) => v instanceof Date)) return "timestamptz";
  if (nonNull.every((v) => typeof v === "boolean")) return "boolean";
  if (nonNull.every((v) => typeof v === "number" && Number.isFinite(v))) return "double precision";
  return "text";
}

export default defineEventHandler(async (event) => {
  await requireUser(event);

  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.filename);
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: "No file uploaded" });
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

  const rows: unknown[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const values = headers.map((_, i) => cellToValue(row.getCell(i + 1)));
    if (values.every((v) => v === null)) continue; // skip fully-blank rows
    rows.push(values);
  }
  if (rows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No data rows found below the header" });
  }

  const columnNames = slugifyUnique(headers);
  const columns: ColumnDef[] = columnNames.map((name, i) => ({
    name,
    sqlType: inferSqlType(rows.map((row) => row[i])),
  }));

  const baseName = requestedName || filePart.filename!.replace(/\.[^.]+$/, "");
  const tableName = slugify(baseName, "import");

  // No existence pre-check - `create table` (no IF NOT EXISTS) fails
  // loudly via pg-meta if the name is taken, which pgMetaQuery turns into
  // a clean error instead of a silent overwrite.
  const columnsSql = columns.map((c) => `"${c.name}" ${c.sqlType}`).join(", ");
  await pgMetaQuery(
    `create table "public"."${tableName}" (row_id bigint generated always as identity primary key, ${columnsSql}); ` +
      `grant select, insert, update, delete on "public"."${tableName}" to authenticated;`,
  );

  const config = useRuntimeConfig();
  const records = rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]])));
  await $fetch(`${config.public.supabaseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: records,
  });

  return { table: tableName, columns: columns.map((c) => c.name), rowCount: rows.length };
});
