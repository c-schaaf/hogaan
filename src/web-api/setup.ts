import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import { installRedisForBreakerSync } from '../shared/llm/breaker-redis-sync.js';
import { getRedis } from '../shared/redis/client.js';
import { buildRateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { buildTraceEmitter } from '../shared/trace/index.js';
import { registerWebApiRoutes } from './routes.js';

/**
 * Phase C wiring. Same gating as web-auth (DB + Redis + JWT + base URL)
 * plus the rate-limiter + trace emitter the coaching orchestrator needs.
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
  // SCRUM (PR 7, launch-readiness D-7) — install the Redis bundle so the
  // LLM circuit-breaker sync (`src/shared/llm/breaker-redis-sync.ts`) can
  // mirror local breaker trips into Redis and check the shared flag from
  // sibling instances. Must run before any breaker is built — breakers
  // are lazy-built on first call so this ordering only needs to precede
  // the first LLM call, but it's cheapest right here at setup time.
  installRedisForBreakerSync(redis);
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
