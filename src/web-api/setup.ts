import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import { installRedisForBreakerSync } from '../shared/llm/breaker-redis-sync.js';
import { getRedis } from '../shared/redis/client.js';
import { buildRateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { buildTraceEmitter } from '../shared/trace/index.js';
import { registerWebApiRoutes } from './routes.js';

/**
 * Phase C wiring. Validates required configuration; if anything required is
 * missing the process exits with a structured stderr line so the deploy
 * fails loudly. Optional config (e.g. monitoring DSNs) is checked elsewhere.
 *
 * SCRUM (PR 6, launch-readiness D-3) — removed the `jwtSecretBase64` gate.
 * Web auth uses Supabase `getUser` / a Supabase-issued JWT (read-side local
 * verify in PR 6 D-5 uses `SUPABASE_JWT_SECRET`, not the legacy
 * `JWT_SECRET_BASE64`). Forgetting the unused secret used to de-register
 * every `/api/*` route silently — the server booted and looked healthy
 * while serving zero API. Now the function still gates on truly-required
 * vars but does so by crashing the process with a clear log line instead
 * of silently no-opting.
 */
const REQUIRED_VARS: Array<[keyof AppConfig, string]> = [
  ['databaseUrl', 'DATABASE_URL'],
  ['upstashRedisRestUrl', 'UPSTASH_REDIS_REST_URL'],
  ['upstashRedisRestToken', 'UPSTASH_REDIS_REST_TOKEN'],
  ['publicBaseUrl', 'PUBLIC_BASE_URL'],
  ['encryptionKeyBase64', 'ENCRYPTION_KEY_BASE64'],
  ['supabaseUrl', 'SUPABASE_URL'],
  ['supabaseAnonKey', 'SUPABASE_ANON_KEY'],
];

// eslint-disable-next-line @typescript-eslint/require-await -- async signature kept symmetric with other setup helpers
export async function wireWebApiRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<{ registered: true }> {
  const missing = REQUIRED_VARS.filter(([k]) => config[k] === undefined).map(([, name]) => name);
  if (missing.length > 0) {
    // Fail loudly so a misconfigured deploy doesn't boot into a non-
    // functional state where every /api/* is a 404. `console.error` writes
    // to stderr and is visible in Render's deploy logs even if the
    // structured logger hasn't initialized yet.
    console.error(
      `[startup] FATAL — required environment variables missing: ${missing.join(', ')}. Refusing to register /api/* routes; exiting.`,
    );
    process.exit(1);
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
