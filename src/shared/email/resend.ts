import { reportP1 } from '../../incident-handling/index.js';
import { type AppConfig, requireConfig } from '../secrets/config.js';

/**
 * Resend transport - the one place that talks to https://api.resend.com.
 *
 * Used by the web app for transactional email (signup verification,
 * password reset). Delivery failures are non-blocking - callers return
 * success to the requester regardless and incidents are logged via
 * reportP1.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Source tag for incident reports. Helps ops triage failed sends by feature. */
  source: string;
  /** Sent as the Idempotency-Key HTTP header so a retried send is not delivered twice. */
  idempotencyKey?: string;
  /** Extra email headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  /** Resend's message id when the API accepted the send. */
  messageId?: string;
  /** Sanitized failure cause; safe for logs. No recipient PII. */
  reason?: string;
}

export async function sendEmail(config: AppConfig, opts: SendOptions): Promise<SendResult> {
  let apiKey: string;
  let from: string;
  try {
    apiKey = requireConfig(config, 'resendApiKey');
    from = requireConfig(config, 'resendFromEmail');
  } catch (err) {
    reportP1('Resend not configured; email cannot send', {
      source: opts.source,
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, reason: 'resend_not_configured' };
  }

  const body = {
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
  };

  let resp: Response;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(opts.idempotencyKey !== undefined ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort ? 'Resend timeout (5s elapsed)' : 'Resend network error';
    reportP1(message, {
      source: opts.source,
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, reason: isAbort ? 'resend_timeout' : 'resend_network_error' };
  }

  if (!resp.ok) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      // ignore
    }
    const scrubbedDetail = detail.replace(
      /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '<email-redacted>',
    );
    reportP1('Resend rejected send', {
      source: opts.source,
      tags: { status: String(resp.status) },
      extra: { detail: scrubbedDetail },
    });
    return { ok: false, reason: `resend_${resp.status}` };
  }

  let parsed: { id?: string } = {};
  try {
    parsed = (await resp.json()) as { id?: string };
  } catch {
    // success status but malformed body — treat as ok with no id.
  }
  return { ok: true, ...(parsed.id !== undefined ? { messageId: parsed.id } : {}) };
}
