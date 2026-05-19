import { describe, expect, it, vi } from 'vitest';
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
vi.mock('../../src/coaching/orchestrator.js', () => ({ runCoachingTurn: vi.fn() }));
vi.mock('../../src/shared/llm/chat.js', () => ({ chatStream: vi.fn() }));

async function buildApp(dbOverride?: unknown) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    userId: TEST_USER_ID,
    email: 'test@hogaan.test',
    supabaseUserId: 'supabase-uuid',
    fullName: 'Test User',
  } as never);

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

function buildProfileDb(userRow?: Record<string, unknown>, updateSpy?: ReturnType<typeof vi.fn>) {
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
    delete: () => ({ where: () => Promise.resolve([]) }),
    _updateSpy: mockUpdate,
  };
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
});
