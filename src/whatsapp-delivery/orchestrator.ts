import type { Database } from '../shared/db/client.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import {
  acquire,
  IdempotencyStoreUnavailableError,
  lookup,
  markFailed,
  markSent,
} from '../shared/idempotency/index.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { RedisBundle } from '../shared/redis/client.js';
import { type AppConfig } from '../shared/secrets/config.js';
import { checkRateLimit, type RateLimiters } from '../shared/redis/rate-limit.js';
import { checkSuppression, type SuppressionStatus } from '../shared/redis/suppression.js';
import { hashPhone } from '../shared/db/encryption.js';
import {
  DispatchAuthError,
  DispatchPermanentError,
  DispatchRateLimitError,
  DispatchTimeoutError,
  DispatchTransientError,
  dispatchToTwilio,
} from './dispatch.js';
import { validateTemplate } from './templates.js';
import {
  WhatsAppRequestValidationError,
  type OutboundRequest,
  type OutboundResult,
} from './types.js';
import { validateOutboundRequest } from './validate.js';
import { checkWindowByUserId } from './window.js';

interface Deps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  /** Process identifier for idempotency ownership; defaults to env-derived. */
  ownerId?: string;
}

const TRANSIENT_RETRIES = 3;
const TRANSIENT_BACKOFF_MS = 3000;

/**
 * Process #11 sendOutbound — the outbound chokepoint. Implements the full
 * BPMN: validate → idempotency lookup → suppression (fail-closed) →
 * 24h window → template validation → rate limit → idempotency acquire
 * (fail-closed) → Twilio dispatch (5s, 3 retries on transient) → record
 * receipt → return one of 15 terminal end events.
 *
 * The orchestrator does NOT throw for terminal events; every outcome
 * returns an OutboundResult. Throws only on programming bugs.
 */
