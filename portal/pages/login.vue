<template>
  <div class="page">
    <div class="card">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />
      <p class="subtitle">{{ mode === "signup" ? "Create an account" : "Sign in to continue" }}</p>

      <button v-if="googleEnabled" class="google-btn" type="button" :disabled="loading" @click="onGoogleSignIn">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
        </svg>
        Sign in with Google
      </button>
      <div v-if="googleEnabled" class="divider"><span>or</span></div>

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
const googleEnabled = config.public.googleEnabled;
const { signInWithGoogle, signInWithPassword, signUpWithPassword } = useAuth();
const router = useRouter();

const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const info = ref("");

async function onGoogleSignIn() {
  loading.value = true;
  error.value = "";
  try {
    await signInWithGoogle();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Something went wrong";
    loading.value = false;
  }
}

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
