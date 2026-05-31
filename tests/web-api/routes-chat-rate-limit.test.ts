import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import type { RateLimiters } from '../../src/shared/redis/rate-limit.js';
import { fakeConfig, fakeRedis, fakeTraceEmitter } from '../phase-10/helpers/fakes.js';

/**
 * SCRUM — opts.rateLimiters was injected but unused on the chat stream
 * route. The fix applies a per-user + global rate-limit check before
 * reply.hijack() so we can still return a proper 429 status.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('../../src/session-lifecycle/index.js', () => ({
  resolveSession: vi.fn(),
}));
vi.mock('../../src/coaching/context-fetch.js', () => ({
  fetchCoachingContext: vi.fn(),
}));
vi.mock('../../src/prompt-assembly/index.js', () => ({
  assemblePrompt: vi.fn(),
  PromptAssemblyError: class PromptAssemblyError extends Error {},
}));
vi.mock('../../src/shared/llm/chat.js', () => ({
  chatStream: vi.fn(),
}));
vi.mock('../../src/web-api/session-title.js', () => ({
  generateSessionTitle: vi.fn(),
}));

function fakeDb() {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  };
}

function buildLimiters(opts: {
  perDay?: 'success' | 'fail';
  perSecond?: 'success' | 'fail';
  perUser?: 'success' | 'fail';
  perUserDay?: 'success' | 'fail';
}): RateLimiters {
  const make = (outcome: 'success' | 'fail') => ({
    limit: () =>
      Promise.resolve({
        success: outcome === 'success',
        limit: 100,
        remaining: outcome === 'success' ? 99 : 0,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      }),
  });
  return {
    perSecond: make(opts.perSecond ?? 'success'),
    perDay: make(opts.perDay ?? 'success'),
    perUser: make(opts.perUser ?? 'success'),
    perUserDay: make(opts.perUserDay ?? 'success'),
  } as unknown as RateLimiters;
}

async function buildApp(limiters: RateLimiters) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);
  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: fakeDb() as never,
    redis: fakeRedis(),
    rateLimiters: limiters,
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

describe('POST /api/chat/turn/stream — rate-limit enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 429 + reason:per_user_daily with friendly message when the per-user daily cap is hit (SCRUM-F2)', async () => {
    const app = await buildApp(buildLimiters({ perUserDay: 'fail' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; reason: string; message: string }>();
    expect(body.error).toBe('rate_limited');
    expect(body.reason).toBe('per_user_daily');
    // Friendly copy the chat UI surfaces verbatim — wording matters.
    expect(body.message).toBe("You've hit today's limit. Try again tomorrow.");
  });

  it('returns 429 + reason:per_day with generic message when the global runaway fuse fires', async () => {
    const app = await buildApp(buildLimiters({ perDay: 'fail' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; reason: string; message: string }>();
    expect(body.error).toBe('rate_limited');
    expect(body.reason).toBe('per_day');
    expect(body.message).toBe('The coach is briefly unavailable. Please try again later.');
  });

  it('returns 429 + reason:per_user when the user hourly anti-spam cap is exceeded', async () => {
    const app = await buildApp(buildLimiters({ perUser: 'fail' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; reason: string; message: string }>();
    expect(body.error).toBe('rate_limited');
    expect(body.reason).toBe('per_user');
    expect(body.message).toBe('The coach is busy right now. Try again in a moment.');
  });

  it('per_user_daily takes precedence over per_day in REJECT ordering', async () => {
    // Both global and per-user-daily failing — the per-user-daily reason
    // is what surfaces, because that's the one a real user can act on.
    const app = await buildApp(buildLimiters({ perDay: 'fail', perUserDay: 'fail' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json<{ reason: string }>().reason).toBe('per_user_daily');
  });
});