export async function sendOutbound(deps: Deps, rawRequest: unknown): Promise<OutboundResult> {
  // ---- Step 1: validate ------------------------------------------------
  let request: OutboundRequest;
  try {
    request = validateOutboundRequest(rawRequest);
  } catch (err) {
    return {
      endEvent: 'E6_MalformedRequest',
      dispatchPath: 'failed',
      retryCount: 0,
      queueLoops: 0,
      reason: err instanceof WhatsAppRequestValidationError ? err.message : 'invalid request',
    };
  }

  const ownerId = deps.ownerId ?? `pid:${process.pid}`;
  const phoneHash = hashPhone(request.phoneE164);

  // ---- Step 2: idempotency lookup -------------------------------------
  try {
    const lookedUp = await lookup(deps.redis, request.correlationId);
    if (lookedUp.state === 'sent') {
      return {
        endEvent: 'E5_DuplicateRequest',
        dispatchPath: 'duplicate',
        retryCount: 0,
        queueLoops: 0,
        ...(lookedUp.record?.receiptId !== undefined
          ? { waMessageId: lookedUp.record.receiptId }
          : {}),
        reason: 'already_sent',
      };
    }
    if (lookedUp.state === 'dispatching') {
      return {
        endEvent: 'E5_DuplicateRequest',
        dispatchPath: 'duplicate',
        retryCount: 0,
        queueLoops: 0,
        reason: 'in_flight',
      };
    }
    // 'failed' or 'absent' fall through.
  } catch (err) {
    if (err instanceof IdempotencyStoreUnavailableError) {
      return failClosedIdem(err, 'lookup');
    }
    throw err;
  }

  // ---- Step 3: suppression + block (fail-closed) ----------------------
  let suppression: SuppressionStatus;
  try {
    suppression = await checkSuppression(deps.redis, phoneHash);
  } catch (err) {
    return failClosedIdem(err, 'suppression');
  }
  if (suppression !== 'clean') {
    return {
      endEvent: 'E7_SuppressedRecipient',
      dispatchPath: 'failed',
      retryCount: 0,
      queueLoops: 0,
      reason: suppression === 'blocked' ? 'recipient_blocked' : 'recipient_opted_out',
    };
  }

  // ---- Step 4: 24h customer-service-window ----------------------------
  if (request.messageType === 'FreeForm' && request.userId !== undefined) {
    const window = await checkWindowByUserId(deps.db, request.userId);
    if (window === 'closed') {
      return {
        endEvent: 'E8_WindowClosedFreeFormBlocked',
        dispatchPath: 'failed',
        retryCount: 0,
        queueLoops: 0,
        reason: 'window_closed_freeform_blocked',
      };
    }
  }

  // ---- Step 5: template validation ------------------------------------
  if (request.messageType === 'Template') {
    const tres = validateTemplate(request.templateName ?? '', request.templateParams);
    if (!tres.ok) {
      return {
        endEvent: 'E9_TemplateInvalid',
        dispatchPath: 'failed',
        retryCount: 0,
        queueLoops: 0,
        reason: `template_${tres.reason}`,
      };
    }
  }

  // ---- Step 6: rate limit ---------------------------------------------
  let rateDecision;
  try {
    rateDecision = await checkRateLimit(
      deps.rateLimiters,
      'global',
      `user:${phoneHash}`,
      request.priority,
    );
  } catch {
    // Per Process #11 §6 fail-open: PROCEED if the limiter itself errors.
    rateDecision = { decision: 'PROCEED' as const };
  }

  if (rateDecision.decision === 'REJECT') {
    if (request.priority === 'Critical') {
      reportIncident('P1', 'critical-priority outbound rejected by per-day limit', {
        source: 'Process_11.Step_6_RateLimit',
        tags: { priority: 'Critical' },
        extra: { correlationId: request.correlationId },
      });
    }
    return {
      endEvent: 'E10_RateLimitExceeded',
      dispatchPath: 'failed',
      retryCount: 0,
      queueLoops: 0,
      reason: `rate_${rateDecision.reason}`,
    };
  }
  if (rateDecision.decision === 'QUEUE') {
    return {
      endEvent: 'E3_MessageDispatchedQueued',
      dispatchPath: 'queued',
      retryCount: 0,
      queueLoops: 1,
      reason: `queued_${rateDecision.reason}_retry_${rateDecision.retryAfterMs}ms`,
    };
  }

  // ---- Step 7: idempotency acquire (fail-closed) ----------------------
  let acquireRes;
  try {
    acquireRes = await acquire(deps.redis, request.correlationId, ownerId);
  } catch (err) {
    if (err instanceof IdempotencyStoreUnavailableError) {
      return failClosedIdem(err, 'acquire');
    }
    throw err;
  }
  if (!acquireRes.acquired) {
    return {
      endEvent: 'E5_DuplicateRequest',
      dispatchPath: 'duplicate',
      retryCount: 0,
      queueLoops: 0,
      ...(acquireRes.existing?.receiptId !== undefined
        ? { waMessageId: acquireRes.existing.receiptId }
        : {}),
      reason: 'race_lost_to_concurrent_worker',
    };
  }

  // ---- Step 8: Twilio dispatch (with retries on transient) ------------
  let dispatchOutcome:
    | { kind: 'success'; waMessageId: string }
    | { kind: 'fail'; result: OutboundResult };
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const r = await dispatchToTwilio(deps.config, request);
      dispatchOutcome = { kind: 'success', waMessageId: r.waMessageId };
      break;
    } catch (err) {
      if (err instanceof DispatchAuthError) {
        await safeMarkFailed(deps.redis, request.correlationId, ownerId);
        reportIncident(
          'P0',
          'twilio account suspended or auth failed',
          { source: 'Process_11.Step_8_APIDispatch', tags: { error: 'auth' } },
          err,
        );
        dispatchOutcome = {
          kind: 'fail',
          result: {
            endEvent: 'E11_AccountSuspended',
            dispatchPath: 'failed',
            retryCount: attempt - 1,
            queueLoops: 0,
            reason: 'twilio_auth_failure',
          },
        };
        break;
      }
      if (err instanceof DispatchPermanentError) {
        await safeMarkFailed(deps.redis, request.correlationId, ownerId);
        dispatchOutcome = {
          kind: 'fail',
          result: {
            endEvent: 'E12_PermanentDeliveryFailure',
            dispatchPath: 'failed',
            retryCount: attempt - 1,
            queueLoops: 0,
            reason: `twilio_permanent_${err.status}_${err.twilioCode ?? 'unknown'}`,
          },
        };
        break;
      }
      if (err instanceof DispatchRateLimitError) {
        // 429 from Twilio's API rate limit. The BPMN loops back to our
        // internal rate limiter; for MVP we surface as queued.
        await safeMarkFailed(deps.redis, request.correlationId, ownerId);
        dispatchOutcome = {
          kind: 'fail',
          result: {
            endEvent: 'E10_RateLimitExceeded',
            dispatchPath: 'queued',
            retryCount: attempt - 1,
            queueLoops: 0,
            reason: 'twilio_api_rate_limit',
          },
        };
        break;
      }
      if (err instanceof DispatchTimeoutError || err instanceof DispatchTransientError) {
        if (attempt < TRANSIENT_RETRIES) {
          await sleep(TRANSIENT_BACKOFF_MS);
          continue;
        }
        await safeMarkFailed(deps.redis, request.correlationId, ownerId);
        dispatchOutcome = {
          kind: 'fail',
          result: {
            endEvent: 'E13_TransientFailureExhausted',
            dispatchPath: 'failed',
            retryCount: attempt,
            queueLoops: 0,
            reason:
              err instanceof DispatchTimeoutError
                ? 'twilio_timeout_exhausted'
                : `twilio_transient_${err.status}_exhausted`,
          },
        };
        break;
      }
      // Unknown error → fail-closed.
      await safeMarkFailed(deps.redis, request.correlationId, ownerId);
      throw err;
    }
  }

  if (dispatchOutcome.kind === 'fail') {
    await recordOutboundLog(deps.db, request, undefined, dispatchOutcome.result);
    return dispatchOutcome.result;
  }

  const { waMessageId } = dispatchOutcome;

  // ---- Step 9: record receipt -----------------------------------------
  const dispatchedAt = new Date();
  try {
    await markSent(deps.redis, request.correlationId, ownerId, waMessageId, {
      dispatchedAt: dispatchedAt.toISOString(),
    });
  } catch (err) {
    // Process #11 §9 fail-open: log, do NOT unwind. Message is sent.
    reportIncident(
      'P1',
      'idempotency markSent failed after successful dispatch',
      {
        source: 'Process_11.Step_9_RecordReceipt',
        extra: { correlationId: request.correlationId, waMessageId },
      },
      err,
    );
  }

  const endEvent = attempt > 1 ? 'E2_MessageDispatchedAfterRetry' : 'E1_MessageDispatched';
  const result: OutboundResult = {
    endEvent,
    waMessageId,
    dispatchPath: attempt > 1 ? 'after-retry' : 'direct',
    retryCount: attempt - 1,
    queueLoops: 0,
  };

  // ---- Step 9 (cont): write delivery log ------------------------------
  await recordOutboundLog(deps.db, request, dispatchedAt, result);

  // ---- Steps 10–11: webhook reconciliation is correlated via wa_message_id
  // in the whatsapp_messages row. There is no separate correlation store —
  // the durable DB record IS the join key. Step 11 (notify caller) is
  // implicit: the OutboundResult IS the notification.

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recordOutboundLog(
  db: Database,
  request: OutboundRequest,
  dispatchedAt: Date | undefined,
  result: OutboundResult,
): Promise<void> {
  try {
    await db.insert(whatsappMessages).values({
      correlationId: request.correlationId,
      callerProcessId: request.callerProcessId,
      ...(request.userId !== undefined ? { userId: request.userId } : {}),
      direction: 'outbound',
      messageType: request.messageType === 'FreeForm' ? 'free_form' : 'template',
      ...(request.templateName !== undefined ? { templateName: request.templateName } : {}),
      ...(request.templateParams !== undefined ? { templateParams: request.templateParams } : {}),
      ...(request.body !== undefined ? { contentText: request.body } : {}),
      priority: request.priority,
      status: dispatchedAt !== undefined ? 'sent' : 'failed',
      ...(result.waMessageId !== undefined ? { waMessageId: result.waMessageId } : {}),
      lastStatusAt: dispatchedAt ?? new Date(),
      ...(dispatchedAt !== undefined ? { dispatchedAt } : {}),
      terminalEndEvent: result.endEvent,
      metadata: {
        retryCount: result.retryCount,
        queueLoops: result.queueLoops,
        dispatchPath: result.dispatchPath,
        reason: result.reason,
      },
    });
  } catch (err) {
    // Fail-open per §9: log but do not fail the dispatch.
    reportIncident(
      'P1',
      'whatsapp_messages insert failed after dispatch outcome',
      {
        source: 'Process_11.Step_9_RecordReceipt',
        extra: { correlationId: request.correlationId, endEvent: result.endEvent },
      },
      err,
    );
  }
}

function failClosedIdem(err: unknown, op: string): OutboundResult {
  reportIncident(
    'P0',
    `idempotency store unavailable at ${op}`,
    { source: 'Process_11.Step_2_or_7_Idempotency', tags: { op } },
    err,
  );
  return {
    endEvent: 'E15_IdempotencyStoreFailure',
    dispatchPath: 'failed',
    retryCount: 0,
    queueLoops: 0,
    reason: `idempotency_${op}_unavailable`,
  };
}

async function safeMarkFailed(
  redis: RedisBundle,
  correlationId: string,
  ownerId: string,
): Promise<void> {
  try {
    await markFailed(redis, correlationId, ownerId);
  } catch {
    // Already in a failure path — don't escalate further.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') {
      t.unref();
    }
  });
}
