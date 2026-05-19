import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import {
  fakeConfig,
  fakeRedis,
  fakeRateLimiters,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('../../src/coaching/orchestrator.js', () => ({
  runCoachingTurn: vi.fn(),
}));
vi.mock('../../src/shared/llm/chat.js', () => ({
  chatStream: vi.fn(),
}));

/**
 * The route makes one `select(...)` call per request (the title-search
 * lookup). We capture it so each test can assert what was queried.
 */
function buildDb(selectRows: unknown[]) {
  const lastSelect: { whereArgs?: unknown; limitArg?: number } = {};
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (w: unknown) => {
    lastSelect.whereArgs = w;
    return chain;
  };
  chain.orderBy = () => chain;
  chain.limit = (n: number) => {
    lastSelect.limitArg = n;
    return Promise.resolve(selectRows);
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
    lastSelect,
  };
}

async function buildApp(selectRows: unknown[] = []) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const { db, lastSelect } = buildDb(selectRows);
  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: db as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return { app, lastSelect };
}

describe('GET /api/sessions/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty q with 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects whitespace-only q with 400', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=%20%20' });
    expect(res.statusCode).toBe(400);
  });

  it('returns matching sessions for a non-empty q', async () => {
    const lastTurnAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { app } = await buildApp([
      {
        id: 'sess-A',
        title: 'Leadership in a crunch',
        startedAt: lastTurnAt,
        lastTurnAt,
        turnCount: 4,
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=leadership' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: { id: string; title: string }[]; hasMore: boolean };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.title).toBe('Leadership in a crunch');
    expect(body.hasMore).toBe(false);
  });

  it('clamps limit and reports hasMore=true when the DB returned limit+1 rows', async () => {
    const stubRows = Array.from({ length: 3 }, (_, i) => ({
      id: `sess-${i}`,
      title: `Hit ${i}`,
      startedAt: new Date(),
      lastTurnAt: new Date(),
      turnCount: 1,
    }));
    const { app, lastSelect } = await buildApp(stubRows);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=hit&limit=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: unknown[]; hasMore: boolean };
    expect(body.sessions).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    // limit is page+1 so the route can detect hasMore without a count query.
    expect(lastSelect.limitArg).toBe(3);
  });
});
