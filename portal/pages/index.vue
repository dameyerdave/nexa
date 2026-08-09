<template>
  <div class="app-shell">
    <header class="header header-wide">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <nav class="header-actions">
        <button class="link-btn" type="button" :disabled="view === 'dashboards'" @click="view = 'dashboards'">
          Dashboards
        </button>
        <template v-if="user?.isEditor">
          <button class="link-btn" type="button" :disabled="view === 'studio'" @click="onShowStudio">Database</button>
          <NuxtLink class="link-btn" to="/import">Import Excel</NuxtLink>
        </template>
        <button class="link-btn" type="button" @click="onSignOut">Sign out</button>
      </nav>
    </header>
    <iframe v-if="frameUrl" class="studio-frame" :src="frameUrl" title="Nexdata" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else class="info">Loading…</p>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { user, signOut } = useAuth();

type View = "dashboards" | "studio";
const view = ref<View>("dashboards");
const studioUrl = ref("");
const error = ref("");

const frameUrl = computed(() => (view.value === "studio" ? studioUrl.value : config.public.metabaseUrl));

async function onShowStudio() {
  error.value = "";
  if (!studioUrl.value) {
    try {
      const { url } = await $fetch<{ url: string }>("/api/studio-link");
      studioUrl.value = url;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load the database view";
      return;
    }
  }
  view.value = "studio";
}

async function onSignOut() {
  await signOut();
  await navigateTo("/login");
}
</script>
