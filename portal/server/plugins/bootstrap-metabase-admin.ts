/** Auto-creates the initial Metabase admin account from
 * METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD on first boot, so nobody
 * has to temporarily publish Metabase's port and click through its setup
 * wizard by hand. Safe to run on every boot: Metabase's own /api/setup
 * only works once (its setup-token goes away as soon as an account
 * exists), so this is a no-op on every start after the first.
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

  if (!setupToken) return; // already set up - nothing to do

  try {
    await $fetch(`${config.metabaseInternalUrl}/api/setup`, {
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
    console.log(`[bootstrap-metabase-admin] Created the initial Metabase admin account (${config.metabaseAdminEmail})`);
  } catch (err: any) {
    if (err?.response?.status === 403) return; // another replica already won this race
    const detail = err?.data?.["specific-errors"] ?? err?.data?.errors ?? err?.data?.message ?? err?.message ?? String(err);
    console.error(
      "[bootstrap-metabase-admin] Metabase rejected METABASE_ADMIN_EMAIL/PASSWORD - fix .env and `docker compose restart portal`. Reason:",
      detail,
    );
  }
});
