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
    // Supabase Admin API and Metabase Admin API. Role/admin state itself
    // (who's a portal admin, who has dbadmin/dashboardadmin, the Studio
    // credential) is NOT configured here - server/utils/roles-api.ts reads
    // it from the roles-api service's own database. See README.md "Roles
    // and access control".
    serviceRoleKey: "",
    metabaseAdminEmail: "",
    metabaseAdminPassword: "",
    rolesApiUrl: "",
    rolesApiToken: "",
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
