/** Auto-creates the initial Metabase admin account from
 * METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD on first boot, so nobody
 * has to temporarily publish Metabase's port and click through its setup
 * wizard by hand. Safe to run on every boot: Metabase's own /api/setup
 * only works once (its setup-token goes away as soon as an account
 * exists), so account creation itself is a no-op on every start after the
 * first - but the steps after it (connect the real database with a
 * public-only schema filter, remove the bundled sample database) run
 * idempotently on every boot regardless, since they're what makes this
 * reach an already-set-up deployment too (this repo's own included).
 *
 * Two failure modes are handled differently: Metabase not being reachable
 * yet is transient and worth retrying; Metabase rejecting the actual
 * account (e.g. a too-common password - it checks new passwords against
 * its own blocklist regardless of length/character mix) is permanent, so
 * that's logged with the real reason instead of retried uselessly. */
export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig();
  if (!config.metabaseAdminEmail || !config.metabaseAdminPassword) return;

  let setupToken: string | null = null;
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const props = await $fetch<{ "setup-token": string | null }>(
        `${config.metabaseInternalUrl}/api/session/properties`,
      );
      setupToken = props["setup-token"];
      break;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error("[bootstrap-metabase-admin] Metabase never became reachable", err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  let session: string | undefined;

  if (setupToken) {
    try {
      const result = await $fetch<{ id: string }>(`${config.metabaseInternalUrl}/api/setup`, {
        method: "POST",
        body: {
          token: setupToken,
          user: {
            first_name: "Admin",
            last_name: "User",
            email: config.metabaseAdminEmail,
            password: config.metabaseAdminPassword,
          },
          prefs: { site_name: config.public.appName, site_locale: "en", allow_tracking: false },
        },
      });
      session = result.id; // /api/setup logs the new account in directly
      console.log(`[bootstrap-metabase-admin] Created the initial Metabase admin account (${config.metabaseAdminEmail})`);
    } catch (err: any) {
      if (err?.response?.status !== 403) {
        // Not "another replica already won this race" - a real failure.
        const detail =
          err?.data?.["specific-errors"] ?? err?.data?.errors ?? err?.data?.message ?? err?.message ?? String(err);
        console.error(
          "[bootstrap-metabase-admin] Metabase rejected METABASE_ADMIN_EMAIL/PASSWORD - fix .env and `docker compose restart portal`. Reason:",
          detail,
        );
        return;
      }
    }
  }

  if (!session) {
    try {
      const result = await $fetch<{ id: string }>(`${config.metabaseInternalUrl}/api/session`, {
        method: "POST",
        body: { username: config.metabaseAdminEmail, password: config.metabaseAdminPassword },
      });
      session = result.id;
    } catch (err) {
      console.error("[bootstrap-metabase-admin] Could not sign in as the Metabase admin to finish setup", err);
      return;
    }
  }

  const headers = { "X-Metabase-Session": session };
  try {
    const databases = await $fetch<{ data: Array<{ id: number; is_sample: boolean; name: string }> }>(
      `${config.metabaseInternalUrl}/api/database`,
      { headers },
    );

    const sample = databases.data.find((db) => db.is_sample);
    if (sample) {
      await $fetch(`${config.metabaseInternalUrl}/api/database/${sample.id}`, { method: "DELETE", headers });
      console.log(`[bootstrap-metabase-admin] Removed Metabase's bundled sample database (${sample.name})`);
    }

    const hasRealDatabase = databases.data.some((db) => !db.is_sample);
    if (!hasRealDatabase) {
      await $fetch(`${config.metabaseInternalUrl}/api/database`, {
        method: "POST",
        headers,
        body: {
          engine: "postgres",
          name: config.public.appName || "Nexdata",
          details: {
            // PGHOST/PGPORT/PGPASSWORD are already on this container for
            // `nexa db backup`/`restore` (see docker-compose.yml) - reused
            // here rather than adding a redundant NUXT_* config var.
            host: process.env.PGHOST || "db",
            port: Number(process.env.PGPORT) || 5432,
            dbname: "postgres",
            user: "postgres",
            password: process.env.PGPASSWORD,
            ssl: false,
            // Only `public` - `admin` (audit log, 2FA, registrations) and
            // Supabase's own internal schemas (auth, storage, etc.) never
            // show up in Metabase this way, confirmed live.
            "schema-filters-type": "inclusion",
            "schema-filters-patterns": "public",
          },
          is_full_sync: true,
        },
      });
      console.log(`[bootstrap-metabase-admin] Connected Metabase to the real database (public schema only)`);
    }
  } catch (err) {
    console.error("[bootstrap-metabase-admin] Could not finish database setup", err);
  }
});
