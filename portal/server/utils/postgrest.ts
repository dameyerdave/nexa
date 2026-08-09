/** Base URL for every PostgREST call below: the internal Docker network
 * address (http://rest:3000), not Kong's public /rest/v1 route - PostgREST's
 * own path structure has no /rest/v1 prefix, that's just Kong's route path,
 * stripped before forwarding. Calling it directly also avoids a pointless
 * hairpin through Kong -> the portal's own Studio proxy -> back to rest
 * (see server/utils/studio-proxy.ts) that going through Kong would cause. */
function restBaseUrl(): string {
  return useRuntimeConfig().restInternalUrl;
}

function restHeaders(extra: Record<string, string> = {}, actorEmail?: string): Record<string, string> {
  const config = useRuntimeConfig();
  const headers: Record<string, string> = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
  // Read by the pgrst_pre_request hook (volumes/db/audit.sql) into a
  // session GUC the audit trigger reads - attributes portal-driven writes
  // (e.g. Import Excel) to the real signed-in user, the same mechanism
  // Studio's proxied requests use.
  if (actorEmail) headers["X-User-Email"] = actorEmail;
  return headers;
}

function restError(err: any): never {
  const detail = err?.data?.message || err?.data?.hint || err?.message || String(err);
  throw createError({ statusCode: 502, statusMessage: `PostgREST error: ${detail}` });
}

/** Bulk-inserts rows into a table via PostgREST, using the service-role
 * key to bypass RLS. Pass `onConflict` (a column with a UNIQUE constraint -
 * see pg-meta.ts's ensureUniqueConstraint) to upsert instead: rows whose
 * key already exists get merged into the existing row, everything else is
 * inserted - used for re-importing a workbook in "append" mode. `actorEmail`
 * attributes the write in the audit log (see restHeaders above). */
export async function restInsert(
  table: string,
  records: Record<string, unknown>[],
  opts: { onConflict?: string; actorEmail?: string } = {},
): Promise<void> {
  const url = new URL(`${restBaseUrl()}/${table}`);
  const headers = restHeaders({ Prefer: "return=minimal" }, opts.actorEmail);
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

/** Same as restInsert, but returns the inserted row(s) - used where the
 * caller needs the database-generated id back (e.g. a new registration's
 * primary key) instead of just firing the insert. */
export async function restInsertReturning<T = Record<string, unknown>>(
  table: string,
  records: Record<string, unknown>[],
): Promise<T[]> {
  try {
    return await $fetch<T[]>(`${restBaseUrl()}/${table}`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=representation" }),
      body: records,
    });
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
  const values: unknown[] = [];
  let offset = 0;
  for (;;) {
    let page: Record<string, unknown>[];
    try {
      page = await $fetch<Record<string, unknown>[]>(`${restBaseUrl()}/${table}?select=${column}&offset=${offset}`, {
        headers: restHeaders(),
      });
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
 * `query` is a raw querystring assembled by the caller. Where a fragment
 * embeds a user-supplied value (e.g. the audit log's filters), the caller
 * must encodeURIComponent() that value itself before splicing it in - this
 * function does no escaping of its own. */
export async function restSelect<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  try {
    return await $fetch<T[]>(`${restBaseUrl()}/${table}?${query}`, { headers: restHeaders() });
  } catch (err: any) {
    restError(err);
  }
}

/** Same as restSelect, but also returns the total row count matching the
 * filters (ignoring limit/offset) via PostgREST's exact-count Prefer
 * header - used to render "X of Y" pagination without a second query. */
export async function restSelectWithCount<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<{ rows: T[]; total: number }> {
  try {
    const res = await $fetch.raw<T[]>(`${restBaseUrl()}/${table}?${query}`, {
      headers: restHeaders({ Prefer: "count=exact" }),
    });
    const rows = res._data ?? [];
    const range = res.headers.get("content-range"); // e.g. "0-49/123"
    const total = Number(range?.split("/")[1]);
    return { rows, total: Number.isFinite(total) ? total : rows.length };
  } catch (err: any) {
    restError(err);
  }
}

export async function restUpdate(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await $fetch(`${restBaseUrl()}/${table}?${query}`, {
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
    await $fetch(`${restBaseUrl()}/${table}?${query}`, {
      method: "DELETE",
      headers: restHeaders({ Prefer: "return=minimal" }),
    });
  } catch (err: any) {
    restError(err);
  }
}
