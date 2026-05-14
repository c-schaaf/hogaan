// Browser-side Supabase Auth client. One singleton; supabase-js handles
// session persistence (localStorage), refresh, and onAuthStateChange.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

if (!url || !anonKey) {
  // Throw at module load so the error surfaces immediately, not on first sign-in.
  throw new Error(
    'Supabase env missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the repo-root .env.',
  );
}

export const supabase = createClient(url, anonKey, {
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

// Debug visibility into auth-state events. Strip in production.
if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    // eslint-disable-next-line no-console
    console.log(
      '[supabase-auth]',
      event,
      session ? `${session.user.email} (${session.user.id})` : null,
    );
  });
}
