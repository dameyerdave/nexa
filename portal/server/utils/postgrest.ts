function restHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const config = useRuntimeConfig();
  return { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, ...extra };
}

function restError(err: any): never {
  const detail = err?.data?.message || err?.data?.hint || err?.message || String(err);
  throw createError({ statusCode: 502, statusMessage: `PostgREST error: ${detail}` });
}

/** Bulk-inserts rows into a table via PostgREST, using the service-role
 * key to bypass RLS. Pass `onConflict` (a column with a UNIQUE constraint -
 * see pg-meta.ts's ensureUniqueConstraint) to upsert instead: rows whose
 * key already exists get merged into the existing row, everything else is
 * inserted - used for re-importing a workbook in "append" mode. */
export async function restInsert(
  table: string,
  records: Record<string, unknown>[],
  opts: { onConflict?: string } = {},
): Promise<void> {
  const config = useRuntimeConfig();
  const url = new URL(`${config.public.supabaseUrl}/rest/v1/${table}`);
  const headers = restHeaders({ Prefer: "return=minimal" });
  if (opts.onConflict) {
    url.searchParams.set("on_conflict", opts.onConflict);
    headers.Prefer = "resolution=merge-duplicates,return=minimal";
  }
  try {
    await $fetch(url.toString(), { method: "POST", headers, body: records });
  } catch (err: any) {
    restError(err);
  }
}

/** Fetches every value currently stored in one column of a table - used
 * to detect which rows in a re-imported workbook already exist. Paginates
 * until an empty page comes back rather than trusting a fixed page size,
 * since PostgREST silently caps each response at PGRST_DB_MAX_ROWS (1000
 * by default) - a table with more existing rows than that would otherwise
 * make duplicate detection miss everything past the first page. */
export async function restSelectColumn(table: string, column: string): Promise<unknown[]> {
  const config = useRuntimeConfig();
  const values: unknown[] = [];
  let offset = 0;
  for (;;) {
    let page: Record<string, unknown>[];
    try {
      page = await $fetch<Record<string, unknown>[]>(
        `${config.public.supabaseUrl}/rest/v1/${table}?select=${column}&offset=${offset}`,
        { headers: restHeaders() },
      );
    } catch (err: any) {
      restError(err);
    }
    if (page.length === 0) break;
    values.push(...page.map((r) => r[column]));
    offset += page.length;
  }
  return values;
}

/** Runs an arbitrary PostgREST GET, e.g. restSelect("t", "id=eq.1&limit=1") -
 * `query` is a raw querystring, not user input in current callers (always
 * built from server-controlled ids), so no escaping is done here. */
export async function restSelect<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  try {
    return await $fetch<T[]>(`${useRuntimeConfig().public.supabaseUrl}/rest/v1/${table}?${query}`, {
      headers: restHeaders(),
    });
  } catch (err: any) {
    restError(err);
  }
}

export async function restUpdate(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await $fetch(`${useRuntimeConfig().public.supabaseUrl}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: patch,
    });
  } catch (err: any) {
    restError(err);
  }
}

export async function restDelete(table: string, query: string): Promise<void> {
  try {
    await $fetch(`${useRuntimeConfig().public.supabaseUrl}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: restHeaders({ Prefer: "return=minimal" }),
    });
  } catch (err: any) {
    restError(err);
  }
}
