/** Auto-creates the initial Metabase admin account from
 * METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD on first boot, so nobody
 * has to temporarily publish Metabase's port and click through its setup
 * wizard by hand. Safe to run on every boot: Metabase's own /api/setup
 * only works once (its setup-token goes away as soon as an account
 * exists), so this is a no-op on every start after the first. */
export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig();
  if (!config.metabaseAdminEmail || !config.metabaseAdminPassword) return;

  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const props = await $fetch<{ "setup-token": string | null }>(
        `${config.metabaseInternalUrl}/api/session/properties`,
      );
      if (!props["setup-token"]) return; // already set up - nothing to do

      await $fetch(`${config.metabaseInternalUrl}/api/setup`, {
        method: "POST",
        body: {
          token: props["setup-token"],
          user: {
            first_name: "Admin",
            last_name: "User",
            email: config.metabaseAdminEmail,
            password: config.metabaseAdminPassword,
          },
          prefs: { site_name: config.public.appName, site_locale: "en", allow_tracking: false },
        },
      });
      console.log(`[bootstrap-metabase-admin] Created the initial Metabase admin account (${config.metabaseAdminEmail})`);
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error("[bootstrap-metabase-admin] Could not auto-create the Metabase admin account", err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
});
