/** Records discrete application events (sign-ins, 2FA, registrations) into
 * the same admin.audit_log table row-change triggers write to (see
 * volumes/db/audit.sql) - table_name="auth" distinguishes these from real
 * row changes, but they share the same table so the existing admin Audit
 * log viewer (portal/pages/admin/audit.vue) lists, filters, and searches
 * them with no extra code. Best-effort: never throws, so a logging hiccup
 * can't turn into a failed login/registration for the actual user. */
export async function auditEvent(
  operation: string,
  changedBy: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await restInsert(
      "audit_log",
      [{ table_name: "auth", operation, changed_by: changedBy, new_data: detail ?? null }],
      { schema: "admin" },
    );
  } catch (err) {
    console.error(`[auth-audit] Failed to record ${operation} for ${changedBy}`, err);
  }
}
