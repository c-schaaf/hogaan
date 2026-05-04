import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import { getRedis } from '../shared/redis/client.js';
import { buildRateLimiters } from '../shared/redis/rate-limit.js';
import { buildTraceEmitter } from '../shared/trace/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { registerWhatsAppRoutes } from './routes.js';

/**
 * Wire the Twilio webhook routes onto the running Fastify instance.
 *
 * Called from `src/index.ts main()` after `buildApp()`. Skips registration
 * silently when DATABASE_URL or PUBLIC_BASE_URL is missing — the dev server
 * still boots, just without the webhook endpoints. Production must have both
 * set or the wiring no-ops and Twilio will get 404s.
 *
 * Builds the cross-cutting deps (db pool, redis, rate-limiters, trace
 * emitter) here rather than threading them through buildApp(); they are
 * webhook-only concerns.
 */
export async function wireWhatsAppDeliveryRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<{ registered: boolean; reason?: string }> {
  if (config.databaseUrl === undefined) {
    return { registered: false, reason: 'DATABASE_URL not configured' };
  }
  if (config.publicBaseUrl === undefined) {
    return { registered: false, reason: 'PUBLIC_BASE_URL not configured' };
  }
  if (config.upstashRedisRestUrl === undefined || config.upstashRedisRestToken === undefined) {
    return { registered: false, reason: 'UPSTASH_REDIS_REST_URL/_TOKEN not configured' };
  }

  const { db, sql } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 50,
  });
  const traceEmitter = buildTraceEmitter(config);

  await registerWhatsAppRoutes(app, {
    db,
    sql,
    redis,
    rateLimiters,
    traceEmitter,
    publicBaseUrl: config.publicBaseUrl,
  });
  return { registered: true };
}
