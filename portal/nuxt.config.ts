export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  nitro: {
    preset: "node-server",
  },
  runtimeConfig: {
    public: {
      // All of these are overridden at container start via matching
      // NUXT_PUBLIC_* environment variables (see docker-compose.yml / .env).
      appName: "Nexa",
      supabaseUrl: "",
      supabaseAnonKey: "",
      dataModelLabel: "Data Model",
      dataModelUrl: "",
      dataAnalyticsLabel: "Data Analytics",
      dataAnalyticsUrl: "",
    },
  },
});
