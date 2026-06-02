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

  // SCRUM — LIKE-escape negative tests. The route escapes %, _, and \\ in
  // the user query before wrapping in `%...%` so a search for "50%" matches
  // the literal string, not "anything containing 50". The bound ilike
  // pattern is captured via the lastSelect.whereArgs spy and pulled out of
  // the SQL chunk tree as a Param value.
  it('escapes literal % so the bound pattern is %\\%% (not %%%)', async () => {
    const { app, lastSelect } = await buildApp([]);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=%25' });
    expect(res.statusCode).toBe(200);
    const params = collectParamValues(lastSelect.whereArgs);
    expect(params).toContain('%\\%%');
    expect(params).not.toContain('%%%');
  });

  it('escapes literal _ so the bound pattern is %\\_% (not %_%)', async () => {
    const { app, lastSelect } = await buildApp([]);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=_' });
    expect(res.statusCode).toBe(200);
    const params = collectParamValues(lastSelect.whereArgs);
    expect(params).toContain('%\\_%');
    expect(params).not.toContain('%_%');
  });

  it('escapes literal \\ so the bound pattern is %\\\\% (not %\\%)', async () => {
    const { app, lastSelect } = await buildApp([]);
    // %5C is the URL-encoded backslash; the route sees a single \ in q.
    const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=%5C' });
    expect(res.statusCode).toBe(200);
    const params = collectParamValues(lastSelect.whereArgs);
    expect(params).toContain('%\\\\%');
    expect(params).not.toContain('%\\%');
  });
});

/**
 * Walk a drizzle SQL expression's `queryChunks` recursively and pull every
 * bound value out. `eq()` binds via a `Param` node whose `.value` is the
 * literal; `ilike()` inlines the pattern directly as a raw string chunk in
 * the SQL tree. Both are returned so the caller can assert on either.
 */
function collectParamValues(sql: unknown): unknown[] {
  const out: unknown[] = [];
  const visit = (node: unknown): void => {
    if (node === null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (typeof node !== 'object') return;
    const ctor = (node as { constructor?: { name?: string } }).constructor?.name;
    if (ctor === 'Param') {
      out.push((node as { value: unknown }).value);
      return;
    }
    // StringChunk wraps the literal SQL fragments (' = ', ' ilike ', etc.).
    // Skip — they would flood the result with non-bound noise.
    if (ctor === 'StringChunk') return;
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const c of chunks) visit(c);
    }
  };
  visit(sql);
  return out;
}
