<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <div class="header-actions">
        <NuxtLink v-if="isAdmin" class="link-btn" to="/admin/users">Manage users</NuxtLink>
        <button class="link-btn" type="button" @click="onSignOut">Sign out</button>
      </div>
    </header>
    <p class="subtitle">Choose a destination</p>
    <div class="tiles">
      <button v-if="canAccessStudio" class="tile" type="button" @click="openStudio">
        <h2>{{ dataModelLabel }}</h2>
        <p>Browse and manage your data structures</p>
      </button>
      <a class="tile" :href="dataAnalyticsUrl" target="_blank" rel="noopener noreferrer">
        <h2>{{ dataAnalyticsLabel }}</h2>
        <p>Explore dashboards and reports</p>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const dataModelLabel = config.public.dataModelLabel;
const dataAnalyticsLabel = config.public.dataAnalyticsLabel;
const dataAnalyticsUrl = config.public.dataAnalyticsUrl;

const { signOut } = useAuth();
const { apiFetch } = useApi();

const isAdmin = ref(false);
const canAccessStudio = ref(false);

onMounted(async () => {
  try {
    const me = await apiFetch<{ roles: string[]; isAdmin: boolean }>("/api/me");
    isAdmin.value = me.isAdmin;
    canAccessStudio.value = me.isAdmin || me.roles.includes("dbadmin");
  } catch {
    // Not fatal - tiles that need it just stay hidden.
  }
});

async function openStudio() {
  const { url } = await apiFetch<{ url: string }>("/api/studio-link");
  window.open(url, "_blank", "noopener,noreferrer");
}

async function onSignOut() {
  await signOut();
  await navigateTo("/login");
}
</script>
