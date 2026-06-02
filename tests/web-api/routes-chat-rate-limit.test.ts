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
  chat: vi.fn(),
}));
vi.mock('../../src/web-api/session-title.js', () => ({
  generateSessionTitle: vi.fn(),
}));
vi.mock('../../src/shared/redis/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/redis/rate-limit.js')>();
  // Default to the real implementation so the existing matrix tests keep
  // exercising the real decision logic; individual tests override with
  // mockImplementation when they need a controlled throw / value.
  return {
    ...actual,
    checkRateLimit: vi.fn(actual.checkRateLimit),
  };
});
vi.mock('../../src/incident-handling/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/incident-handling/index.js')>();
  return {
    ...actual,
    reportP2: vi.fn(),
  };
});

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
  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the default to the real checkRateLimit so the matrix tests
    // keep exercising the production decision logic.
    const actual = await vi.importActual<typeof import('../../src/shared/redis/rate-limit.js')>(
      '../../src/shared/redis/rate-limit.js',
    );
    const { checkRateLimit } = await import('../../src/shared/redis/rate-limit.js');
    vi.mocked(checkRateLimit).mockImplementation(actual.checkRateLimit);
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

  // SCRUM-B5: fail-OPEN on Upstash outage. If checkRateLimit throws (e.g.
  // Upstash down), the turn must still proceed (Anthropic console spend
  // cap is the compensating control) AND a P2 incident must be emitted
  // with source="Process_2.Step_3.RateLimit" so we can dashboard the
  // outage rate.
  it('fail-OPEN: rate-limiter throw routes through to a normal stream + emits a P2', async () => {
    const { checkRateLimit } = await import('../../src/shared/redis/rate-limit.js');
    const { reportP2 } = await import('../../src/incident-handling/index.js');
    const { chatStream } = await import('../../src/shared/llm/chat.js');
    const { resolveSession } = await import('../../src/session-lifecycle/index.js');
    const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
    const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');

    vi.mocked(checkRateLimit).mockRejectedValue(new Error('upstash unavailable'));
    vi.mocked(resolveSession).mockResolvedValue({
      sessionId: '00000000-0000-0000-0000-0000000000aa',
      turnCount: 0,
    } as never);
    vi.mocked(fetchCoachingContext).mockResolvedValue({
      profile: {},
      sessionTurns: [],
      memories: [],
      partialFailure: false,
    } as never);
    vi.mocked(assemblePrompt).mockResolvedValue({
      assembledPrompt: 'system',
      libraryVersions: {
        promptTemplates: { version: 'v', hash: 'h' },
        voiceRules: { version: 'v', hash: 'h' },
        culturalFraming: { version: 'v', hash: 'h' },
        resolvedAt: new Date(),
      },
    } as never);
    vi.mocked(chatStream).mockImplementation(async function* (): AsyncGenerator<
      string,
      unknown,
      void
    > {
      yield 'hi';
      return { modelUsed: 'claude-haiku-4-5', text: 'hi', inputTokens: 1, outputTokens: 1 };
    } as never);

    const app = await buildApp(buildLimiters({}));
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'hello' },
    });

    // (a) Route returns 200 with SSE — NOT 500.
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // (b) reportP2 was called with the exact source string.
    expect(reportP2).toHaveBeenCalled();
    const call = vi.mocked(reportP2).mock.calls[0];
    expect(call).toBeDefined();
    const ctx = call![1];
    expect(ctx?.source).toBe('Process_2.Step_3.RateLimit');
    // (c) The original error is forwarded as the 3rd reportP2 arg — that's
    // what lets Sentry capture the stack. A partial weakening that drops
    // err from the reportP2 call would silently lose triage information.
    const err = call![2];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('upstash unavailable');
  });
});
