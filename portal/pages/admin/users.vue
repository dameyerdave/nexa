<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <NuxtLink class="link-btn" to="/">Back</NuxtLink>
    </header>
    <p class="subtitle">Manage user roles</p>

    <div class="admin-table" v-if="!loading">
      <div class="admin-row admin-row-head">
        <span>Email</span>
        <span>dbadmin</span>
        <span>dashboardadmin</span>
      </div>
      <div v-for="u in users" :key="u.id" class="admin-row">
        <span class="email">{{ u.email }}</span>
        <label class="checkbox">
          <input type="checkbox" :checked="u.roles.includes('dbadmin')" @change="toggleRole(u, 'dbadmin')" />
        </label>
        <label class="checkbox">
          <input type="checkbox" :checked="u.roles.includes('dashboardadmin')" @change="toggleRole(u, 'dashboardadmin')" />
        </label>
      </div>
    </div>
    <p v-else class="info">Loading…</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
interface AdminUser {
  id: string;
  email: string;
  roles: string[];
}

const config = useRuntimeConfig();
const appName = config.public.appName;
const { apiFetch } = useApi();
const router = useRouter();

const users = ref<AdminUser[]>([]);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    const me = await apiFetch<{ isAdmin: boolean }>("/api/me");
    if (!me.isAdmin) {
      await router.replace("/");
      return;
    }
    users.value = await apiFetch<AdminUser[]>("/api/admin/users");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load users";
  } finally {
    loading.value = false;
  }
});

async function toggleRole(user: AdminUser, role: "dbadmin" | "dashboardadmin") {
  const hasRole = user.roles.includes(role);
  const roles = hasRole ? user.roles.filter((r) => r !== role) : [...user.roles, role];
  const previous = user.roles;
  user.roles = roles;
  try {
    await apiFetch(`/api/admin/users/${user.id}/roles`, { method: "PUT", body: { roles } });
  } catch (e) {
    user.roles = previous;
    error.value = e instanceof Error ? e.message : "Failed to update roles";
  }
}
</script>
