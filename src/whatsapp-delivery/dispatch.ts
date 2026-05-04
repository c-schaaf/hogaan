import twilio from 'twilio';
import { type AppConfig, requireConfig } from '../shared/secrets/config.js';
import type { OutboundRequest } from './types.js';

/**
 * Twilio API dispatch — Process #11 Step 8.
 *
 * 5-second hard cap per call. The orchestrator drives the 3-retry loop on
 * transient failures; this function makes ONE call and surfaces a typed
 * error so the orchestrator can dispatch.
 */

const DEFAULT_TIMEOUT_MS = 5000;

export class DispatchAuthError extends Error {
  public override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'DispatchAuthError';
    this.cause = cause;
  }
}

export class DispatchPermanentError extends Error {
  public override readonly cause: unknown;
  public readonly status: number;
  public readonly twilioCode: number | undefined;
  constructor(message: string, status: number, twilioCode: number | undefined, cause: unknown) {
    super(message);
    this.name = 'DispatchPermanentError';
    this.status = status;
    this.twilioCode = twilioCode;
    this.cause = cause;
  }
}

export class DispatchRateLimitError extends Error {
  public override readonly cause: unknown;
  constructor(cause: unknown) {
    super('twilio rate-limited (HTTP 429)');
    this.name = 'DispatchRateLimitError';
    this.cause = cause;
  }
}

export class DispatchTransientError extends Error {
  public override readonly cause: unknown;
  public readonly status: number;
  constructor(message: string, status: number, cause: unknown) {
    super(message);
    this.name = 'DispatchTransientError';
    this.status = status;
    this.cause = cause;
  }
}

export class DispatchTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`twilio dispatch timed out after ${timeoutMs}ms`);
    this.name = 'DispatchTimeoutError';
  }
}

export interface DispatchResult {
  waMessageId: string;
  /** Provider-side status at create time. Twilio normally returns "queued" or "sent". */
  status: string;
}

let cachedClient: ReturnType<typeof twilio> | undefined;

function getClient(config: AppConfig): ReturnType<typeof twilio> {
  if (cachedClient === undefined) {
    cachedClient = twilio(
      requireConfig(config, 'twilioAccountSid'),
      requireConfig(config, 'twilioAuthToken'),
    );
  }
  return cachedClient;
}

/**
 * Render an OutboundRequest into the body text Twilio will see.
 *
 * For Phase 3, both FreeForm and Template paths render to text and send via
 * the messages API. Real Meta-approved templates (Twilio Content Resources)
 * arrive with Phase 6/7 once the approval pipeline is set up. The catalog
 * lookup in templates.ts gates which template names are accepted; the
 * actual body text for now is "<templateName>: <params joined>" —
 * purposefully placeholder so the path exists end-to-end.
 */
function renderBody(req: OutboundRequest): string {
  if (req.messageType === 'FreeForm') {
    return req.body ?? '';
  }
  const params = (req.templateParams ?? []).join(' | ');
  return params.length > 0
    ? `[${req.templateName ?? 'template'}] ${params}`
    : `[${req.templateName ?? 'template'}]`;
}

/**
 * Single Twilio API call. Throws a categorized error on any non-2xx.
 *
 * Sandbox + production share the same code path — only TWILIO_WHATSAPP_FROM
 * differs. The user joins the sandbox via "join <keyword>" → +14155238886
 * which opens a 24h customer-service window for free-form sends.
 */
export async function dispatchToTwilio(
  config: AppConfig,
  request: OutboundRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DispatchResult> {
  const client = getClient(config);
  const from = requireConfig(config, 'twilioWhatsAppFrom');
  const to = `whatsapp:${request.phoneE164}`;
  const body = renderBody(request);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  try {
    const result = await Promise.race([
      client.messages.create({
        from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        to,
        body,
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new DispatchTimeoutError(timeoutMs)),
          { once: true },
        );
      }),
    ]);
    return { waMessageId: result.sid, status: String(result.status ?? 'queued') };
  } catch (err) {
    if (err instanceof DispatchTimeoutError) {
      throw err;
    }
    throw mapTwilioError(err);
  } finally {
    clearTimeout(timer);
  }
}

function mapTwilioError(err: unknown): Error {
  // Twilio SDK errors have shape { status, code, message, moreInfo }.
  if (err === null || typeof err !== 'object') {
    return err instanceof Error ? err : new Error(String(err));
  }
  const e = err as { status?: number; code?: number; message?: string };
  const status = typeof e.status === 'number' ? e.status : 0;

  if (status === 401 || status === 403) {
    return new DispatchAuthError(`twilio auth failure (${status})`, err);
  }
  if (status === 429) {
    return new DispatchRateLimitError(err);
  }
  if (status >= 500 && status < 600) {
    return new DispatchTransientError(`twilio transient (${status})`, status, err);
  }
  if (status >= 400 && status < 500) {
    return new DispatchPermanentError(
      `twilio permanent failure (${status} code=${e.code ?? 'unknown'})`,
      status,
      e.code,
      err,
    );
  }
  // Network errors, DNS, etc. — treat as transient.
  return new DispatchTransientError(`twilio dispatch failed: ${e.message ?? 'unknown'}`, 0, err);
}

/** Test seam. */
export function resetTwilioClientForTests(): void {
  cachedClient = undefined;
}
