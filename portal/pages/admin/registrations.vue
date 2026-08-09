<template>
  <div class="app-shell">
    <header class="header header-wide">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <nav class="header-actions">
        <NuxtLink class="link-btn" to="/">Back</NuxtLink>
      </nav>
    </header>

    <div class="admin-body">
      <p class="subtitle">Pending registrations</p>
      <p v-if="error" class="error">{{ error }}</p>

      <p v-if="!loading && registrations.length === 0" class="info">No registrations awaiting approval.</p>

      <div v-for="r in registrations" :key="r.id" class="card registration-card">
        <div class="registration-header">
          <div>
            <strong>{{ r.firstName }} {{ r.lastName }}</strong>
            <p class="info">{{ r.email }}</p>
          </div>
          <span v-if="!r.totpEnrolled" class="badge">Awaiting 2FA setup</span>
        </div>

        <template v-if="r.totpEnrolled">
          <p class="info">Assign to group(s):</p>
          <div class="form">
            <label v-for="g in groups" :key="g.id" class="checkbox-row">
              <input type="checkbox" :checked="selectedGroups[r.id]?.has(g.id)" @change="toggleGroup(r.id, g.id)" />
              {{ g.name }}
            </label>
            <p v-if="groups.length === 0" class="info">No groups configured in Metabase yet.</p>
          </div>
          <div class="header-actions">
            <button class="primary-btn" type="button" :disabled="busyId === r.id" @click="onApprove(r.id)">
              {{ busyId === r.id ? "Approving…" : "Approve" }}
            </button>
            <button class="link-btn" type="button" :disabled="busyId === r.id" @click="onReject(r.id)">Reject</button>
          </div>
        </template>
        <div v-else class="header-actions">
          <button class="link-btn" type="button" :disabled="busyId === r.id" @click="onReject(r.id)">
            Dismiss
          </button>
        </div>
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

interface RegistrationRow {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  totpEnrolled: boolean;
  requestedAt: string;
}
interface Group {
  id: number;
  name: string;
}

const registrations = ref<RegistrationRow[]>([]);
const groups = ref<Group[]>([]);
const selectedGroups = ref<Record<number, Set<number>>>({});
const loading = ref(true);
const busyId = ref<number | null>(null);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [regs, grps] = await Promise.all([
      $fetch<RegistrationRow[]>("/api/admin/registrations"),
      $fetch<Group[]>("/api/admin/groups"),
    ]);
    registrations.value = regs;
    groups.value = grps;
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Failed to load registrations");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggleGroup(registrationId: number, groupId: number) {
  const current = selectedGroups.value[registrationId] ?? new Set<number>();
  if (current.has(groupId)) current.delete(groupId);
  else current.add(groupId);
  selectedGroups.value = { ...selectedGroups.value, [registrationId]: current };
}

async function onApprove(id: number) {
  busyId.value = id;
  error.value = "";
  try {
    const groupIds = [...(selectedGroups.value[id] ?? [])];
    await $fetch(`/api/admin/registrations/${id}/approve`, { method: "POST", body: { groupIds } });
    await load();
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Failed to approve");
  } finally {
    busyId.value = null;
  }
}

async function onReject(id: number) {
  busyId.value = id;
  error.value = "";
  try {
    await $fetch(`/api/admin/registrations/${id}/reject`, { method: "POST" });
    await load();
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Failed to reject");
  } finally {
    busyId.value = null;
  }
}
</script>
