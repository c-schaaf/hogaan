import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../shared/db/client.js';
import {
  parseInboundMessage,
  parseStatusCallback,
  reconcileStatus,
  verifyTwilioSignature,
  WebhookSignatureError,
} from './webhook.js';

export interface RoutesOptions {
  db: Database;
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
    if (event.kind === 'inbound') {
      req.log.info(
        { waMessageId: event.waMessageId, hasMedia: event.mediaUrls.length > 0 },
        'twilio inbound received',
      );
    }

    // Phase 6/7 will wire this to identity → coaching. For Phase 3 we ack
    // the webhook so Twilio doesn't retry, and store nothing — the inbound
    // message_log row gets written when Process #12 resolves identity.
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
