import Fastify from 'fastify';
import { vi } from 'vitest';
import { registerWebApiRoutes } from '../../../src/web-api/routes.js';
import {
  fakeConfig,
  fakeRedis,
  fakeRateLimiters,
  fakeTraceEmitter,
} from '../../phase-10/helpers/fakes.js';
import type { Database } from '../../../src/shared/db/client.js';

export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Minimal DB stub that mocks the specific queries routes.ts uses. */
export function fakeDb(overrides: Partial<ReturnType<typeof buildDbStub>> = {}): Database {
  return { ...buildDbStub(), ...overrides } as unknown as Database;
}

function buildDbStub() {
  const chainable = () => {
    const obj: Record<string, unknown> = {};
    const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'set', 'returning'];
    for (const m of methods) {
      obj[m] = () => obj;
    }
    obj[Symbol.iterator] = function* () {};
    obj.then = (resolve: (v: unknown) => void) => resolve([]);
    return obj;
  };
  return {
    select: () => chainable(),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
}

/**
 * Build a Fastify instance wired with real routes but fake deps.
 * `requireSupabaseSession` is mocked to return TEST_USER_ID automatically.
 */
export async function buildTestApp(dbOverrides?: Partial<ReturnType<typeof buildDbStub>>) {
  vi.mock('../../../src/web-api/supabase-session.js', () => ({
    requireSupabaseSession: vi.fn(async (_req: unknown, _reply: unknown) => ({
      userId: TEST_USER_ID,
    })),
  }));

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: fakeDb(dbOverrides),
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}
