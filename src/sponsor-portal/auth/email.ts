import { reportP1 } from '../../incident-handling/index.js';
import { type AppConfig, requireConfig } from '../../shared/secrets/config.js';

/**
 * Phase 9A.1 — Resend transport for the magic-link email. Delivery only;
 * authentication itself flows through src/identity/token.ts.
 *
 * Why Resend: simple HTTPS POST, no SDK overhead, the default
 * `onboarding@resend.dev` sender is acceptable for closed-alpha until a
 * real domain is verified. (Locked decision, 2026-05-05.)
 *
 * Failure mode: the magic-link request endpoint returns success even if
 * email send fails (we don't leak whether an email was deliverable). The
 * incident is logged via reportP1 so ops can investigate without surface
 * to the requester.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
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
    reportP1('Resend not configured; magic-link email cannot send', {
      source: 'Phase9A.MagicLink',
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
  };

  let resp: Response;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    reportP1('Resend network error sending magic-link email', {
      source: 'Phase9A.MagicLink',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, reason: 'resend_network_error' };
  }

  if (!resp.ok) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      // ignore
    }
    reportP1('Resend rejected magic-link email send', {
      source: 'Phase9A.MagicLink',
      tags: { status: String(resp.status) },
      extra: { detail },
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
