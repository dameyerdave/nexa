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
  // Free-text search across old/new row data goes through the
  // search_audit_log() RPC (see audit-store.ts) rather than a PostgREST
  // URL filter - PostgREST can't cast jsonb to text for ilike in a filter
  // (confirmed live: "operator does not exist: jsonb ~~* unknown"), but it
  // does support layering ordinary column filters/order/limit on top of a
  // function that returns setof audit_log, so everything else below still
  // applies unchanged.
  if (search) filters.push(`term=${encodeURIComponent(search)}`);
  filters.push("order=changed_at.desc");
  filters.push(`limit=${limit}`);
  filters.push(`offset=${offset}`);

  const endpoint = search ? "rpc/search_audit_log" : "audit_log";
  const { rows, total } = await restSelectWithCount<AuditRow>(endpoint, filters.join("&"));
  return { rows, total, limit, offset };
});
