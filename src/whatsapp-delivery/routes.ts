import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import { reportP1 } from '../incident-handling/index.js';
import { debugWarn } from '../shared/observability/debug-log.js';
import type { Database, SqlClient } from '../shared/db/client.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { TraceEmitter } from '../shared/trace/index.js';
import { claimInboundMessage, enqueueInbound, processInboundFromQueue } from './queue-processor.js';
import {
  parseInboundMessage,
  parseStatusCallback,
  reconcileStatus,
  verifyTwilioSignature,
  WebhookSignatureError,
} from './webhook.js';

export interface RoutesOptions {
  db: Database;
  sql: SqlClient;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
  /**
   * Public-facing base URL the webhook is reachable at (e.g.
   * https://hogaan.onrender.com). Required because Twilio's signature is
   * computed over the FULL URL the webhook hit.
   */
  publicBaseUrl: string;
}

/**
 * Register the two Twilio webhook endpoints. Twilio POSTs application/x-www-
 * form-urlencoded payloads, so we register @fastify/formbody to parse them.
 *
 * Routes:
 *   POST /webhooks/twilio/inbound — user messages
 *   POST /webhooks/twilio/status  — message-status callbacks
 *
 * Both endpoints verify X-Twilio-Signature before processing. Signature
 * mismatch → 403, no further work.
 */
