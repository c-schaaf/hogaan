import Fastify, { type FastifyInstance } from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import type { Database } from '../../src/shared/db/client.js';
import { encryptPlaintext } from '../../src/shared/db/encryption.js';
import { users } from '../../src/shared/db/schema/users.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import { fakeRedis, fakeRateLimiters, fakeTraceEmitter } from '../phase-10/helpers/fakes.js';

/** Real routes on an embedded DB. Pair with vi.mock of supabase-session. */
export async function buildRealApp(config: AppConfig, db: Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config,
    db,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

export async function insertLeader(
  config: AppConfig,
  db: Database,
  fullName = 'Amina Farah',
): Promise<string> {
  const rows = await db
    .insert(users)
    .values({
      email: `leader-${Math.random().toString(36).slice(2)}@example.com`,
      fullNameEncrypted: encryptPlaintext(config, fullName),
      status: 'onboarded',
      experienceBand: '5-10',
      mappedPractices: ['integrity'],
    })
    .returning({ id: users.id });
  return rows[0]!.id;
}

export function sseText(body: string): string {
  return [...body.matchAll(/event: delta\ndata: (.*)\n/g)]
    .map((m) => (JSON.parse(m[1]!) as { text: string }).text)
    .join('');
}
