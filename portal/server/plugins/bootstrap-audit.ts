/** Applies the audit-log SQL (table, trigger, event trigger, PostgREST
 * pre-request hook) on every portal boot - a no-op once it's already
 * applied (see audit-store.ts). This is what makes the feature reach an
 * already-running deployment, since volumes/db/audit.sql only runs on a
 * brand-new database. Retries briefly since pg-meta isn't a hard startup
 * dependency of the portal today (only kong and metabase are). */
export default defineNitroPlugin(async () => {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureAuditInfrastructure();
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error("[bootstrap-audit] Could not set up the audit log", err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
});
