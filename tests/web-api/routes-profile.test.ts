import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { encryptPlaintext } from '../../src/shared/db/encryption.js';
import {
  fakeConfig,
  fakeRedis,
  fakeRateLimiters,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const USER_B_ID = '00000000-0000-0000-0000-0000000000B2';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('../../src/coaching/orchestrator.js', () => ({ runCoachingTurn: vi.fn() }));
vi.mock('../../src/shared/llm/chat.js', () => ({ chatStream: vi.fn() }));

async function buildApp(dbOverride?: unknown, opts?: { unauthorized?: boolean }) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  if (opts?.unauthorized === true) {
    vi.mocked(requireSupabaseSession).mockImplementation((async (
      _req: unknown,
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }) as never);
  } else {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      userId: TEST_USER_ID,
      email: 'test@hogaan.test',
      supabaseUserId: 'supabase-uuid',
      fullName: 'Test User',
    } as never);
  }

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: (dbOverride ?? buildProfileDb()) as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

function buildProfileDb(
  userRow?: Record<string, unknown>,
  updateSpy?: ReturnType<typeof vi.fn>,
  deleteSpy?: ReturnType<typeof vi.fn>,
) {
  const defaultUser = {
    id: TEST_USER_ID,
    email: 'test@hogaan.test',
    mappedPractices: ['Integrity', 'Peace'],
    fullNameEncrypted: null,
    onboardingCompletedAt: new Date(),
    status: 'onboarded',
    ...userRow,
  };

  const mockUpdate = updateSpy ?? vi.fn().mockResolvedValue([]);
  // delete spy receives the drizzle table object so the test can check it was
  // called against the users table; whereSpy captures the eq() expression so
  // the test can prove which user id was bound.
  const deleteTableSpy = deleteSpy ?? vi.fn();
  const whereSpy = vi.fn().mockResolvedValue([]);

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([defaultUser]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: (vals: unknown) => ({ where: () => mockUpdate(vals) }) }),
    delete: (table: unknown) => {
      deleteTableSpy(table);
      return { where: (w: unknown) => whereSpy(w) };
    },
    _updateSpy: mockUpdate,
    _deleteSpy: deleteTableSpy,
    _whereSpy: whereSpy,
  };
}

/** Pull the bound Param values out of a drizzle SQL expression's queryChunks. */
function boundParamValues(sql: unknown): unknown[] {
  const chunks = (sql as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const out: unknown[] = [];
  for (const c of chunks) {
    if (
      typeof c === 'object' &&
      c !== null &&
      (c as { constructor?: { name?: string } }).constructor?.name === 'Param'
    ) {
      out.push((c as { value: unknown }).value);
    }
  }
  return out;
}

describe('GET /api/profile', () => {
  it('returns user profile with mapped practices', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/profile' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.fullName).toBe('Test User');
    expect(body.email).toBe('test@hogaan.test');
    expect(body.mappedPractices).toContain('Integrity');
    expect(body.onboarded).toBe(true);
  });

  it('returns 404 when user not found', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    };
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/profile' });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/profile', () => {
  it('accepts valid practices and updates the profile', async () => {
    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildProfileDb({}, updateSpy);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { mappedPractices: ['Integrity', 'Empathy', 'Peace'] },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects unknown practices with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { mappedPractices: ['Integrity', 'MadeUpPractice'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>().error).toBe('invalid_practice');
  });

  it('accepts fullName update', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { fullName: 'Hamse Warfa' },
    });

    expect(res.statusCode).toBe(200);
  });

  // SCRUM — the audit found the onboarding question for "years of leadership"
  // was being silently dropped server-side. The PATCH body now accepts an
  // explicit experienceBand token; the route validates it against the
  // canonical set and persists it.
  it('persists a valid experienceBand', async () => {
    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildProfileDb({}, updateSpy);
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { experienceBand: '5-10' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
    const setValue = updateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setValue.experienceBand).toBe('5-10');
  });

  it('rejects an unknown experienceBand with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { experienceBand: '11-15' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>().error).toBe('invalid_experience_band');
  });

  // SCRUM — finishOnboarding writes both `status:onboarded` AND a non-null
  // onboardingCompletedAt timestamp in a SINGLE .set() call. Pre-fix one of
  // the columns could lag behind and the homepage rendered the wrong empty
  // state until the next manual edit.
  it('finishOnboarding writes status AND a non-null onboardingCompletedAt in one .set()', async () => {
    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildProfileDb({}, updateSpy);
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { finishOnboarding: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const setValue = updateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setValue.status).toBe('onboarded');
    expect(setValue.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(setValue.onboardingCompletedAt).not.toBeNull();
  });

  it('finishOnboarding + mappedPractices land in a single .set() call', async () => {
    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildProfileDb({}, updateSpy);
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: {
        finishOnboarding: true,
        mappedPractices: ['Integrity', 'Empathy', 'Peace'],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const setValue = updateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setValue.status).toBe('onboarded');
    expect(setValue.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(setValue.mappedPractices).toEqual(['Integrity', 'Empathy', 'Peace']);
  });

  // SCRUM — fullName round-trip: PATCH encrypts before persisting, GET
  // decrypts on read. Pre-fix a regression briefly stored plaintext; this
  // test pins the contract that the value persisted to the DB column is
  // ciphertext (NOT equal to the plaintext) and that GET returns the
  // plaintext back.
  it('PATCH fullName persists ciphertext, not plaintext', async () => {
    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildProfileDb({}, updateSpy);
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      payload: { fullName: 'Hamse Warfa' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const setValue = updateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof setValue.fullNameEncrypted).toBe('string');
    expect((setValue.fullNameEncrypted as string).length).toBeGreaterThan(0);
    expect(setValue.fullNameEncrypted).not.toBe('Hamse Warfa');
  });
});

