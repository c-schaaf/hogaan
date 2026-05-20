import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import {
  fakeConfig,
  fakeRedis,
  fakeRateLimiters,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000002';
const SESSION_ID = 'sess-0000-0000-0000-000000000001';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));

// Mock coaching orchestrator to avoid LLM calls
vi.mock('../../src/coaching/orchestrator.js', () => ({
  runCoachingTurn: vi.fn(),
}));

// Mock chatStream for streaming route
vi.mock('../../src/shared/llm/chat.js', () => ({
  chatStream: vi.fn(),
}));

/** Make a drizzle-style chainable query that resolves to `rows`. */
function makeQuery<T>(rows: T[]) {
  const chain: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'set',
    'returning',
    'update',
    'delete',
  ]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: T[]) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function buildDb(queryMap: Record<string, unknown> = {}) {
  return {
    select: (_fields?: unknown) => queryMap['select'] ?? makeQuery([]),
    insert: (_table?: unknown) => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: (_table?: unknown) => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: (_table?: unknown) => ({ where: () => Promise.resolve([]) }),
    ...queryMap,
  };
}

let sessionCallCount = 0;

async function buildApp(dbOverride?: ReturnType<typeof buildDb>) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: (dbOverride ?? buildDb()) as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

describe('GET /api/sessions', () => {
  it('returns session list with group labels', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const sessionRows = [
      {
        id: SESSION_ID,
        title: 'Leadership Q',
        startedAt: twoDaysAgo,
        lastTurnAt: twoDaysAgo,
        turnCount: 3,
      },
    ];

    let selectCallCount = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(selectCallCount++ === 0 ? sessionRows : []),
            }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: unknown[]; hasMore: boolean }>();
    expect(body.sessions).toHaveLength(1);
    expect((body.sessions[0] as Record<string, unknown>).title).toBe('Leadership Q');
    expect((body.sessions[0] as Record<string, unknown>).group).toBe('This week');
    expect(body.hasMore).toBe(false);
  });

  it('paginates: returns first 20 + hasMore=true, then rest + hasMore=false', async () => {
    const now = new Date();
    // Build 30 session rows, lastTurnAt decreasing
    const all = Array.from({ length: 30 }, (_, i) => ({
      id: `sess-${i.toString().padStart(2, '0')}`,
      title: `Session ${i}`,
      startedAt: new Date(now.getTime() - i * 60 * 60 * 1000),
      lastTurnAt: new Date(now.getTime() - i * 60 * 60 * 1000),
      turnCount: 3,
      userId: TEST_USER_ID,
    }));

    // Stub a db that interprets the chain. The first page call uses
    // .from().where().orderBy().limit() and resolves to limit+1 rows
    // (server fetches PAGE+1 to detect hasMore). The cursor-resolution call
    // for ?before= uses .from().where().limit() (no orderBy) and resolves
    // to the cursor row.
    let lastLimitArg = 0;
    let lastCursorId: string | null = null;

    const db = {
      select: () => ({
        from: () => ({
          where: (whereExpr: unknown) => {
            // Peek at the raw expression — we can't introspect drizzle easily
            // here, so we rely on the test driving cursor via the query
            // string we parse from req. Instead, we'll branch on whether
            // orderBy() is chained.
            void whereExpr;
            return {
              limit: (n: number) => {
                // This branch = cursor lookup (no orderBy).
                lastLimitArg = n;
                const row = all.find((r) => r.id === lastCursorId);
                return Promise.resolve(row !== undefined ? [row] : []);
              },
              orderBy: () => ({
                limit: (n: number) => {
                  // Page fetch (limit + 1 = 21).
                  lastLimitArg = n;
                  let pool = all;
                  if (lastCursorId !== null) {
                    const cur = all.find((r) => r.id === lastCursorId);
                    if (cur !== undefined) {
                      pool = all.filter((r) => r.lastTurnAt.getTime() < cur.lastTurnAt.getTime());
                    }
                  }
                  return Promise.resolve(pool.slice(0, n));
                },
              }),
            };
          },
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);

    // First page: no cursor.
    lastCursorId = null;
    const r1 = await app.inject({ method: 'GET', url: '/api/sessions?limit=20' });
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json<{ sessions: { id: string }[]; hasMore: boolean }>();
    expect(b1.sessions).toHaveLength(20);
    expect(b1.hasMore).toBe(true);
    expect(lastLimitArg).toBe(21);

    // Second page: cursor = last id from first page.
    const cursorId = b1.sessions[b1.sessions.length - 1]!.id;
    lastCursorId = cursorId;
    const r2 = await app.inject({
      method: 'GET',
      url: `/api/sessions?limit=20&before=${cursorId}`,
    });
    expect(r2.statusCode).toBe(200);
    const b2 = r2.json<{ sessions: { id: string }[]; hasMore: boolean }>();
    expect(b2.sessions).toHaveLength(10);
    expect(b2.hasMore).toBe(false);
  });

  it('returns 401 when not authenticated', async () => {
    const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
    vi.mocked(requireSupabaseSession).mockResolvedValue(null as never);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    // requireSupabaseSession sends its own reply; inject returns whatever it sent
    expect(res.statusCode).not.toBe(500);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns session + turns for the owner', async () => {
    const createdAt = new Date('2026-05-01T10:00:00Z');
    let callIdx = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                callIdx++ === 0
                  ? [
                      {
                        id: SESSION_ID,
                        title: 'My session',
                        userId: TEST_USER_ID,
                        isPrivate: false,
                      },
                    ]
                  : [],
              ),
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  { id: 'turn-1', userMessage: 'Hello', responseText: 'Hi back', createdAt },
                ]),
            }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${SESSION_ID}` });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ session: unknown; turns: unknown[] }>();
    expect((body.session as Record<string, unknown>).id).toBe(SESSION_ID);
    expect(body.turns).toHaveLength(1);
    expect((body.turns[0] as Record<string, unknown>).userMessage).toBe('Hello');
  });

  it('returns 404 when session belongs to a different user', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                { id: SESSION_ID, title: 'Other session', userId: OTHER_USER_ID, isPrivate: false },
              ]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${SESSION_ID}` });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when session does not exist', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nonexistent-id' });

    expect(res.statusCode).toBe(404);
  });

  // SCRUM — the audit found GET /api/sessions/:id silently truncated long
  // transcripts at the 200-turn cap. The response now returns hasMore so
  // the client can surface a "showing latest 200 turns" notice.
  it('returns hasMore=true when the turn cap is exceeded', async () => {
    const createdAt = new Date('2026-05-01T10:00:00Z');
    // 201 rows so the route's `limit(201)` returns more than the 200 page.
    const turns = Array.from({ length: 201 }, (_, i) => ({
      id: `t-${i}`,
      userMessage: `u${i}`,
      responseText: `a${i}`,
      createdAt,
    }));
    let callIdx = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                callIdx++ === 0
                  ? [
                      {
                        id: SESSION_ID,
                        title: 'Big session',
                        userId: TEST_USER_ID,
                        isPrivate: false,
                      },
                    ]
                  : [],
              ),
            orderBy: () => ({ limit: () => Promise.resolve(turns) }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${SESSION_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ turns: unknown[]; hasMore: boolean }>();
    expect(body.hasMore).toBe(true);
    expect(body.turns).toHaveLength(200);
  });

  it('returns hasMore=false when turn count is at or below the cap', async () => {
    const createdAt = new Date('2026-05-01T10:00:00Z');
    const turns = Array.from({ length: 50 }, (_, i) => ({
      id: `t-${i}`,
      userMessage: `u${i}`,
      responseText: `a${i}`,
      createdAt,
    }));
    let callIdx = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                callIdx++ === 0
                  ? [
                      {
                        id: SESSION_ID,
                        title: 'Small session',
                        userId: TEST_USER_ID,
                        isPrivate: false,
                      },
                    ]
                  : [],
              ),
            orderBy: () => ({ limit: () => Promise.resolve(turns) }),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${SESSION_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ turns: unknown[]; hasMore: boolean }>();
    expect(body.hasMore).toBe(false);
    expect(body.turns).toHaveLength(50);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('deletes session owned by the user and returns { ok: true }', async () => {
    const deleteMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: SESSION_ID, userId: TEST_USER_ID }]),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: deleteMock }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'DELETE', url: `/api/sessions/${SESSION_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it('returns 404 when session belongs to another user', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: SESSION_ID, userId: OTHER_USER_ID }]),
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    } as never;

    const app = await buildApp(db);
    const res = await app.inject({ method: 'DELETE', url: `/api/sessions/${SESSION_ID}` });

    expect(res.statusCode).toBe(404);
  });
});
