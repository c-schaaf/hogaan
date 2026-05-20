// SCRUM — debug logging helper that no-ops in production.
//
// Pre-fix, several call sites in Shell.tsx and supabase.ts wrote
// console.log lines containing the signed-in user's email + supabase id
// directly to the browser console. That's a PII leak (anyone with devtools
// open in prod sees it) and a regression magnet (no consistent guard).
//
// Use devLog/devWarn at any site that wants visibility during local
// development but should be silent in production builds. Vite replaces
// `import.meta.env.DEV` with a literal `true`/`false` at build time, so
// the calls (and their argument computation) are dead-code-eliminated in
// prod.

export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}