describe('GET /api/profile — fullName decryption round-trip', () => {
  it('decrypts fullNameEncrypted ciphertext into the response body', async () => {
    const cfg = fakeConfig();
    const ciphertext = encryptPlaintext(cfg, 'Hamse Warfa');
    // Sanity: ciphertext is non-empty AND clearly NOT the plaintext.
    expect(ciphertext).not.toBe('Hamse Warfa');

    const db = buildProfileDb({ fullNameEncrypted: ciphertext });
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/profile' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.fullName).toBe('Hamse Warfa');
  });
});

describe('DELETE /api/profile — cross-user safety', () => {
  it('DELETE /api/profile with auth -> 200 and deletes against the users table bound to TEST_USER_ID', async () => {
    const db = buildProfileDb();
    const app = await buildApp(db);

    const res = await app.inject({ method: 'DELETE', url: '/api/profile' });
    expect(res.statusCode).toBe(200);

    expect(db._deleteSpy).toHaveBeenCalledTimes(1);
    // The drizzle table passed to delete() carries its name in a Symbol-keyed
    // slot — read it via the canonical drizzle:Name symbol.
    const passedTable = db._deleteSpy.mock.calls[0]![0] as Record<symbol, unknown>;
    const drizzleNameSym = Symbol.for('drizzle:Name');
    expect(passedTable[drizzleNameSym]).toBe('users');

    // The where() arg is the SQL object built by eq(users.id, session.userId).
    // The bound value lives inside a Param chunk on queryChunks.
    expect(db._whereSpy).toHaveBeenCalledTimes(1);
    const params = boundParamValues(db._whereSpy.mock.calls[0]![0]);
    expect(params).toContain(TEST_USER_ID);
    expect(params).not.toContain(USER_B_ID);
  });

  it('DELETE /api/profile without Authorization header -> 401 and db.delete is NOT called', async () => {
    const db = buildProfileDb();
    const app = await buildApp(db, { unauthorized: true });

    const res = await app.inject({ method: 'DELETE', url: '/api/profile' });
    expect(res.statusCode).toBe(401);
    expect(db._deleteSpy).not.toHaveBeenCalled();
    expect(db._whereSpy).not.toHaveBeenCalled();
  });

  it('DELETE /api/profile ignores a forged body.targetUserId and binds to session.userId', async () => {
    const db = buildProfileDb();
    const app = await buildApp(db);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      payload: { targetUserId: USER_B_ID },
    });
    expect(res.statusCode).toBe(200);

    expect(db._whereSpy).toHaveBeenCalledTimes(1);
    // The where clause must bind the SESSION user id, never the body field.
    const params = boundParamValues(db._whereSpy.mock.calls[0]![0]);
    expect(params).toContain(TEST_USER_ID);
    expect(params).not.toContain(USER_B_ID);
  });
});
