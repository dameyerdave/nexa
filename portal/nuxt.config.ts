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
    // (see docker-compose.yml / .env). Used by server/api/* to talk to the
    // Supabase Admin API and Metabase Admin API, and to gate /api/admin/*.
    serviceRoleKey: "",
    portalAdminEmails: "",
    dashboardUsername: "",
    dashboardPassword: "",
    metabaseAdminEmail: "",
    metabaseAdminPassword: "",
    public: {
      // All of these are overridden at container start via matching
      // NUXT_PUBLIC_* environment variables (see docker-compose.yml / .env).
      appName: "Nexdata",
      supabaseUrl: "",
      supabaseAnonKey: "",
      googleEnabled: false,
      dataModelLabel: "Data Model",
      dataModelUrl: "",
      dataAnalyticsLabel: "Data Analytics",
      dataAnalyticsUrl: "",
    },
  },
});