export async function registerWhatsAppRoutes(
  app: FastifyInstance,
  opts: RoutesOptions,
): Promise<void> {
  await app.register(formbody);

  // Helper: log via Fastify req.log.warn but never throw on failure. The
  // whole point of the debug branch is that nothing in instrumentation can
  // break the handler. If req.log itself is broken, fall through to the
  // no-pino debugWarn path. Scoped inside registerWhatsAppRoutes so it has
  // zero module-level surface.
  const safeReqWarn = (
    req: { log?: { warn?: (obj: object, msg: string) => void } },
    obj: object,
    msg: string,
  ): void => {
    try {
      if (req.log !== undefined && typeof req.log.warn === 'function') {
        req.log.warn(obj, msg);
        return;
      }
    } catch {
      /* fall through to debugWarn */
    }
    debugWarn('WEBHOOK', msg, obj as Record<string, unknown>);
  };

  app.post('/webhooks/twilio/inbound', async (req, reply) => {
    // ORIGINAL handler entry (do not touch — was firing reliably for weeks).
    const signature = req.headers['x-twilio-signature'];
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${opts.publicBaseUrl.replace(/\/$/, '')}/webhooks/twilio/inbound`;

    // DEBUG INSTRUMENTATION (debug/full-pipeline-instrumentation) —
    // INTENTIONALLY placed AFTER the known-good lines above. The previous
    // version put this as the first line of the handler, which created a
    // new failure surface at handler entry. Now it cannot prevent the
    // signature-verify path from running. safeReqWarn never throws.
    safeReqWarn(req, { traceId: req.id ?? 'unknown' }, 'WEBHOOK: handler entered');

    try {
      verifyTwilioSignature(
        app.config,
        typeof signature === 'string' ? signature : undefined,
        fullUrl,
        params,
      );
    } catch (err) {
      req.log.warn({ err }, 'twilio inbound signature verification failed');
      return reply.code(403).send({ error: 'signature_mismatch' });
    }

    const event = parseInboundMessage(params);
    if (event.kind !== 'inbound') {
      safeReqWarn(req, { kind: event.kind }, 'WEBHOOK: non-inbound event, returning 204');
      return reply.code(204).send();
    }
    // ORIGINAL info-level line — restored verbatim. Anyone grepping for
    // 'twilio inbound received' must keep finding it. The new WEBHOOK:
    // warn lines are ADDITIVE, not replacements.
    req.log.info(
      { waMessageId: event.waMessageId, hasMedia: event.mediaUrls.length > 0 },
      'twilio inbound received',
    );
    safeReqWarn(
      req,
      {
        waMessageId: event.waMessageId ?? 'unknown',
        hasMedia: event.mediaUrls?.length ?? 0 > 0,
      },
      'WEBHOOK: inbound parsed',
    );

    // Phase 11 R11 — webhook ack is decoupled from pipeline execution.
    //
    // Synchronous work in the request path (must complete before 204):
    //   1. Twilio signature verify (above) — failure is 403, not 204.
    //   2. Parse the inbound payload (above).
    //   3. Idempotency claim via Redis SETNX. Re-deliveries of the same
    //      MessageSid are dropped silently — Twilio retries on 5xx, but
    //      we don't want to double-process.
    //   4. Enqueue the payload for the background processor.
    //
    // The background processor (queue-processor.ts) runs the existing
    // routeInboundMessage pipeline asynchronously. Twilio gets its 204
    // in single-digit ms, regardless of LLM latency. Errors from the
    // processor land in a dead-letter queue (R22).
    let claimed = false;
    try {
      claimed = await claimInboundMessage(opts.redis, event.waMessageId);
    } catch (err) {
      reportP1(
        'inbound idempotency claim failed; dropping payload to avoid double-process',
        {
          source: 'inbound_webhook',
          tags: { inboundMessageSid: event.waMessageId, traceId: req.id },
        },
        err,
      );
      // Fail-closed: don't queue if we can't claim — Twilio will retry,
      // and we'd rather skip than risk double-processing on a stale claim.
      return reply.code(204).send();
    }
    if (!claimed) {
      req.log.info(
        { waMessageId: event.waMessageId },
        'inbound webhook duplicate (already claimed); ignoring',
      );
      return reply.code(204).send();
    }

    safeReqWarn(req, { waMessageId: event.waMessageId ?? 'unknown' }, 'WEBHOOK: about to enqueue');
    try {
      await enqueueInbound(opts.redis, {
        inboundMessageSid: event.waMessageId,
        fromE164: event.fromE164,
        body: event.body,
        mediaUrls: event.mediaUrls,
        receivedAtIso: event.receivedAt.toISOString(),
        traceId: req.id,
      });
      safeReqWarn(
        req,
        { waMessageId: event.waMessageId ?? 'unknown', status: 'success' },
        'WEBHOOK: enqueue returned',
      );
    } catch (err) {
      safeReqWarn(
        req,
        {
          waMessageId: event.waMessageId ?? 'unknown',
          status: 'failure',
          err: err instanceof Error ? err.message : String(err),
        },
        'WEBHOOK: enqueue returned',
      );
      reportP1(
        'inbound enqueue failed; payload dropped',
        {
          source: 'inbound_webhook',
          tags: { inboundMessageSid: event.waMessageId, traceId: req.id },
        },
        err,
      );
      return reply.code(204).send();
    }

    // Kick the background processor. Fire-and-forget; the processor is
    // bounded by an internal concurrency limiter so a burst can't
    // overwhelm the LLM API.
    setImmediate(() => {
      void processInboundFromQueue({
        config: app.config,
        db: opts.db,
        sql: opts.sql,
        redis: opts.redis,
        rateLimiters: opts.rateLimiters,
        traceEmitter: opts.traceEmitter,
      });
    });

    return reply.code(204).send();
  });

  app.post('/webhooks/twilio/status', async (req, reply) => {
    const signature = req.headers['x-twilio-signature'];
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${opts.publicBaseUrl.replace(/\/$/, '')}/webhooks/twilio/status`;

    try {
      verifyTwilioSignature(
        app.config,
        typeof signature === 'string' ? signature : undefined,
        fullUrl,
        params,
      );
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        req.log.warn({ msg: err.message }, 'twilio status signature verification failed');
      }
      return reply.code(403).send({ error: 'signature_mismatch' });
    }

    const event = parseStatusCallback(params);
    if (event.kind !== 'status') {
      // parseStatusCallback always returns kind:'status'; this is a defensive
      // narrowing gate for TS.
      return reply.code(204).send();
    }
    const result = await reconcileStatus(opts.db, event);
    req.log.info(
      {
        waMessageId: event.waMessageId,
        status: event.status,
        applied: result.applied,
        endEvent: result.endEvent,
      },
      'twilio status reconciled',
    );

    return reply.code(204).send();
  });
}
