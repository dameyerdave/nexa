/** Bulk-inserts rows into a table via PostgREST, using the service-role
 * key to bypass RLS - mirrors pg-meta.ts's error-handling shape so a
 * failure here surfaces the same way a pg-meta failure does, instead of
 * an opaque unhandled 500. */
export async function restInsert(table: string, records: Record<string, unknown>[]): Promise<void> {
  const config = useRuntimeConfig();
  try {
    await $fetch(`${config.public.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: records,
    });
  } catch (err: any) {
    const detail = err?.data?.message || err?.data?.hint || err?.message || String(err);
    throw createError({ statusCode: 502, statusMessage: `PostgREST error: ${detail}` });
  }
}
