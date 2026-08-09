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
