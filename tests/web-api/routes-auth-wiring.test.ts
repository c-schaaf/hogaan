import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { auditLog } from '../../src/shared/db/schema/audit-log.js';
import { sessions as sessionsTable } from '../../src/shared/db/schema/sessions.js';
import { users as usersTable } from '../../src/shared/db/schema/users.js';
import type { AuditEvent } from '../../src/web-api/supabase-session.js';
import {
  fakeConfig,
  fakeRateLimiters,
  fakeRedis,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

/**
 * Risk #2 + Risk #9 — auth-wiring integration test.
 *
 * Wires the REAL src/web-api/supabase-session.ts (no module mock) and stubs
 * the @supabase/supabase-js boundary instead, so every assertion exercises
 * the production code path: bearer-token parsing → getUser round-trip →
 * users lookup → audit_log insert → route handler invocation.
 *
 * Hard Rule #4 (fail-CLOSED): an audit_log insert failure must surface as a
 * 5xx and the route handler must never run.
 */

const FAKE_SUPABASE_USER_ID = '11111111-1111-1111-1111-111111111111';
const INTERNAL_USER_ID = '22222222-2222-2222-2222-222222222222';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: {
              id: FAKE_SUPABASE_USER_ID,
              email: 'auth-wiring@hogaan.test',
              user_metadata: { full_name: 'Wiring Test' },
            },
          },
          error: null,
        }),
    },
  }),
}));

vi.mock('../../src/shared/llm/chat.js', () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
}));

vi.mock('../../src/coaching/context-fetch.js', () => ({
  fetchCoachingContext: vi.fn(),
}));

vi.mock('../../src/session-lifecycle/index.js', () => ({
  resolveSession: vi.fn(),
}));

vi.mock('../../src/prompt-assembly/index.js', () => ({
  assemblePrompt: vi.fn(),
  PromptAssemblyError: class PromptAssemblyError extends Error {},
}));

vi.mock('../../src/web-api/session-title.js', () => ({
  generateSessionTitle: vi.fn(),
}));

interface InsertCall {
  table: unknown;
  values: Record<string, unknown>;
}

interface SelectCall {
  table: unknown;
}

interface FakeDbHandle {
  db: unknown;
  insertCalls: InsertCall[];
  selectCalls: SelectCall[];
}

function buildFakeDb(opts: { auditInsertError?: Error } = {}): FakeDbHandle {
  const insertCalls: InsertCall[] = [];
  const selectCalls: SelectCall[] = [];

  const userRow = { id: INTERNAL_USER_ID, email: 'auth-wiring@hogaan.test' };

  function makeSelectChain(rows: unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) {
      chain[m] = () => chain;
    }
    chain['then'] = (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  }

  const db = {
    select: (_fields?: unknown) => {
      const chain: Record<string, unknown> = {};
      chain['from'] = (table: unknown) => {
        selectCalls.push({ table });
        // Only the users-table lookup in the auth middleware should get a
        // row back — every other table (sessions / turns / etc.) returns
        // empty so the route handler resolves with no rows, not undefined.
        const rows = table === usersTable ? [userRow] : [];
        const inner = makeSelectChain(rows);
        return inner;
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertCalls.push({ table, values: vals });
        if (table === auditLog && opts.auditInsertError !== undefined) {
          return Promise.reject(opts.auditInsertError);
        }
        return Promise.resolve(undefined);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };

  return { db, insertCalls, selectCalls };
}

async function buildApp(handle: FakeDbHandle): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig({ supabaseUrl: 'http://test', supabaseAnonKey: 'test-key' }),
    db: handle.db as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
  vi.clearAllMocks();
});

describe('web-api auth-wiring — Risk #2 (CRITICAL)', () => {
  it('valid Authorization header → 200 + audit_log INSERT carries the route AuditEvent', async () => {
    const handle = buildFakeDb();
    app = await buildApp(handle);

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(res.statusCode).toBe(200);

    const auditInserts = handle.insertCalls.filter((c) => c.table === auditLog);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.values['targetEndEvent']).toBe('E1_SessionsList');
    expect(auditInserts[0]!.values['triggerSource']).toBe('web_session');
    expect(auditInserts[0]!.values['userId']).toBe(INTERNAL_USER_ID);
  });

  it('missing Authorization header → 401 and NO audit_log INSERT', async () => {
    const handle = buildFakeDb();
    app = await buildApp(handle);

    const res = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(res.statusCode).toBe(401);
    expect(res.json<Record<string, unknown>>()['error']).toBe('unauthorized');

    const auditInserts = handle.insertCalls.filter((c) => c.table === auditLog);
    expect(auditInserts).toHaveLength(0);
  });

  it('audit_log INSERT throws → 500 service_unavailable + route handler never invoked', async () => {
    const handle = buildFakeDb({
      auditInsertError: new Error('connection terminated unexpectedly'),
    });
    app = await buildApp(handle);

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json<Record<string, unknown>>()['error']).toBe('service_unavailable');

    // Hard Rule #4: the /api/sessions handler does its own opts.db.select(...)
    // query against the `sessions` table. If the route handler never ran,
    // only the middleware's users-lookup SELECT should have happened.
    const sessionsTableSelects = handle.selectCalls.filter((c) => c.table === sessionsTable);
    expect(sessionsTableSelects).toHaveLength(0);

    // Sanity: the middleware's users SELECT did fire (audit insert is after).
    const usersTableSelects = handle.selectCalls.filter((c) => c.table === usersTable);
    expect(usersTableSelects.length).toBeGreaterThan(0);
  });
});

describe('web-api per-route AuditEvent attribution — Risk #9 (MEDIUM)', () => {
  interface RouteCase {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
    event: AuditEvent;
  }

  const SESSION_ID = '33333333-3333-3333-3333-333333333333';

  const cases: RouteCase[] = [
    {
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello coach' },
      event: 'E1_ChatTurnStream',
    },
    { method: 'GET', url: '/api/sessions', event: 'E1_SessionsList' },
    { method: 'GET', url: '/api/sessions/search?q=growth', event: 'E1_SessionsSearch' },
    { method: 'GET', url: `/api/sessions/${SESSION_ID}`, event: 'E1_SessionGet' },
    { method: 'DELETE', url: `/api/sessions/${SESSION_ID}`, event: 'E1_SessionDelete' },
    { method: 'GET', url: '/api/profile', event: 'E1_ProfileGet' },
    {
      method: 'PATCH',
      url: '/api/profile',
      payload: { fullName: 'Test' },
      event: 'E1_ProfilePatch',
    },
    { method: 'DELETE', url: '/api/profile', event: 'E1_ProfileDelete' },
  ];

  it.each(cases)('$method $url writes audit_log with targetEndEvent=$event', async (c) => {
    const handle = buildFakeDb();
    app = await buildApp(handle);

    await app.inject({
      method: c.method,
      url: c.url,
      headers: { authorization: 'Bearer fake-token' },
      ...(c.payload !== undefined ? { payload: c.payload } : {}),
    });

    const auditInserts = handle.insertCalls.filter((x) => x.table === auditLog);
    expect(auditInserts.length).toBeGreaterThanOrEqual(1);
    expect(auditInserts[0]!.values['targetEndEvent']).toBe(c.event);
  });
});
