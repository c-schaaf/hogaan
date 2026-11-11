// Browser-side Supabase Auth client. One singleton; supabase-js handles
// session persistence (localStorage), refresh, and onAuthStateChange.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DEMO_ACCESS_TOKEN, isDemoMode } from './demo';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

// SCRUM — pre-fix, missing env threw at module load, blanking the page
// before any UI could render. We now capture the failure into a
// module-scoped flag; main.tsx reads it and renders a real error screen.
// Downstream callers still get a usable supabase client object so the
// module's other exports don't have to be conditional.
export const supabaseConfigError: string | null =
  !isDemoMode && (!url || !anonKey)
    ? 'Supabase env missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the repo-root .env.'
    : null;

type AuthCallback = (event: string, session: unknown) => void;

function buildDemoClient(): SupabaseClient {
  const session = {
    access_token: DEMO_ACCESS_TOKEN,
    user: { id: 'demo', email: 'amina.demo@example.com' },
  };
  const disabled = () =>
    Promise.resolve({ data: null, error: { message: 'Sign-in is turned off in demo mode.' } });
  const auth = {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    onAuthStateChange: (cb: AuthCallback) => {
      setTimeout(() => cb('INITIAL_SESSION', session), 0);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    signOut: () => Promise.resolve({ error: null }),
    signInWithPassword: disabled,
    signUp: disabled,
    signInWithOtp: disabled,
    resend: disabled,
    resetPasswordForEmail: disabled,
    updateUser: disabled,
  };
  // Only the auth surface the SPA calls is provided.
  return { auth } as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = isDemoMode
  ? buildDemoClient()
  : createClient(url ?? 'http://invalid.local', anonKey ?? 'invalid', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true, // auto-handle the #access_token=... return from magic links
        // Use implicit flow (default) - magic-link / signup-confirmation emails
        // return tokens in the URL hash. PKCE adds a code-exchange roundtrip that
        // some Supabase email templates don't generate correctly.
        flowType: 'implicit',
      },
    });

// SCRUM — auth-state debug logs leaked email + supabase user-id to the
// browser console in production. Gate on import.meta.env.DEV so they only
// run in local dev (Vite's standard convention; minified out in prod
// bundles).
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  supabase.auth.onAuthStateChange((event, session) => {
    // eslint-disable-next-line no-console
    console.log(
      '[supabase-auth]',
      event,
      session ? `${session.user.email} (${session.user.id})` : null,
    );
  });
}
