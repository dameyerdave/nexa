<template>
  <div class="page">
    <div class="card">
      <h1>{{ appName }}</h1>
      <p class="subtitle">{{ mode === "signup" ? "Create an account" : "Sign in to continue" }}</p>

      <form class="form" @submit.prevent="onSubmit">
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="Email"
          required
        />
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
          placeholder="Password"
          minlength="6"
          required
        />
        <button class="primary-btn" type="submit" :disabled="loading">
          {{ loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in" }}
        </button>
      </form>

      <button class="link-btn" type="button" @click="toggleMode">
        {{ mode === "signup" ? "Already have an account? Sign in" : "No account yet? Create one" }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="info" class="info">{{ info }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { signInWithPassword, signUpWithPassword } = useAuth();
const router = useRouter();

const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const info = ref("");

function toggleMode() {
  mode.value = mode.value === "signin" ? "signup" : "signin";
  error.value = "";
  info.value = "";
}

async function onSubmit() {
  loading.value = true;
  error.value = "";
  info.value = "";
  try {
    if (mode.value === "signup") {
      const { needsEmailConfirmation } = await signUpWithPassword(email.value, password.value);
      if (needsEmailConfirmation) {
        info.value = "Account created. Check your email to confirm before signing in.";
        loading.value = false;
        return;
      }
    } else {
      await signInWithPassword(email.value, password.value);
    }
    router.replace("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Something went wrong";
  } finally {
    loading.value = false;
  }
}
</script>
