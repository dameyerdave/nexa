<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <NuxtLink class="link-btn" to="/">Back</NuxtLink>
    </header>
    <p class="subtitle">Import an Excel workbook as a new table</p>

    <form class="form card" @submit.prevent="onSubmit">
      <input type="file" accept=".xlsx" required :disabled="loading" @change="onFileChange" />
      <input v-model="tableName" type="text" placeholder="Table name (defaults to the filename)" :disabled="loading" />
      <button class="primary-btn" type="submit" :disabled="loading || !file">
        {{ loading ? "Importing…" : "Import" }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="result" class="card">
      <p class="info">
        Created table <strong>{{ result.table }}</strong> with {{ result.columns.length }} columns and
        {{ result.rowCount }} rows.
      </p>
      <NuxtLink class="link-btn" to="/">Open in the database view</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { apiFetch } = useApi();

interface ImportResult {
  table: string;
  columns: string[];
  rowCount: number;
}

const file = ref<File | null>(null);
const tableName = ref("");
const loading = ref(false);
const error = ref("");
const result = ref<ImportResult | null>(null);

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function onSubmit() {
  if (!file.value) return;
  loading.value = true;
  error.value = "";
  result.value = null;

  const body = new FormData();
  body.append("file", file.value);
  if (tableName.value.trim()) body.append("tableName", tableName.value.trim());

  try {
    result.value = await apiFetch<ImportResult>("/api/import", { method: "POST", body });
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Import failed");
  } finally {
    loading.value = false;
  }
}
</script>
