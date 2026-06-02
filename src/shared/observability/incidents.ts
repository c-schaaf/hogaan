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
      if (event.message !== undefined) {
        event.message = redactEmails(redactPhones(event.message));
      }
      if (event.extra !== undefined) {
        event.extra = scrubPiiContainer(event.extra);
      }
      if (event.tags !== undefined) {
        event.tags = scrubPiiContainer(event.tags) as typeof event.tags;
      }
      // Hard Rule #3: the Sentry SDK auto-captures the POST body into
      // event.request.data for HTTP-triggered errors. For
      // /api/chat/turn/stream that body is the user's raw coaching prompt,
      // which is PII and must never reach Sentry. event.request.headers can
      // also carry session cookies. Drop the whole object — we already have
      // the route/method via tags and never need the body or headers for
      // triage.
      delete event.request;
      return event;
    },
  });
  initialized = true;
}

const PHONE_RE = /(?<![a-zA-Z0-9])\+?\d{10,15}(?![a-zA-Z0-9])/g;
function redactPhones(s: string): string {
  return s.replace(PHONE_RE, '<phone-redacted>');
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function redactEmails(s: string): string {
  return s.replace(EMAIL_RE, '<email-redacted>');
}

// Exact-match (case-insensitive) PII key names. Anchored so keys like
// `email_template_id` are NOT silently redacted as PII.
const PII_KEYS = new Set([
  'email',
  'user_email',
  'useremail',
  'phone',
  'user_phone',
  'userphone',
  'phone_number',
  'phonenumber',
]);

function scrubPiiValue(v: unknown): unknown {
  if (typeof v === 'string') {
    return redactEmails(redactPhones(v));
  }
  if (Array.isArray(v)) {
    return v.map(scrubPiiValue);
  }
  if (v !== null && typeof v === 'object') {
    return scrubPiiContainer(v as Record<string, unknown>);
  }
  return v;
}

function scrubPiiContainer<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = '<redacted>';
    } else {
      out[k] = scrubPiiValue(v);
    }
  }
  return out;
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
