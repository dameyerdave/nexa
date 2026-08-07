<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <NuxtLink class="link-btn" to="/">Back</NuxtLink>
    </header>
    <p class="subtitle">Projects</p>
    <p class="info">
      Creating a project adds an empty Postgres schema (granted to signed-in users) and a matching Metabase
      connection scoped to it. Add tables via the Data Model tile's SQL editor, or Metabase's own UI for dashboards.
    </p>

    <form class="form create-form" @submit.prevent="onCreate">
      <input v-model="newName" type="text" placeholder="Project name" :disabled="creating" required />
      <button class="primary-btn" type="submit" :disabled="creating">
        {{ creating ? "Creating…" : "Create project" }}
      </button>
    </form>
    <p v-if="createError" class="error">{{ createError }}</p>

    <div class="admin-table admin-table-wide" v-if="!loading">
      <div class="admin-row admin-row-head admin-row-projects">
        <span>Name</span>
        <span>Schema</span>
        <span>Metabase</span>
        <span>Created by</span>
      </div>
      <div v-for="p in projects" :key="p.id" class="admin-row admin-row-projects">
        <span>{{ p.name }}</span>
        <span class="email">{{ p.schema_name }}</span>
        <span>
          <a v-if="p.metabase_database_id" class="link-btn" :href="metabaseUrl(p.metabase_database_id)" target="_blank" rel="noopener noreferrer">
            Open
          </a>
          <button v-else class="link-btn" type="button" :disabled="retrying === p.id" @click="onRetry(p)">
            {{ retrying === p.id ? "Retrying…" : "Retry connect" }}
          </button>
        </span>
        <span class="email">{{ p.created_by }}</span>
      </div>
      <p v-if="!projects.length" class="info" style="padding: 1rem">No projects yet.</p>
    </div>
    <p v-else class="info">Loading…</p>
    <p v-if="listError" class="error">{{ listError }}</p>
  </div>
</template>

<script setup lang="ts">
interface Project {
  id: number;
  name: string;
  schema_name: string;
  metabase_database_id: number | null;
  created_by: string;
  created_at: string;
}

const config = useRuntimeConfig();
const appName = config.public.appName;
const dataAnalyticsUrl = config.public.dataAnalyticsUrl;
const { apiFetch } = useApi();
const router = useRouter();

const projects = ref<Project[]>([]);
const loading = ref(true);
const listError = ref("");

const newName = ref("");
const creating = ref(false);
const createError = ref("");
const retrying = ref<number | null>(null);

function metabaseUrl(databaseId: number) {
  return `${dataAnalyticsUrl}/browse/databases/${databaseId}`;
}

onMounted(async () => {
  try {
    const me = await apiFetch<{ isAdmin: boolean; roles: string[] }>("/api/me");
    if (!me.isAdmin && !me.roles.includes("dbadmin")) {
      await router.replace("/");
      return;
    }
    projects.value = await apiFetch<Project[]>("/api/projects");
  } catch (e) {
    listError.value = e instanceof Error ? e.message : "Failed to load projects";
  } finally {
    loading.value = false;
  }
});

async function onCreate() {
  const name = newName.value.trim();
  if (!name) return;
  creating.value = true;
  createError.value = "";
  try {
    const project = await apiFetch<Project & { metabase_error: string | null }>("/api/projects", {
      method: "POST",
      body: { name },
    });
    projects.value = [...projects.value, project].sort((a, b) => a.name.localeCompare(b.name));
    newName.value = "";
    if (project.metabase_error) {
      createError.value = `Schema created, but connecting Metabase failed: ${project.metabase_error}. Use "Retry connect" below.`;
    }
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Failed to create project";
  } finally {
    creating.value = false;
  }
}

async function onRetry(project: Project) {
  retrying.value = project.id;
  createError.value = "";
  try {
    const updated = await apiFetch<Project & { metabase_error: string | null }>(
      `/api/projects/${project.id}/retry-metabase`,
      { method: "POST" },
    );
    const idx = projects.value.findIndex((p) => p.id === project.id);
    if (idx !== -1) projects.value[idx] = updated;
    if (updated.metabase_error) {
      createError.value = `Still failed: ${updated.metabase_error}`;
    }
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Retry failed";
  } finally {
    retrying.value = null;
  }
}
</script>
