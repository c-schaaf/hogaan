// DEMO MODE flag for the browser (`pnpm demo` build only). Kept in its own
// module so tests that mock lib/supabase do not need to know about it.
export const isDemoMode: boolean = import.meta.env['VITE_DEMO_MODE'] === 'true';
export const DEMO_ACCESS_TOKEN = 'hogaan-demo-session';
