/** Turns arbitrary text (a filename, a spreadsheet header cell) into a
 * safe, unquoted-identifier-compatible Postgres name: lowercase,
 * [a-z0-9_] only, never starting with a digit, capped at Postgres's
 * 63-byte identifier limit. */
export function slugify(raw: string, fallback = "column"): string {
  let name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!name) name = fallback;
  if (/^[0-9]/.test(name)) name = `c_${name}`;
  return name.slice(0, 63);
}

/** Slugifies a list of names and appends _2, _3, ... to any that collide
 * after slugifying (e.g. two spreadsheet columns named "Name" and "name"). */
export function slugifyUnique(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    const base = slugify(raw, `column_${i + 1}`);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}
