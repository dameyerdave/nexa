<template>
  <div class="page">
    <div class="card">
      <img class="logo" src="~/assets/img/logo.svg" :alt="appName" />

      <template v-if="step === 'details'">
        <p class="subtitle">Create an account</p>
        <form class="form" @submit.prevent="onSubmitDetails">
          <input v-model="firstName" type="text" autocomplete="given-name" placeholder="First name" required />
          <input v-model="lastName" type="text" autocomplete="family-name" placeholder="Last name" required />
          <input v-model="email" type="email" autocomplete="email" placeholder="Email" required />
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            placeholder="Password (min. 8 characters)"
            minlength="8"
            required
          />
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="Confirm password"
            minlength="8"
            required
          />
          <button class="primary-btn" type="submit" :disabled="loading">
            {{ loading ? "Please wait…" : "Continue" }}
          </button>
        </form>
        <p class="info">Already have an account? <NuxtLink to="/login">Sign in</NuxtLink></p>
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

      <template v-else-if="step === 'recovery-codes'">
        <p class="subtitle">Save your recovery codes</p>
        <p class="info">
          Each code works once, if you ever lose access to your authenticator app. They're shown only this once.
        </p>
        <div class="recovery-codes">
          <code v-for="c in recoveryCodes" :key="c">{{ c }}</code>
        </div>
        <button class="primary-btn" type="button" @click="step = 'pending'">I've saved these - continue</button>
      </template>

      <template v-else-if="step === 'pending'">
        <p class="subtitle">Account created</p>
        <p class="info">
          Your account and two-factor login are set up. An admin still needs to review and approve it before you
          can sign in - you'll be able to log in as soon as that happens.
        </p>
        <NuxtLink class="link-btn" to="/login">Back to sign in</NuxtLink>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const appName = config.public.appName;

type Step = "details" | "enroll" | "recovery-codes" | "pending";

const step = ref<Step>("details");
const firstName = ref("");
const lastName = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const code = ref("");
const loading = ref(false);
const error = ref("");

const registrationId = ref<number | null>(null);
const enrollment = ref<{ qr: string; secret: string } | null>(null);
const recoveryCodes = ref<string[]>([]);

async function onSubmitDetails() {
  error.value = "";
  if (password.value !== confirmPassword.value) {
    error.value = "Passwords don't match";
    return;
  }
  loading.value = true;
  try {
    const res = await $fetch<{ registrationId: number; qr: string; secret: string }>("/api/auth/register/start", {
      method: "POST",
      body: {
        firstName: firstName.value,
        lastName: lastName.value,
        email: email.value,
        password: password.value,
      },
    });
    registrationId.value = res.registrationId;
    enrollment.value = { qr: res.qr, secret: res.secret };
    step.value = "enroll";
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Registration failed");
  } finally {
    loading.value = false;
  }
}

async function onConfirmEnrollment() {
  loading.value = true;
  error.value = "";
  try {
    const res = await $fetch<{ status: "ok"; recoveryCodes: string[] }>("/api/auth/register/verify", {
      method: "POST",
      body: { registrationId: registrationId.value, code: code.value },
    });
    recoveryCodes.value = res.recoveryCodes;
    step.value = "recovery-codes";
  } catch (e: any) {
    error.value = e?.data?.statusMessage || (e instanceof Error ? e.message : "Verification failed");
  } finally {
    loading.value = false;
  }
}
</script>
