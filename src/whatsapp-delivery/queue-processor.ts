import { reportP1 } from '../incident-handling/index.js';
import { recordEvidence } from '../shared/audit-evidence/index.js';
import type { Database, SqlClient } from '../shared/db/client.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { TraceEmitter } from '../shared/trace/index.js';
import { routeInboundMessage } from '../coaching/webhook-router.js';

/**
 * Phase 11 R11/R22 — inbound webhook queue processor.
 *
 * The inbound webhook handler enqueues a payload to Redis and returns 204
 * to Twilio immediately (per Risk 11). This module drains that queue in
 * the background — running the existing routeInboundMessage pipeline
 * with a bounded concurrency limit so a burst can't overwhelm the LLM
 * providers.
 *
 * Idempotency is established at the enqueue site (SETNX on
 * inbound:processed:{sid}). Items here have already won the
 * idempotency check.
 *
 * On unhandled error (R22): the item moves to a bounded dead-letter
 * queue with sanitized error context, reportP1 fires, and ops can
 * review via scripts/inspect-dead-letter.ts.
 */

export const INBOUND_QUEUE_KEY = 'inbound:processing:queue';
export const INBOUND_PROCESSED_KEY_PREFIX = 'inbound:processed:';
export const INBOUND_DEAD_LETTER_KEY = 'inbound:dead-letter:queue';

const PROCESSED_TTL_SECONDS = 24 * 60 * 60; // 24h
const DEAD_LETTER_MAX_LENGTH = 1000;
const MAX_CONCURRENCY = 10;

export interface QueueItem {
  inboundMessageSid: string;
  fromE164: string;
  body: string;
  mediaUrls: string[];
  receivedAtIso: string;
  traceId: string;
}

export interface DeadLetterItem extends QueueItem {
  errorMessage: string;
  errorName: string;
  failedAt: string;
}

export interface QueueProcessorDeps {
  config: AppConfig;
  db: Database;
  sql: SqlClient;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
}

let inFlight = 0;

/**
 * Returns true if the inbound MessageSid has not been seen before, OR
 * false if it has (Twilio retries the same SID; we honour idempotency).
 *
 * Implemented via SETNX with 24h TTL — two concurrent webhook hits
 * against the same SID produce exactly one true return. Fail-closed: on
 * Redis unavailability, returns false (skip processing) to avoid
 * double-handling. Caller logs P1 in that case.
 */
export async function claimInboundMessage(
  redis: RedisBundle,
  inboundMessageSid: string,
): Promise<boolean> {
  const key = `${INBOUND_PROCESSED_KEY_PREFIX}${inboundMessageSid}`;
  const result = (await redis.withTimeout('inbound:setnx', 1500, () =>
    redis.client.set(key, '1', { ex: PROCESSED_TTL_SECONDS, nx: true }),
  )) as unknown;
  // Upstash returns 'OK' on success, null when nx miss.
  return result === 'OK' || result === 'ok';
}

/**
 * Push a new payload onto the processing queue. LPUSH so the oldest
 * items are at the tail (RPOP'd first → FIFO).
 */
export async function enqueueInbound(redis: RedisBundle, item: QueueItem): Promise<void> {
  await redis.withTimeout('inbound:lpush', 1500, () =>
    redis.client.lpush(INBOUND_QUEUE_KEY, JSON.stringify(item)),
  );
}

/**
 * Drain one item from the queue and run the routing pipeline.
 *
 * Concurrency-limited at module level: at most MAX_CONCURRENCY items
 * may be in flight simultaneously. Excess kicks no-op until earlier
 * items finish — protects the LLM providers from a burst.
 *
 * Designed to be called from `setImmediate(...)` after enqueue. Also
 * safe to call from a periodic cron sweep for resilience against
 * dropped setImmediate kicks (e.g. process restart mid-burst).
 *
 * Fire-and-forget; never throws. Errors → reportP1 + dead-letter.
 */
