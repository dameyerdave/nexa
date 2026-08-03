import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const config = useRuntimeConfig();
  client = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey);
  return client;
}

export function useAuth() {
  const session = useState<Session | null>("auth-session", () => null);
  const ready = useState<boolean>("auth-ready", () => false);
  const supabase = getClient();

  async function init() {
    if (ready.value) return;
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    ready.value = true;
    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession;
    });
  }

  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
  }

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUpWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }

  async function signOut() {
    await supabase.auth.signOut();
    session.value = null;
  }

  return {
    session,
    ready,
    init,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    signOut,
  };
}
