export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      title: "Nexdata",
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    },
  },
  nitro: {
    preset: "node-server",
  },
  runtimeConfig: {
    // Server-only - overridden via matching NUXT_* environment variables
    // (see docker-compose.yml / .env).
    // Service-role Postgres access, used by server/api/import.post.ts to
    // bulk-insert parsed spreadsheet rows via PostgREST, and by
    // server/utils/two-factor-store.ts for the portal's own TOTP tables.
    serviceRoleKey: "",
    // Studio, reached directly over the internal Docker network - the proxy
    // target for Studio's own shell (Kong's `dashboard` route), gated on a
    // real editor session rather than Kong's old Basic Auth (embedded
    // credentials in an iframe src turned out to be blocked outright by
    // modern browsers) - see server/utils/studio-proxy.ts.
    studioInternalUrl: "",
    // pg-meta (supabase/postgres-meta), reached over the internal Docker
    // network - used by server/api/import.post.ts to create a new table
    // from a spreadsheet's inferred column list, and to ensure the 2FA/
    // audit-log tables exist.
    pgMetaUrl: "",
    // PostgREST, reached directly over the internal Docker network rather
    // than through Kong's public URL - see server/utils/postgrest.ts. Also
    // the proxy target for Studio's own REST calls, identity-stamped for
    // the audit log - see server/utils/studio-proxy.ts.
    restInternalUrl: "",
    // Metabase is the portal's identity provider - see
    // server/utils/metabase-auth.ts. Reached over the internal Docker
    // network for login and admin lookups (never through Kong's published
    // listener - see kong.yml's metabase-session-block route for why).
    metabaseInternalUrl: "",
    // A dedicated Metabase admin account the portal uses only to look up
    // *other* users' group membership (a regular user's own session can't
    // see that) - not shown to end users anywhere.
    metabaseAdminEmail: "",
    metabaseAdminPassword: "",
    // The Metabase group that grants read/write access to dashboards and
    // unlocks Supabase Studio + Import Excel in the portal - create this
    // group in Metabase's own admin UI and assign users to it there.
    metabaseEditorGroup: "Editors",
    public: {
      // All of these are overridden at container start via matching
      // NUXT_PUBLIC_* environment variables (see docker-compose.yml / .env).
      appName: "Nexdata",
      supabaseUrl: "",
      metabaseUrl: "",
    },
  },
});
