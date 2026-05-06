import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { handleOnboardingMessage } from '../onboarding/index.js';
import { OPT_OUT_CONFIRMATION } from '../onboarding/messages.js';
import { isOptOutMessage, recordOptOut } from '../onboarding/opt-out.js';
import { resolveIdentity, type IdentityResult } from '../identity/index.js';
import { reportP1, reportP2 } from '../incident-handling/index.js';
import { hashPhone } from '../shared/db/encryption.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import type { Database, SqlClient } from '../shared/db/client.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import {
  asCorrelationId,
  asPhoneE164,
  asUserId,
  type UserId,
} from '../shared/types/index.js';
import type { TraceEmitter } from '../shared/trace/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import { runCoachingTurn } from './orchestrator.js';
import type { CoachingTurnResult } from './types.js';
import type { OnboardingResult } from '../onboarding/types.js';

interface RouteDeps {
  config: AppConfig;
  db: Database;
  sql: SqlClient;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
}

export interface InboundWebhookEvent {
  fromE164: string;
  body: string;
  mediaUrls: string[];
  inboundMessageSid: string;
  receivedAt: Date;
  /** Trace ID — Fastify request ID propagated from the webhook handler. */
  traceId: string;
}

export type RouteOutcome =
  | { kind: 'coaching'; result: CoachingTurnResult }
  | { kind: 'onboarding'; result: OnboardingResult }
  | { kind: 'opted_out'; reason: string }
  | { kind: 'noop'; reason: string };

/**
 * Inbound webhook entry point. Wires:
 *   1. Identity resolution (Process #12) — phone path, audit fail-closed.
 *   2. Inbound message_log row (so the 24h customer-service window check
 *      passes for our outbound replies).
 *   3. Routing by user.status: onboarded → Coaching (Process #2), else
 *      Onboarding (Process #1). Suppressed/blocked → noop.
 *
 * Trace propagation: the Fastify request ID is the traceId and flows into
 * both Onboarding and Coaching turn traces.
 */
