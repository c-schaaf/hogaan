import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import { routeInboundMessage } from '../coaching/webhook-router.js';
import type { Database, SqlClient } from '../shared/db/client.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { TraceEmitter } from '../shared/trace/index.js';
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

  app.post('/webhooks/twilio/inbound', async (req, reply) => {
    const signature = req.headers['x-twilio-signature'];
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${opts.publicBaseUrl.replace(/\/$/, '')}/webhooks/twilio/inbound`;

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
      return reply.code(204).send();
    }
    req.log.info(
      { waMessageId: event.waMessageId, hasMedia: event.mediaUrls.length > 0 },
      'twilio inbound received',
    );

    // Phase 7: dispatch through identity → onboarding/coaching. The webhook
    // returns 204 immediately after the routing call so Twilio doesn't retry;
    // any internal errors are reported as P1 incidents but never bubble to
    // Twilio. Outbound replies are dispatched separately by the
    // orchestrator via Process #11.
    try {
      const outcome = await routeInboundMessage(
        {
          config: app.config,
          db: opts.db,
          sql: opts.sql,
          redis: opts.redis,
          rateLimiters: opts.rateLimiters,
          traceEmitter: opts.traceEmitter,
        },
        {
          fromE164: event.fromE164,
          body: event.body,
          mediaUrls: event.mediaUrls,
          inboundMessageSid: event.waMessageId,
          receivedAt: event.receivedAt,
          traceId: req.id,
        },
      );
      req.log.info(
        { outcome: outcome.kind, reason: 'reason' in outcome ? outcome.reason : undefined },
        'inbound webhook routed',
      );
    } catch (err) {
      req.log.error({ err }, 'inbound webhook routing failed');
    }

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
