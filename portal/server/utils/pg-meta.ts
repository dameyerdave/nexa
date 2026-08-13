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
 * loudly via pgMetaQuery's error handling instead of silently no-op'ing.
 * Notifies PostgREST to reload its schema cache immediately after - without
 * this, a restInsert into the brand-new table right afterwards (as Import
 * Excel does) can 502 with "Could not find the table in the schema cache"
 * until PostgREST picks up the change on its own. */
export async function createTable(schema: string, table: string, columns: ColumnDef[]): Promise<void> {
  const columnsSql = columns.map((c) => `"${c.name}" ${c.sqlType}`).join(", ");
  await pgMetaQuery(
    `create table "${schema}"."${table}" (row_id bigint generated always as identity primary key, ${columnsSql}); ` +
      `grant select, insert, update, delete on "${schema}"."${table}" to authenticated; ` +
      `notify pgrst, 'reload schema';`,
  );
}

export async function tableExists(schema: string, table: string): Promise<boolean> {
  const rows = (await pgMetaQuery(
    `select 1 from information_schema.tables where table_schema = '${schema}' and table_name = '${table}'`,
  )) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

export async function dropTable(schema: string, table: string): Promise<void> {
  await pgMetaQuery(`drop table if exists "${schema}"."${table}"; notify pgrst, 'reload schema';`);
}

/** Adds a UNIQUE constraint on `column` if one isn't already there -
 * required for PostgREST's on_conflict upsert (see postgrest.ts's
 * restInsert) to work for re-imports. Fails loudly via pgMetaQuery if
 * existing rows already have duplicate values in that column. PostgREST
 * needs to know about the new constraint too (it validates on_conflict
 * against its own cached constraint list), hence the same reload notify. */
export async function ensureUniqueConstraint(schema: string, table: string, column: string): Promise<void> {
  const constraintName = `${table}_${column}_key`;
  await pgMetaQuery(
    `do $$ begin
       if not exists (select 1 from pg_constraint where conname = '${constraintName}') then
         alter table "${schema}"."${table}" add constraint "${constraintName}" unique ("${column}");
       end if;
     end $$;
     notify pgrst, 'reload schema';`,
  );
}
