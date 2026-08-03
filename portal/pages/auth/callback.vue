<template>
  <div class="page">
    <p class="subtitle">Signing in…</p>
  </div>
</template>

<script setup lang="ts">
const { session, init } = useAuth();
const router = useRouter();

onMounted(async () => {
  await init();
});

watch(
  session,
  (value) => {
    if (value) {
      router.replace("/");
    }
  },
  { immediate: true },
);
</script>
