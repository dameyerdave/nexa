<template>
  <div class="page">
    <header class="header">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <NuxtLink class="link-btn" to="/">Back</NuxtLink>
    </header>
    <p class="subtitle">Import an Excel workbook as a new table</p>

    <form v-if="step === 'upload'" class="form card" @submit.prevent="onUpload">
      <input type="file" accept=".xlsx" required :disabled="loading" @change="onFileChange" />
      <input v-model="tableName" type="text" placeholder="Table name (defaults to the filename)" :disabled="loading" />
      <button class="primary-btn" type="submit" :disabled="loading || !file">
        {{ loading ? "Uploading…" : "Import" }}
      </button>
    </form>

    <div v-else-if="step === 'choose-mode'" class="card">
      <p class="info">
        A table named <strong>{{ conflict!.table }}</strong> already exists. What do you want to do with these
        {{ conflict!.rowCount }} rows?
      </p>
      <button class="primary-btn" type="button" :disabled="loading" @click="onOverride">
        {{ loading ? "Replacing…" : "Override - replace all existing data" }}
      </button>
      <button class="link-btn" type="button" :disabled="loading" @click="step = 'pick-key'">
        Append - add rows, checking for duplicates
      </button>
    </div>

    <div v-else-if="step === 'pick-key'" class="card">
      <p class="info">Which column uniquely identifies a row (e.g. an ID or email column)?</p>
      <div class="form">
        <select v-model="keyColumn" :disabled="loading">
          <option value="" disabled>Choose a column</option>
          <option v-for="c in conflict!.columns" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <button class="primary-btn" type="button" :disabled="loading || !keyColumn" @click="onCheckDuplicates">
        {{ loading ? "Checking…" : "Check for duplicates" }}
      </button>
    </div>

    <div v-else-if="step === 'resolve'" class="card">
      <p class="info">
        {{ resolution!.newCount }} new row{{ resolution!.newCount === 1 ? "" : "s" }} will be added.
        <template v-if="resolution!.duplicateKeys.length">
          {{ resolution!.duplicateKeys.length }} already exist (matched on <strong>{{ resolution!.keyColumn }}</strong
          >) - choose which ones to overwrite:
        </template>
      </p>
      <div v-if="resolution!.duplicateKeys.length" class="form">
        <div class="header-actions">
          <button class="link-btn" type="button" @click="selectedKeys = new Set(resolution!.duplicateKeys)">
            Overwrite all
          </button>
          <button class="link-btn" type="button" @click="selectedKeys = new Set()">Overwrite none</button>
        </div>
        <label v-for="k in resolution!.duplicateKeys" :key="k" class="checkbox-row">
          <input type="checkbox" :checked="selectedKeys.has(k)" @change="toggleKey(k)" />
          {{ k }}
        </label>
      </div>
      <button class="primary-btn" type="button" :disabled="loading" @click="onResolve">
        {{ loading ? "Saving…" : "Confirm" }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="result" class="card">
      <p class="info">{{ result }}</p>
      <NuxtLink class="link-btn" to="/">Open in the database view</NuxtLink>
      <button class="link-btn" type="button" @click="reset">Import another file</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { apiFetch } = useApi();

interface Conflict {
  importId: string;
  table: string;
  columns: string[];
  rowCount: number;
}

interface Resolution {
  importId: string;
  keyColumn: string;
  newCount: number;
  duplicateKeys: string[];
}

type Step = "upload" | "choose-mode" | "pick-key" | "resolve";

const file = ref<File | null>(null);
const tableName = ref("");
const loading = ref(false);
const error = ref("");
const result = ref("");

const step = ref<Step>("upload");
const conflict = ref<Conflict | null>(null);
const keyColumn = ref("");
const resolution = ref<Resolution | null>(null);
const selectedKeys = ref<Set<string>>(new Set());

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

function toggleKey(key: string) {
  if (selectedKeys.value.has(key)) selectedKeys.value.delete(key);
  else selectedKeys.value.add(key);
}

function reset() {
  step.value = "upload";
  file.value = null;
  tableName.value = "";
  conflict.value = null;
  keyColumn.value = "";
  resolution.value = null;
  selectedKeys.value = new Set();
  result.value = "";
  error.value = "";
}

async function onUpload() {
  if (!file.value) return;
  loading.value = true;
  error.value = "";

  const body = new FormData();
  body.append("file", file.value);
  if (tableName.value.trim()) body.append("tableName", tableName.value.trim());

  try {
    const res = await apiFetch<
      | { status: "created"; table: string; columns: string[]; rowCount: number }
      | { status: "exists"; importId: string; table: string; columns: string[]; rowCount: number }
    >("/api/import", { method: "POST", body });

    if (res.status === "created") {
      result.value = `Created table ${res.table} with ${res.columns.length} columns and ${res.rowCount} rows.`;
    } else {
      conflict.value = res;
      step.value = "choose-mode";
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Import failed");
  } finally {
    loading.value = false;
  }
}

async function onOverride() {
  if (!conflict.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await apiFetch<{ table: string; columns: string[]; rowCount: number }>(
      `/api/import/${conflict.value.importId}/override`,
      { method: "POST" },
    );
    result.value = `Replaced table ${res.table} - now ${res.columns.length} columns and ${res.rowCount} rows.`;
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Override failed");
  } finally {
    loading.value = false;
  }
}

async function onCheckDuplicates() {
  if (!conflict.value || !keyColumn.value) return;
  loading.value = true;
  error.value = "";
  try {
    resolution.value = await apiFetch<Resolution>(`/api/import/${conflict.value.importId}/append`, {
      method: "POST",
      body: { keyColumn: keyColumn.value },
    });
    selectedKeys.value = new Set();
    step.value = "resolve";
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Could not check for duplicates");
  } finally {
    loading.value = false;
  }
}

async function onResolve() {
  if (!resolution.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await apiFetch<{ table: string; upsertedCount: number; skippedCount: number }>(
      `/api/import/${resolution.value.importId}/resolve`,
      { method: "POST", body: { overwriteKeys: [...selectedKeys.value] } },
    );
    result.value = `Added/updated ${res.upsertedCount} rows in ${res.table}${
      res.skippedCount ? `, skipped ${res.skippedCount} existing row${res.skippedCount === 1 ? "" : "s"}` : ""
    }.`;
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Resolve failed");
  } finally {
    loading.value = false;
  }
}
</script>
