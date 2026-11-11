import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createEmbeddedDb, type EmbeddedDb } from '../shared/db/embedded.js';
import { createMemoryRedis, createPassThroughRateLimiters } from '../shared/redis/memory.js';
import { type AppConfig, loadConfig } from '../shared/secrets/config.js';
import { wireWebApiRoutes } from '../web-api/setup.js';
import { wireWebStatic } from '../web-static/setup.js';
import { seedDemo } from './seed.js';
import { buildJobHandlers } from '../jobs/handlers.js';
import { startJobRunner } from '../jobs/runner.js';

/**
 * DEMO MODE server. Runs the real Fastify app and real routes against:
 *   - an embedded Postgres (PGlite) with every migration applied and demo
 *     data seeded — nothing is persisted between runs;
 *   - an in-memory Redis stand-in and always-allow rate limiters;
 *   - a demo sign-in that only ever resolves to the one sample leader;
 *   - the scripted stand-in coach when ANTHROPIC_API_KEY is not set, the
 *     real model when it is.
 *
 * Refuses to start when NODE_ENV=production.
 */

/** Env vars that point at real services. Demo mode clears them on start. */
const REAL_SERVICE_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SENTRY_DSN',
  'AXIOM_TOKEN',
  'AXIOM_DATASET',
  'BETTERSTACK_HEARTBEAT_URL',
  'GROQ_API_KEY',
  'VOYAGE_API_KEY',
];

export class DemoRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoRefusedError';
  }
}

/** Throws when demo mode must not run. Exported for the refusal test. */
export function assertDemoAllowed(env: Record<string, string | undefined>): void {
  const nodeEnv = (env['NODE_ENV'] ?? '').trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new DemoRefusedError(`Refusing to start demo mode: NODE_ENV is "${nodeEnv}".`);
  }
}

/** Prepare process.env for demo mode (mutates and returns it). */
export function prepareDemoEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  assertDemoAllowed(env);
  for (const k of REAL_SERVICE_VARS) delete env[k];
  env['DEMO_MODE'] = 'true';
  env['NODE_ENV'] ??= 'development';
  env['PORT'] ??= '3000';
  env['LOG_LEVEL'] ??= 'warn';
  env['PUBLIC_BASE_URL'] ??= `http://localhost:${env['PORT']}`;
  env['ENCRYPTION_KEY_BASE64'] ??= randomBytes(32).toString('base64');
  env['EMAIL_LINK_SECRET'] ??= randomBytes(32).toString('base64');
  return env;
}

export interface DemoServer {
  app: FastifyInstance;
  config: AppConfig;
  embedded: EmbeddedDb;
  close(): Promise<void>;
}

export async function startDemoServer(
  opts: { listen?: boolean; webDistDir?: string } = {},
): Promise<DemoServer> {
  prepareDemoEnv(process.env);
  const config = loadConfig();
  if (config.demoMode !== true || config.nodeEnv === 'production') {
    throw new DemoRefusedError('demo config invalid');
  }
  const embedded = await createEmbeddedDb();
  await seedDemo(embedded.db, config);

  const app = await buildApp(config);
  await wireWebApiRoutes(app, config, {
    db: embedded.db,
    redis: createMemoryRedis(),
    rateLimiters: createPassThroughRateLimiters(),
  });
  await wireWebStatic(app, config, opts.webDistDir);
  const runner = startJobRunner(config, embedded.db, buildJobHandlers(config, embedded.db));
  if (opts.listen !== false) {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } else {
    await app.ready();
  }
  return {
    app,
    config,
    embedded,
    close: async () => {
      runner.stop();
      await app.close();
      await embedded.close();
    },
  };
}
