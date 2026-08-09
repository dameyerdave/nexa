/** Distinct values to populate the audit log's filter dropdowns - a plain
 * read-only query, safe via pg-meta since nothing here is user input. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const rows = (await pgMetaQuery(
    `select
       array(select distinct table_name from public.audit_log order by table_name) as tables,
       array(select distinct changed_by from public.audit_log order by changed_by) as actors`,
  )) as Array<{ tables: string[]; actors: string[] }>;
  return rows[0] ?? { tables: [], actors: [] };
});
