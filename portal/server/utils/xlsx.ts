import type ExcelJS from "exceljs";

export type CellValue = string | number | boolean | Date | null;

export function cellToValue(cell: ExcelJS.Cell): CellValue {
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

/** Infers a Postgres type per column in a single pass over every row
 * (rather than re-scanning the full row set once per column) - a column
 * is only as specific as every one of its non-blank values agrees on;
 * any disagreement, or no values at all, falls back to `text`. */
export function inferColumnTypes(rows: CellValue[][], columnCount: number): string[] {
  const hasValue = new Array<boolean>(columnCount).fill(false);
  const allDate = new Array<boolean>(columnCount).fill(true);
  const allBoolean = new Array<boolean>(columnCount).fill(true);
  const allNumber = new Array<boolean>(columnCount).fill(true);

  for (const row of rows) {
    for (let i = 0; i < columnCount; i++) {
      const v = row[i];
      if (v === null || v === "") continue;
      hasValue[i] = true;
      if (!(v instanceof Date)) allDate[i] = false;
      if (typeof v !== "boolean") allBoolean[i] = false;
      if (!(typeof v === "number" && Number.isFinite(v))) allNumber[i] = false;
    }
  }

  return Array.from({ length: columnCount }, (_, i) => {
    if (!hasValue[i]) return "text";
    if (allDate[i]) return "timestamptz";
    if (allBoolean[i]) return "boolean";
    if (allNumber[i]) return "double precision";
    return "text";
  });
}
