<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <button class="link-btn" type="button" @click="onSignOut">Sign out</button>
    </header>
    <p class="subtitle">Choose a destination</p>
    <div class="tiles">
      <a class="tile" :href="dataModelUrl" target="_blank" rel="noopener noreferrer">
        <h2>{{ dataModelLabel }}</h2>
        <p>Browse and manage your data structures</p>
      </a>
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
const dataModelUrl = config.public.dataModelUrl;
const dataAnalyticsLabel = config.public.dataAnalyticsLabel;
const dataAnalyticsUrl = config.public.dataAnalyticsUrl;

const { signOut } = useAuth();

async function onSignOut() {
  await signOut();
  await navigateTo("/login");
}
</script>
