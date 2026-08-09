<template>
  <div class="page">
    <div class="card">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />

      <template v-if="step === 'credentials'">
        <p class="subtitle">Sign in to continue</p>
        <form class="form" @submit.prevent="onSubmitCredentials">
          <input v-model="username" type="text" autocomplete="username" placeholder="Username or email" required />
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="Password"
            required
          />
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Please wait…" : "Sign in" }}
          </button>
        </form>
        <p class="info">
          New here? <NuxtLink to="/register">Register</NuxtLink> - an admin needs to approve your account before
          you can sign in.
        </p>
      </template>

      <template v-else-if="step === 'enroll'">
        <p class="subtitle">Set up two-factor authentication</p>
        <p class="info">Scan this with an authenticator app (Google Authenticator, 1Password, Authy, ...):</p>
        <img class="qr-code" :src="enrollment!.qr" alt="2FA enrollment QR code" />
        <p class="info">Can't scan it? Enter this code manually: <code>{{ enrollment!.secret }}</code></p>
        <form class="form" @submit.prevent="onConfirmEnrollment">
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="6-digit code"
            required
          />
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Verifying…" : "Confirm" }}
          </button>
        </form>
      </template>

      <template v-else-if="step === 'verify'">
        <p class="subtitle">Enter your 2FA code</p>
        <form v-if="!useRecoveryCode" class="form" @submit.prevent="onVerifyCode">
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="6-digit code"
            required
          />
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Verifying…" : "Verify" }}
          </button>
        </form>
        <form v-else class="form" @submit.prevent="onVerifyRecoveryCode">
          <input v-model="recoveryCode" type="text" autocomplete="off" placeholder="Recovery code" required />
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Verifying…" : "Use recovery code" }}
          </button>
        </form>
        <button class="link-btn" type="button" @click="useRecoveryCode = !useRecoveryCode">
          {{ useRecoveryCode ? "Use my authenticator app instead" : "Lost your device? Use a recovery code" }}
        </button>
      </template>

      <template v-else-if="step === 'recovery-codes'">
        <p class="subtitle">Save your recovery codes</p>
        <p class="info">
          Each code works once, if you ever lose access to your authenticator app. They're shown only this once.
        </p>
        <div class="recovery-codes">
          <code v-for="c in recoveryCodes" :key="c">{{ c }}</code>
        </div>
        <button class="primary-btn" type="button" @click="onFinish">I've saved these - continue</button>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;
const { refresh } = useAuth();
const router = useRouter();

type Step = "credentials" | "enroll" | "verify" | "recovery-codes";

const step = ref<Step>("credentials");
const username = ref("");
const password = ref("");
const code = ref("");
const recoveryCode = ref("");
const useRecoveryCode = ref(false);
const loading = ref(false);
const error = ref("");

const loginId = ref("");
const enrollment = ref<{ qr: string; secret: string } | null>(null);
const recoveryCodes = ref<string[]>([]);

async function onSubmitCredentials() {
  loading.value = true;
  error.value = "";
  try {
    const res = await $fetch<
      | { status: "enroll"; loginId: string; qr: string; secret: string }
      | { status: "verify"; loginId: string }
    >("/api/auth/login", { method: "POST", body: { username: username.value, password: password.value } });

    loginId.value = res.loginId;
    if (res.status === "enroll") {
      enrollment.value = { qr: res.qr, secret: res.secret };
      step.value = "enroll";
    } else {
      step.value = "verify";
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Sign in failed");
  } finally {
    loading.value = false;
  }
}

async function submitCode(body: Record<string, unknown>) {
  loading.value = true;
  error.value = "";
  try {
    const res = await $fetch<{ status: "ok"; recoveryCodes?: string[] }>("/api/auth/verify", {
      method: "POST",
      body: { loginId: loginId.value, ...body },
    });
    if (res.recoveryCodes?.length) {
      recoveryCodes.value = res.recoveryCodes;
      step.value = "recovery-codes";
    } else {
      await onFinish();
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Verification failed");
  } finally {
    loading.value = false;
  }
}

function onConfirmEnrollment() {
  return submitCode({ code: code.value });
}

function onVerifyCode() {
  return submitCode({ code: code.value });
}

function onVerifyRecoveryCode() {
  return submitCode({ recoveryCode: recoveryCode.value });
}

async function onFinish() {
  await refresh();
  router.replace("/");
}
</script>
