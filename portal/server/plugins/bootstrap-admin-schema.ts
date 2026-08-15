/** Applies all the `admin`-schema DDL (audit log, 2FA, registrations) on
 * every portal boot - a no-op once already applied (see audit-store.ts,
 * two-factor-store.ts, registration-store.ts). This is what makes the
 * `admin` schema move reach an already-running deployment: those three
 * ensure*() functions are otherwise only called lazily, on first actual
 * use (a login, a registration) - without this, a table could sit
 * unmigrated in `public` for a while after upgrading, still reachable by
 * Metabase's schema sync in the meantime. Retries briefly since pg-meta
 * isn't a hard startup dependency of the portal today (only kong and
 * metabase are). */
export default defineNitroPlugin(async () => {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureAuditInfrastructure();
      await ensureTwoFactorTables();
      await ensureRegistrationTable();
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error("[bootstrap-admin-schema] Could not set up the admin schema", err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
});