export async function routeInboundMessage(
  deps: RouteDeps,
  event: InboundWebhookEvent,
): Promise<RouteOutcome> {
  // Step 1: identity (audit-fail-closed if it throws — caller surfaces 500)
  let identity: IdentityResult;
  try {
    identity = await resolveIdentity(
      {
        config: deps.config,
        sql: deps.sql,
        db: deps.db,
        redis: deps.redis,
      },
      {
        triggerSource: 'whatsapp',
        phoneNumber: event.fromE164,
        inboundMessageId: event.inboundMessageSid,
        requestId: event.traceId,
      },
    );
  } catch (err) {
    // Audit-fail-closed (E11) is the only throw path; log + bail.
    reportP1(
      'inbound webhook: identity audit-fail-closed',
      {
        source: 'Process_2.WebhookRouter.Identity',
        extra: { traceId: event.traceId, inboundMessageSid: event.inboundMessageSid },
      },
      err,
    );
    return { kind: 'noop', reason: 'identity audit-fail-closed' };
  }

  if (
    identity.endEvent === 'E5_SuppressedUser' ||
    identity.endEvent === 'E6_BlockedUser' ||
    identity.endEvent === 'E7_MalformedPhoneNumber' ||
    identity.endEvent === 'E10_IdentityServiceUnavailable'
  ) {
    reportP2('inbound webhook: identity not actionable', {
      source: 'Process_2.WebhookRouter.Identity',
      tags: { endEvent: identity.endEvent },
    });
    return { kind: 'noop', reason: identity.endEvent };
  }

  // E8 (concurrent rejected) is a transient — caller (Twilio) will not retry
  // automatically, but the user is welcome to send again.
  if (identity.endEvent === 'E8_ConcurrentRequestRejected') {
    return { kind: 'noop', reason: 'concurrent identity request rejected' };
  }

  // E9 (web session invalid) doesn't apply on the WhatsApp path; defensive.
  if (identity.endEvent === 'E9_WebSessionInvalid') {
    return { kind: 'noop', reason: 'web session invalid (unexpected on whatsapp path)' };
  }

  // E1 / E2 / E3 — we have a userId. Continue.
  if (
    identity.endEvent !== 'E1_ExistingUserAuthenticated' &&
    identity.endEvent !== 'E2_NewUserProvisioned' &&
    identity.endEvent !== 'E3_ResumeOnboardingDetected'
  ) {
    return { kind: 'noop', reason: `unexpected identity endEvent: ${identity.endEvent}` };
  }

  const userId = identity.userId;
  const phoneHash = hashPhone(event.fromE164);

  // Step 2: write inbound row to message_log so subsequent outbound passes
  // the 24h customer-service-window check.
  await writeInboundLog(deps.db, userId, event);

  // Phase 12 R17 — global STOP keyword. Honored at webhook-router scope so
  // it fires for ALL inbound regardless of user state (onboarded, mid-onboarding,
  // mid-scenario, etc). The onboarding orchestrator's own isOptOutMessage check
  // remains as defense-in-depth.
  if (isOptOutMessage(event.body)) {
    try {
      await recordOptOut(deps.db, deps.redis, userId, phoneHash);
    } catch (err) {
      reportP1(
        'global opt-out: recordOptOut failed',
        {
          source: 'Process_2.WebhookRouter.OptOut',
          extra: { userId, traceId: event.traceId },
        },
        err,
      );
    }
    try {
      await sendOutbound(
        {
          config: deps.config,
          db: deps.db,
          redis: deps.redis,
          rateLimiters: deps.rateLimiters,
          ownerId: 'opt-out',
        },
        {
          correlationId: asCorrelationId(`optout-${event.inboundMessageSid}-${randomUUID().slice(0, 6)}`),
          callerProcessId: 'webhook-router:opt-out',
          phoneE164: asPhoneE164(event.fromE164),
          userId,
          messageType: 'FreeForm',
          priority: 'High',
          body: OPT_OUT_CONFIRMATION,
        },
      );
    } catch (err) {
      reportP2(
        'global opt-out: confirmation send failed (non-fatal)',
        {
          source: 'Process_2.WebhookRouter.OptOut',
          extra: { userId, traceId: event.traceId },
        },
        err,
      );
    }
    return { kind: 'opted_out', reason: 'global stop keyword' };
  }

  // Step 3: route by status. New users + resumes → onboarding. Onboarded
  // (E1 with status='onboarded') → coaching.
  if (
    identity.endEvent === 'E2_NewUserProvisioned' ||
    identity.endEvent === 'E3_ResumeOnboardingDetected' ||
    identity.status === 'provisional' ||
    identity.status === 'onboarding_started' ||
    identity.status === 'onboarding_dormant'
  ) {
    const onbResult = await handleOnboardingMessage(
      {
        config: deps.config,
        db: deps.db,
        redis: deps.redis,
        rateLimiters: deps.rateLimiters,
      },
      {
        userId,
        phoneHash,
        phoneE164: event.fromE164,
        body: event.body,
        receivedAt: event.receivedAt,
        inboundMessageId: event.inboundMessageSid,
      },
    );
    return { kind: 'onboarding', result: onbResult };
  }

  if (identity.status === 'onboarded') {
    const coachResult = await runCoachingTurn(
      {
        config: deps.config,
        db: deps.db,
        redis: deps.redis,
        rateLimiters: deps.rateLimiters,
        traceEmitter: deps.traceEmitter,
      },
      {
        userId,
        phoneE164: asPhoneE164(event.fromE164),
        phoneHash,
        body: event.body,
        mediaUrls: event.mediaUrls,
        inboundMessageId: event.inboundMessageSid,
        receivedAt: event.receivedAt,
        traceId: event.traceId,
      },
    );
    return { kind: 'coaching', result: coachResult };
  }

  return { kind: 'noop', reason: `user status not actionable: ${String(identity.status)}` };
}

async function writeInboundLog(
  db: Database,
  userId: UserId,
  event: InboundWebhookEvent,
): Promise<void> {
  try {
    // Idempotency: if a row with this MessageSid already exists, skip. Twilio
    // occasionally retries webhooks; we don't want duplicate inbound rows.
    const existing = await db
      .select({ id: whatsappMessages.id })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.waMessageId, event.inboundMessageSid))
      .limit(1);
    if (existing[0] !== undefined) {
      return;
    }
    await db.insert(whatsappMessages).values({
      correlationId: `inbound-${event.inboundMessageSid}-${randomUUID().slice(0, 8)}`,
      callerProcessId: 'inbound-webhook',
      userId,
      direction: 'inbound',
      messageType: 'free_form',
      contentText: event.body,
      priority: 'Normal',
      status: 'sent',
      waMessageId: event.inboundMessageSid,
      lastStatusAt: event.receivedAt,
      metadata: { mediaUrls: event.mediaUrls },
    });
  } catch (err) {
    reportP2(
      'inbound webhook: message_log insert failed (non-fatal)',
      {
        source: 'Process_2.WebhookRouter.MessageLog',
        extra: { traceId: event.traceId, userId },
      },
      err,
    );
  }
}

/** Re-export resolveIdentity to make the router self-contained for callers. */
export { asUserId };
