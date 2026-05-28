import * as Sentry from '@sentry/node';
import type { AppConfig } from '../secrets/config.js';
import type { IncidentSeverity } from '../types/index.js';

let initialized = false;

/**
 * Initialize Sentry. Call once at process start, before buildApp().
 * No-op when SENTRY_DSN is unset (dev, test). Idempotent for multiple boots
 * during tests.
 */
export function initSentry(config: AppConfig): void {
  if (initialized) {
    return;
  }
  if (config.sentryDsn === undefined) {
    return;
  }
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.nodeEnv === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip anything that looks like a phone number from messages/extras.
      if (event.message !== undefined) {
        event.message = redactPhones(event.message);
      }
      return event;
    },
  });
  initialized = true;
}

const PHONE_RE = /\+?\d{10,15}/g;
function redactPhones(s: string): string {
  return s.replace(PHONE_RE, '<phone-redacted>');
}

function formatErrForDev(
  err: unknown,
): { name?: string; message?: string; value?: string } | undefined {
  if (err === undefined) {
    return undefined;
  }
  if (err instanceof Error) {
    return { name: err.name, message: redactPhones(err.message) };
  }
  if (typeof err === 'string') {
    return { value: redactPhones(err) };
  }
  if (typeof err === 'number' || typeof err === 'boolean') {
    return { value: String(err) };
  }
  if (err === null) {
    return { value: 'null' };
  }
  try {
    return { value: redactPhones(JSON.stringify(err)) };
  } catch {
    return { value: '<unserializable>' };
  }
}

const SENTRY_LEVELS: Record<IncidentSeverity, Sentry.SeverityLevel> = {
  P0: 'fatal',
  P1: 'error',
  P2: 'warning',
};

export interface IncidentContext {
  /** Where it fired — typically `process.step` (e.g. `Process_12.Step_8_AuditLog`). */
  source: string;
  /** Optional structured data — must NOT include plaintext PII. */
  extra?: Record<string, unknown>;
  /** Tags get indexed in Sentry — keep cardinality bounded. */
  tags?: Record<string, string>;
}

/**
 * Report an incident at a given severity. Convention (plan §1.5):
 *   - P0 (fatal): a fail-closed terminal end event fired (Process #11 E11/E12/E15,
 *     Process #12 E11 audit failure). Pages on-call immediately.
 *   - P1 (error): degraded but recoverable (LLM fallback used; QA regenerated).
 *     Alerts but does not page.
 *   - P2 (warning): something noteworthy (rate-limit queueing, suppression hit).
 *     Logged for trend analysis.
 *
 * Always-on convention: a thrown Error → Sentry.captureException keeps the
 * stack; a synthetic incident → Sentry.captureMessage drops the stack but
 * carries the structured context.
 */
export function reportIncident(
  severity: IncidentSeverity,
  message: string,
  ctx: IncidentContext,
  err?: unknown,
): void {
  if (!initialized) {
    const errInfo = formatErrForDev(err);
    console.warn(
      JSON.stringify({
        kind: 'incident',
        severity,
        message: redactPhones(message),
        ctx,
        ...(errInfo !== undefined ? { err: errInfo } : {}),
      }),
    );
    return;
  }

  Sentry.withScope((scope) => {
    scope.setLevel(SENTRY_LEVELS[severity]);
    scope.setTag('source', ctx.source);
    if (ctx.tags !== undefined) {
      for (const [k, v] of Object.entries(ctx.tags)) {
        scope.setTag(k, v);
      }
    }
    if (ctx.extra !== undefined) {
      scope.setExtras(ctx.extra);
    }
    if (err !== undefined) {
      Sentry.captureException(err, { tags: { incident_message: message } });
    } else {
      Sentry.captureMessage(redactPhones(message));
    }
  });
}

/**
 * Attach the authenticated user's internal id to the current Sentry scope.
 *
 * Without this, every Sentry issue shows "0 users" — there is no way to
 * answer "which beta tester hit this error?" or compute true impact.
 *
 * Privacy: only the internal UUID is sent — opaque, never PII. Plaintext
 * email / phone / name never reach Sentry (hard rule #3).
 *
 * No-op when Sentry is uninitialized (dev, test, or SENTRY_DSN unset).
 *
 * Concurrency note: in @sentry/node v10 this writes to the current scope.
 * Without an explicit Fastify integration the scope can theoretically leak
 * between concurrent requests sharing an isolation context. Acceptable
 * for v1 — even slightly mis-attributed user context beats "0 users"
 * entirely. Follow-up: wire `Sentry.fastifyIntegration()` for per-request
 * isolation.
 */
export function setSentryUser(userId: string): void {
  if (!initialized) {
    return;
  }
  Sentry.setUser({ id: userId });
}

export async function shutdownSentry(timeoutMs: number = 2000): Promise<void> {
  if (!initialized) {
    return;
  }
  await Sentry.close(timeoutMs);
  initialized = false;
}
