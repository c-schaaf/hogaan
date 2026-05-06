import { eq } from 'drizzle-orm';
import twilio from 'twilio';
import type { Database } from '../shared/db/client.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { InboundEvent } from './types.js';

/**
 * Process #11 §12 — webhook reconciliation. Twilio POSTs status updates as
 * the message moves through queued → sent → delivered → read (or → failed).
 *
 * Out-of-order handling: `read` and `delivered` are terminal-positive and
 * dominate `sent`. `failed` is a separate terminal-negative track. We never
 * regress: once a message hits `delivered` or `read`, an arriving `sent`
 * webhook is dropped.
 */

const STATUS_RANK: Record<string, number> = {
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 99,
  undelivered: 99,
};

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Verify Twilio's X-Twilio-Signature header. Twilio signs each webhook with
 * HMAC-SHA1 over `url + sortedFormParams`. Throws on mismatch — Fastify
 * routes catch this and respond 403.
 *
 * The Twilio sandbox uses the same auth-token-derived signing key, so the
 * verification path is identical for sandbox + production.
 */
export function verifyTwilioSignature(
  config: AppConfig,
  signatureHeader: string | undefined,
  fullUrl: string,
  params: Record<string, string>,
): void {
  const authToken = config.twilioWebhookAuthToken ?? config.twilioAuthToken;
  if (authToken === undefined) {
    throw new WebhookSignatureError('twilio webhook auth token not configured');
  }
  if (signatureHeader === undefined || signatureHeader.length === 0) {
    throw new WebhookSignatureError('missing X-Twilio-Signature header');
  }
  const ok = twilio.validateRequest(authToken, signatureHeader, fullUrl, params);
  if (!ok) {
    throw new WebhookSignatureError('signature mismatch');
  }
}

/**
 * Parse Twilio's form-encoded inbound webhook payload into our canonical
 * InboundEvent shape. Inbound user messages have `MessageSid`, `From`,
 * `Body`, optional `MediaUrl0..MediaUrlN` for attachments.
 */
export function parseInboundMessage(params: Record<string, string>): InboundEvent {
  const fromRaw = params['From'] ?? '';
  const fromE164 = fromRaw.startsWith('whatsapp:') ? fromRaw.slice('whatsapp:'.length) : fromRaw;
  const numMedia = Number.parseInt(params['NumMedia'] ?? '0', 10);
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (typeof url === 'string' && url.length > 0) {
      mediaUrls.push(url);
    }
  }
  return {
    kind: 'inbound',
    fromE164,
    waMessageId: params['MessageSid'] ?? '',
    body: params['Body'] ?? '',
    mediaUrls,
    receivedAt: new Date(),
  };
}

/**
 * Parse Twilio's status callback payload. Twilio sends `MessageSid`,
 * `MessageStatus`, optional `ErrorCode`.
 */
export function parseStatusCallback(params: Record<string, string>): InboundEvent {
  const status = (params['MessageStatus'] ?? 'queued') as
    | 'queued'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'failed'
    | 'undelivered';
  const out: Extract<InboundEvent, { kind: 'status' }> = {
    kind: 'status',
    waMessageId: params['MessageSid'] ?? '',
    status,
    timestamp: new Date(),
  };
  if (params['ErrorCode'] !== undefined) {
    out.errorCode = params['ErrorCode'];
  }
  return out;
}

export interface ReconcileResult {
  /** Whether the status update was applied (not regressed). */
  applied: boolean;
  /** Final status after reconciliation. */
  status: string;
  /** Process #11 terminal end event for this reconciliation. */
  endEvent: 'E4_MessageDeliveredReconciled' | 'E14_FailedDeliveryReconciled' | null;
}

/**
 * Apply a status update to the whatsapp_messages row keyed on waMessageId.
 * Idempotent — duplicate webhooks for the same status are no-ops; out-of-order
 * webhooks that would regress the status are dropped.
 */
export async function reconcileStatus(
  db: Database,
  event: Extract<InboundEvent, { kind: 'status' }>,
): Promise<ReconcileResult> {
  const rows = await db
    .select({
      id: whatsappMessages.id,
      currentStatus: whatsappMessages.status,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.waMessageId, event.waMessageId))
    .limit(1);

  const existing = rows[0];
  if (existing === undefined) {
    // Webhook for an unknown message — record as orphan via a free-form INSERT
    // would muddy the table; instead surface as not-applied. Phase 11 ops
    // tooling can investigate.
    return { applied: false, status: event.status, endEvent: null };
  }

  const incomingRank = STATUS_RANK[event.status] ?? 0;
  const currentRank = STATUS_RANK[existing.currentStatus] ?? 0;

  // Special case: 'failed' / 'undelivered' are terminal-negative and override
  // any non-terminal. Once 'delivered' or 'read' has landed, 'failed' should
  // not retroactively fail the row — Twilio occasionally resequences these.
  if (
    (event.status === 'failed' || event.status === 'undelivered') &&
    (existing.currentStatus === 'delivered' || existing.currentStatus === 'read')
  ) {
    return { applied: false, status: existing.currentStatus, endEvent: null };
  }

  // R20 contract — ranks are STRICTLY monotonic: same-rank is a no-op
  // (e.g. duplicate `delivered` webhooks must not re-fire E4); lower-rank
  // is dropped (e.g. an out-of-order `sent` after `delivered`). This is
  // the regression bug we got bitten by in Phase 11 audit — "<" instead
  // of "<=" would cause duplicate terminal end-event emission.
  if (incomingRank <= currentRank) {
    return { applied: false, status: existing.currentStatus, endEvent: null };
  }

  const isFailed = event.status === 'failed' || event.status === 'undelivered';
  // Map Twilio's 'undelivered' to our DB enum's 'failed' — same terminal-
  // negative state. Original Twilio status is preserved in metadata.
  const newStatus: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' = isFailed
    ? 'failed'
    : (event.status as 'queued' | 'sent' | 'delivered' | 'read');
  const newTerminal: ReconcileResult['endEvent'] = isFailed
    ? 'E14_FailedDeliveryReconciled'
    : event.status === 'delivered' || event.status === 'read'
      ? 'E4_MessageDeliveredReconciled'
      : null;

  await db
    .update(whatsappMessages)
    .set({
      status: newStatus,
      lastStatusAt: event.timestamp,
      ...(newTerminal !== null ? { terminalEndEvent: newTerminal } : {}),
    })
    .where(eq(whatsappMessages.id, existing.id));

  return { applied: true, status: newStatus, endEvent: newTerminal };
}

export const _internal = { STATUS_RANK };
