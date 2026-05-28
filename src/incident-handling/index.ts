/**
 * Process #18 — Incident Handling, minimal MVP.
 *
 * Most of the heavy lifting already lives in shared/observability:
 *   - reportIncident(severity, message, ctx, err) → dispatches to Sentry
 *     when configured (P0 = fatal, P1 = error, P2 = warning), otherwise
 *     dev-mode console.warn that surfaces the underlying error.
 *   - startHeartbeat() → BetterStack liveness pings.
 *
 * This module adds two pieces:
 *   1. Re-exports for ergonomic single-import.
 *   2. Process #2 §12 fail-open wrapper — every post-turn persistence branch
 *      (turn log, memory write, metrics, profile pattern detection) calls
 *      `runFailOpen()` so a thrown error becomes a P1 incident without
 *      breaking the parallel join.
 */

export { reportIncident, type IncidentContext } from '../shared/observability/incidents.js';
export { initSentry, setSentryUser, shutdownSentry } from '../shared/observability/incidents.js';
export { startHeartbeat } from '../shared/observability/heartbeat.js';

import { reportIncident, type IncidentContext } from '../shared/observability/incidents.js';
import type { IncidentSeverity } from '../shared/types/index.js';

/**
 * Run an async block fail-open, reporting any throw at the requested severity.
 * Returns the original return type when successful, or a sentinel `{ ok: false }`
 * when it failed-open. Process #2 §12a-d use this for the four post-turn
 * persistence branches that must not block the join.
 *
 * The function NEVER re-throws, so callers can chain without try/catch.
 */
export async function runFailOpen<T>(
  fn: () => Promise<T>,
  severity: IncidentSeverity,
  message: string,
  ctx: IncidentContext,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    reportIncident(severity, message, ctx, err);
    return { ok: false };
  }
}

/**
 * Severity helpers — kept thin so callers don't have to import IncidentSeverity
 * directly. Pattern: `reportP0('audit log write failed', {source: '...'})`.
 */
export function reportP0(message: string, ctx: IncidentContext, err?: unknown): void {
  reportIncident('P0', message, ctx, err);
}
export function reportP1(message: string, ctx: IncidentContext, err?: unknown): void {
  reportIncident('P1', message, ctx, err);
}
export function reportP2(message: string, ctx: IncidentContext, err?: unknown): void {
  reportIncident('P2', message, ctx, err);
}
