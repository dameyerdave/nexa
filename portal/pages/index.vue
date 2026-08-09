<template>
  <div class="app-shell">
    <header class="header header-wide">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <nav class="header-actions">
        <NuxtLink class="link-btn" to="/import">Import Excel</NuxtLink>
        <button class="link-btn" type="button" @click="onSignOut">Sign out</button>
      </nav>
    </header>
    <iframe v-if="studioUrl" class="studio-frame" :src="studioUrl" title="Database" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else class="info">Loading…</p>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { signOut } = useAuth();
const { apiFetch } = useApi();

const studioUrl = ref("");
const error = ref("");

onMounted(async () => {
  try {
    const { url } = await apiFetch<{ url: string }>("/api/studio-link");
    studioUrl.value = url;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load the database view";
  }
});

async function onSignOut() {
  await signOut();
  await navigateTo("/login");
}
</script>