export async function processInboundFromQueue(deps: QueueProcessorDeps): Promise<void> {
  if (inFlight >= MAX_CONCURRENCY) {
    return;
  }
  inFlight += 1;
  try {
    const raw = (await deps.redis.withTimeout('inbound:rpop', 1500, () =>
      deps.redis.client.rpop(INBOUND_QUEUE_KEY),
    )) as unknown;
    if (raw === null || raw === undefined) {
      return;
    }
    let item: QueueItem;
    try {
      item =
        typeof raw === 'string' ? (JSON.parse(raw) as QueueItem) : (raw as unknown as QueueItem);
    } catch (err) {
      const rawSnippet =
        typeof raw === 'string' ? raw.slice(0, 200) : JSON.stringify(raw).slice(0, 200);
      reportP1(
        'inbound queue payload not valid JSON; dropping',
        { source: 'inbound_webhook_processor', extra: { raw: rawSnippet } },
        err,
      );
      return;
    }

    const t0 = Date.now();
    try {
      const outcome = await routeInboundMessage(
        {
          config: deps.config,
          db: deps.db,
          sql: deps.sql,
          redis: deps.redis,
          rateLimiters: deps.rateLimiters,
          traceEmitter: deps.traceEmitter,
        },
        {
          fromE164: item.fromE164,
          body: item.body,
          mediaUrls: item.mediaUrls,
          inboundMessageSid: item.inboundMessageSid,
          receivedAt: new Date(item.receivedAtIso),
          traceId: item.traceId,
        },
      );
      await recordEvidence({
        testId: `phase-11/webhook-decouple/${item.inboundMessageSid}`,
        controlId: 'T2.WebhookDecouple.PipelineProcessed',
        tier: 'T2',
        outcome: 'pass',
        description: `Inbound queue item processed via background processor; webhook ack was already returned to Twilio.`,
        details: {
          inboundMessageSid: item.inboundMessageSid,
          outcomeKind: outcome.kind,
          pipelineLatencyMs: Date.now() - t0,
        },
      });
    } catch (err) {
      await handleProcessingFailure(deps.redis, item, err);
    }
  } finally {
    inFlight -= 1;
  }

  // If we drained one and there could be more, kick another worker
  // immediately (still bounded by MAX_CONCURRENCY).
  if (inFlight < MAX_CONCURRENCY) {
    setImmediate(() => {
      void processInboundFromQueue(deps);
    });
  }
}

async function handleProcessingFailure(
  redis: RedisBundle,
  item: QueueItem,
  err: unknown,
): Promise<void> {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorName = err instanceof Error ? err.name : 'unknown';
  const phoneHashPrefix = item.fromE164.slice(0, 4); // not the hash, but the +254 prefix — never the full number
  void phoneHashPrefix;

  reportP1(
    'inbound queue processing failed; payload moved to dead-letter',
    {
      source: 'inbound_webhook_processor',
      tags: { inboundMessageSid: item.inboundMessageSid, traceId: item.traceId },
      extra: { errorMessage, errorName },
    },
    err,
  );

  const deadItem: DeadLetterItem = {
    ...item,
    errorMessage,
    errorName,
    failedAt: new Date().toISOString(),
  };

  try {
    await redis.withTimeout('inbound:dl-push', 1500, () =>
      redis.client.lpush(INBOUND_DEAD_LETTER_KEY, JSON.stringify(deadItem)),
    );
    // Bound the dead-letter queue length.
    await redis.withTimeout('inbound:dl-trim', 1500, () =>
      redis.client.ltrim(INBOUND_DEAD_LETTER_KEY, 0, DEAD_LETTER_MAX_LENGTH - 1),
    );
    await recordEvidence({
      testId: `phase-11/dead-letter/${item.inboundMessageSid}`,
      controlId: 'T2.DeadLetter.QueuedForReview',
      tier: 'T2',
      outcome: 'pass',
      description: 'Failed inbound payload landed in dead-letter queue for ops triage.',
      details: {
        inboundMessageSid: item.inboundMessageSid,
        errorName,
      },
    });
  } catch (dlErr) {
    reportP1(
      'dead-letter push failed; payload lost',
      {
        source: 'inbound_webhook_processor',
        tags: { inboundMessageSid: item.inboundMessageSid },
      },
      dlErr,
    );
  }
}

/** Test seam — reset module state between integration tests. */
export function _resetQueueProcessorForTests(): void {
  inFlight = 0;
}
