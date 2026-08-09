const OPERATIONS = ["INSERT", "UPDATE", "DELETE"];
const MAX_LIMIT = 200;

interface AuditRow {
  id: number;
  table_name: string;
  operation: string;
  old_data: unknown;
  new_data: unknown;
  changed_by: string;
  changed_at: string;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const q = getQuery(event);

  const table = typeof q.table === "string" && q.table.trim() ? q.table.trim() : undefined;
  const operations = (typeof q.operation === "string" ? q.operation.split(",") : []).filter((op) =>
    OPERATIONS.includes(op),
  );
  const actor = typeof q.actor === "string" && q.actor.trim() ? q.actor.trim() : undefined;
  const from = typeof q.from === "string" && q.from.trim() ? q.from.trim() : undefined;
  const to = typeof q.to === "string" && q.to.trim() ? q.to.trim() : undefined;
  const search = typeof q.search === "string" && q.search.trim() ? q.search.trim() : undefined;
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(q.offset) || 0, 0);

  // Every value below is percent-encoded before being spliced into the
  // querystring - restSelectWithCount does no escaping of its own.
  const filters: string[] = [];
  if (table) filters.push(`table_name=eq.${encodeURIComponent(table)}`);
  if (operations.length) filters.push(`operation=in.(${operations.join(",")})`); // enum-whitelisted above
  if (actor) filters.push(`changed_by=ilike.*${encodeURIComponent(actor)}*`);
  if (from) filters.push(`changed_at=gte.${encodeURIComponent(from)}`);
  if (to) filters.push(`changed_at=lte.${encodeURIComponent(to)}`);
  if (search) {
    // PostgREST's `or=(...)` combinator, searching both the before/after
    // row data cast to text - no native "search this jsonb column" filter,
    // so this is the closest to free-text without raw SQL.
    const term = encodeURIComponent(`*${search}*`);
    filters.push(`or=(old_data::text.ilike.${term},new_data::text.ilike.${term})`);
  }
  filters.push("order=changed_at.desc");
  filters.push(`limit=${limit}`);
  filters.push(`offset=${offset}`);

  const { rows, total } = await restSelectWithCount<AuditRow>("audit_log", filters.join("&"));
  return { rows, total, limit, offset };
});
