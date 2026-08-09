<template>
  <div class="app-shell">
    <header class="header header-wide">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <nav class="header-actions">
        <NuxtLink class="link-btn" to="/">Back</NuxtLink>
      </nav>
    </header>

    <div class="admin-body">
      <p class="subtitle">Audit log</p>

      <form class="card audit-filters" @submit.prevent="applyFilters">
        <div class="audit-filter-row">
          <select v-model="filters.table">
            <option value="">All tables</option>
            <option v-for="t in filterOptions.tables" :key="t" :value="t">{{ t }}</option>
          </select>

          <label v-for="op in operations" :key="op" class="checkbox-row">
            <input v-model="filters.operations" type="checkbox" :value="op" />
            {{ op }}
          </label>
        </div>

        <div class="audit-filter-row">
          <input v-model="filters.actor" type="text" list="actor-options" placeholder="Changed by (email)" />
          <datalist id="actor-options">
            <option v-for="a in filterOptions.actors" :key="a" :value="a" />
          </datalist>
          <input v-model="filters.search" type="text" placeholder="Search old/new data" />
        </div>

        <div class="audit-filter-row">
          <label class="audit-date-label">
            From
            <input v-model="filters.from" type="datetime-local" />
          </label>
          <label class="audit-date-label">
            To
            <input v-model="filters.to" type="datetime-local" />
          </label>
          <p class="info audit-tz-hint">Times are in the server's own timezone.</p>
        </div>

        <div class="header-actions">
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Loading…" : "Apply filters" }}
          </button>
          <button class="link-btn" type="button" @click="clearFilters">Clear</button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="rows.length" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Table</th>
              <th>Operation</th>
              <th>By</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in rows" :key="row.id">
              <tr class="audit-row" @click="toggleExpanded(row.id)">
                <td>{{ new Date(row.changed_at).toLocaleString() }}</td>
                <td>{{ row.table_name }}</td>
                <td><span class="badge">{{ row.operation }}</span></td>
                <td>{{ row.changed_by }}</td>
                <td>{{ expanded.has(row.id) ? "Hide" : "View" }}</td>
              </tr>
              <tr v-if="expanded.has(row.id)" class="audit-detail-row">
                <td colspan="5">
                  <div class="audit-detail">
                    <div v-if="row.old_data">
                      <strong>Before</strong>
                      <pre>{{ JSON.stringify(row.old_data, null, 2) }}</pre>
                    </div>
                    <div v-if="row.new_data">
                      <strong>After</strong>
                      <pre>{{ JSON.stringify(row.new_data, null, 2) }}</pre>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else-if="!loading" class="info">No matching audit entries.</p>

      <div v-if="total > limit" class="header-actions">
        <button class="link-btn" type="button" :disabled="offset === 0" @click="page(-1)">Newer</button>
        <p class="info">{{ offset + 1 }}-{{ Math.min(offset + limit, total) }} of {{ total }}</p>
        <button class="link-btn" type="button" :disabled="offset + limit >= total" @click="page(1)">Older</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { user } = useAuth();
const router = useRouter();

if (user.value && !user.value.isAdmin) {
  await router.replace("/");
}

interface AuditRow {
  id: number;
  table_name: string;
  operation: string;
  old_data: unknown;
  new_data: unknown;
  changed_by: string;
  changed_at: string;
}

const operations = ["INSERT", "UPDATE", "DELETE"];

const filters = ref({
  table: "",
  operations: [] as string[],
  actor: "",
  search: "",
  from: "",
  to: "",
});
const filterOptions = ref<{ tables: string[]; actors: string[] }>({ tables: [], actors: [] });

const rows = ref<AuditRow[]>([]);
const expanded = ref<Set<number>>(new Set());
const total = ref(0);
const limit = ref(50);
const offset = ref(0);
const loading = ref(false);
const error = ref("");

function toggleExpanded(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const query: Record<string, string> = { limit: String(limit.value), offset: String(offset.value) };
    if (filters.value.table) query.table = filters.value.table;
    if (filters.value.operations.length) query.operation = filters.value.operations.join(",");
    if (filters.value.actor) query.actor = filters.value.actor;
    if (filters.value.search) query.search = filters.value.search;
    if (filters.value.from) query.from = filters.value.from;
    if (filters.value.to) query.to = filters.value.to;

    const res = await $fetch<{ rows: AuditRow[]; total: number }>("/api/admin/audit", { query });
    rows.value = res.rows;
    total.value = res.total;
    expanded.value = new Set();
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Failed to load the audit log");
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  offset.value = 0;
  return load();
}

function clearFilters() {
  filters.value = { table: "", operations: [], actor: "", search: "", from: "", to: "" };
  offset.value = 0;
  return load();
}

function page(direction: 1 | -1) {
  offset.value = Math.max(offset.value + direction * limit.value, 0);
  return load();
}

onMounted(async () => {
  load();
  try {
    filterOptions.value = await $fetch("/api/admin/audit/filters");
  } catch {
    // Filter suggestions are a nicety - the free-text inputs still work without them.
  }
});
</script>
