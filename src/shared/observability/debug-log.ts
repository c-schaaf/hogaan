/**
 * Debug-only structured log emit. Goes to stderr (console.warn) at pino
 * level 40 (warn) so Render captures the line regardless of LOG_LEVEL.
 *
 * Hardening: this function MUST NOT throw under any circumstance. It is
 * wrapped in try/catch internally because instrumentation that crashes
 * the caller is worse than no instrumentation at all. If JSON.stringify
 * or console.warn fails, the call returns silently.
 *
 * Use sparingly — these are temporary instrumentation lines for the
 * debug/full-pipeline-instrumentation branch. Once production silent-
 * failure root cause is identified, this helper and its call sites are
 * removed.
 */
export function debugWarn(tag: string, msg: string, ctx?: Record<string, unknown>): void {
  try {
    let payload: string;
    try {
      payload = JSON.stringify({
        level: 40,
        kind: 'debug-instrumentation',
        tag,
        msg,
        ts: new Date().toISOString(),
        ...(ctx ?? {}),
      });
    } catch {
      // Fall back to a minimal stringification if ctx had a circular ref
      // or a Symbol or any other non-serializable value.
      payload = JSON.stringify({
        level: 40,
        kind: 'debug-instrumentation',
        tag,
        msg,
        ts: new Date().toISOString(),
        ctxError: 'failed to serialize ctx',
      });
    }
    console.warn(payload);
  } catch {
    // console.warn itself failing is rare but possible (e.g., closed stream).
    // Swallow — instrumentation must not crash the caller.
  }
}
