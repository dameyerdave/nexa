<template>
  <div class="app-shell">
    <header class="header header-wide">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <nav class="header-actions">
        <button class="link-btn" type="button" :disabled="view === 'dashboards'" @click="view = 'dashboards'">
          Dashboards
        </button>
        <template v-if="user?.isEditor">
          <button class="link-btn" type="button" :disabled="view === 'studio'" @click="view = 'studio'">
            Database
          </button>
          <NuxtLink class="link-btn" to="/import">Import Excel</NuxtLink>
        </template>
        <template v-if="user?.isAdmin">
          <NuxtLink class="link-btn" to="/admin/registrations">Registrations</NuxtLink>
          <NuxtLink class="link-btn" to="/admin/audit">Audit log</NuxtLink>
        </template>
        <button class="link-btn" type="button" @click="onSignOut">Sign out</button>
      </nav>
    </header>
    <iframe v-if="frameUrl" class="studio-frame" :src="frameUrl" title="Nexdata" />
    <p v-else class="info">Loading…</p>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { user, signOut } = useAuth();

type View = "dashboards" | "studio";
const view = ref<View>("dashboards");

const frameUrl = computed(() => (view.value === "studio" ? config.public.supabaseUrl : config.public.metabaseUrl));

async function onSignOut() {
  await signOut();
  await navigateTo("/login");
}
</script>
