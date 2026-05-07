/**
 * Debug-only structured log emit. Goes to stderr (console.warn) at pino
 * level 40 (warn) so Render captures the line regardless of LOG_LEVEL.
 *
 * Use sparingly — these are temporary instrumentation lines for the
 * debug/full-pipeline-instrumentation branch. Once production silent-
 * failure root cause is identified, this helper and its call sites are
 * removed.
 */
export function debugWarn(tag: string, msg: string, ctx?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      level: 40,
      kind: 'debug-instrumentation',
      tag,
      msg,
      ts: new Date().toISOString(),
      ...(ctx ?? {}),
    }),
  );
}
