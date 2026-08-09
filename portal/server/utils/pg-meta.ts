/** Runs raw SQL against Postgres via pg-meta (the same internal service
 * Supabase Studio's own SQL editor uses) instead of the portal holding a
 * direct Postgres connection/credential of its own. */
export async function pgMetaQuery(sql: string): Promise<unknown> {
  const config = useRuntimeConfig();
  try {
    return await $fetch(`${config.pgMetaUrl}/query`, {
      method: "POST",
      body: { query: sql },
    });
  } catch (err: any) {
    const detail = err?.data?.error || err?.data?.message || err?.message || String(err);
    throw createError({ statusCode: 502, statusMessage: `Postgres error: ${detail}` });
  }
}

export interface ColumnDef {
  name: string;
  sqlType: string;
}

/** Creates a table with an identity primary key plus the given columns,
 * granted to `authenticated` - no IF NOT EXISTS, so a name collision fails
 * loudly via pgMetaQuery's error handling instead of silently no-op'ing. */
export async function createTable(schema: string, table: string, columns: ColumnDef[]): Promise<void> {
  const columnsSql = columns.map((c) => `"${c.name}" ${c.sqlType}`).join(", ");
  await pgMetaQuery(
    `create table "${schema}"."${table}" (row_id bigint generated always as identity primary key, ${columnsSql}); ` +
      `grant select, insert, update, delete on "${schema}"."${table}" to authenticated;`,
  );
}
