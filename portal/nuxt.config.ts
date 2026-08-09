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
    // bulk-insert parsed spreadsheet rows via PostgREST.
    serviceRoleKey: "",
    // The shared Basic Auth credential Kong puts in front of Studio (see
    // volumes/api/kong.yml's `dashboard` route) - used by
    // server/api/studio-link.get.ts to build an embeddable iframe URL so
    // signed-in users aren't prompted for it separately.
    dashboardUsername: "",
    dashboardPassword: "",
    // pg-meta (supabase/postgres-meta), reached over the internal Docker
    // network - used by server/api/import.post.ts to create a new table
    // from a spreadsheet's inferred column list.
    pgMetaUrl: "",
    public: {
      // All of these are overridden at container start via matching
      // NUXT_PUBLIC_* environment variables (see docker-compose.yml / .env).
      appName: "Nexdata",
      supabaseUrl: "",
      supabaseAnonKey: "",
      googleEnabled: false,
    },
  },
});
