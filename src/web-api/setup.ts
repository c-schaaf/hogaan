import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import { getRedis } from '../shared/redis/client.js';
import { buildRateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { buildTraceEmitter } from '../shared/trace/index.js';
import { registerWebApiRoutes } from './routes.js';

/**
 * Phase C wiring. Mirrors web-auth/setup.ts and whatsapp-delivery/setup.ts.
 * Same gating as web-auth (DB + Redis + JWT + base URL) plus the rate-
 * limiter + trace emitter the coaching orchestrator needs.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature kept symmetric with other setup helpers
export async function wireWebApiRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<{ registered: boolean; reason?: string }> {
  if (config.databaseUrl === undefined) {
    return { registered: false, reason: 'DATABASE_URL not configured' };
  }
  if (config.upstashRedisRestUrl === undefined || config.upstashRedisRestToken === undefined) {
    return { registered: false, reason: 'UPSTASH_REDIS_REST_URL/_TOKEN not configured' };
  }
  if (config.jwtSecretBase64 === undefined) {
    return { registered: false, reason: 'JWT_SECRET_BASE64 not configured' };
  }
  if (config.publicBaseUrl === undefined) {
    return { registered: false, reason: 'PUBLIC_BASE_URL not configured' };
  }

  const { db } = getDb(config);
  const redis = getRedis(config);
  const rateLimiters = buildRateLimiters(redis, {
    perSecondLimit: 80,
    perDayLimit: 1000,
    perUserPerHourLimit: 50,
  });
  const traceEmitter = buildTraceEmitter(config);

  registerWebApiRoutes(app, {
    config,
    db,
    redis,
    rateLimiters,
    traceEmitter,
  });
  return { registered: true };
}
