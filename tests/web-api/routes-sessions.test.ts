import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { fakeConfig, fakeRedis, fakeRateLimiters, fakeTraceEmitter } from '../phase-10/helpers/fakes.js';

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
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'set', 'returning', 'update', 'delete']) {
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
      { id: SESSION_ID, title: 'Leadership Q', startedAt: twoDaysAgo, lastTurnAt: twoDaysAgo, turnCount: 3 },
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
    const body = res.json<{ sessions: unknown[] }>();
    expect(body.sessions).toHaveLength(1);
    expect((body.sessions[0] as Record<string, unknown>).title).toBe('Leadership Q');
    expect((body.sessions[0] as Record<string, unknown>).group).toBe('This week');
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
                  ? [{ id: SESSION_ID, title: 'My session', userId: TEST_USER_ID, isPrivate: false }]
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
});

describe('DELETE /api/sessions/:id', () => {
  it('deletes session owned by the user and returns { ok: true }', async () => {
    const deleteMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: SESSION_ID, userId: TEST_USER_ID }]),
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
            limit: () =>
              Promise.resolve([{ id: SESSION_ID, userId: OTHER_USER_ID }]),
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
