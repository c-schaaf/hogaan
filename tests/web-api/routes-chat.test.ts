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

vi.mock('../../src/shared/llm/chat.js', () => ({
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

function buildChatDb() {
  const stub = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 't1' }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stub),
  };
  return stub;
}

async function buildApp() {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: buildChatDb() as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

describe('POST /api/chat/turn/stream', () => {
  it('returns 400 immediately when message is empty (before SSE headers)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>().error).toBe('message_required');
  });

  it('returns 400 when message is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('non-streaming /api/chat/turn route no longer exists (404 / 405)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: { message: 'Hi' },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  describe('SCRUM-F3 — message length cap', () => {
    it('accepts a message at exactly 4500 chars (the inclusive limit)', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'a'.repeat(4500) },
      });
      // Should NOT be 400 message_too_long — exactly at limit is allowed.
      // (May 500 due to mocks downstream, but won't be the length check.)
      if (res.statusCode === 400) {
        expect(res.json<Record<string, unknown>>().error).not.toBe('message_too_long');
      }
    });

    it('returns 400 + friendly first-person copy when message exceeds 4500 chars', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'a'.repeat(4501) },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('message_too_long');
      // Voice copy is load-bearing — Hamse-owned territory; assert verbatim
      // so a drift requires deliberate test update + voice review.
      expect(body.message).toBe(
        'That message is longer than I can take in one go. Try trimming it under 700 words.',
      );
    });

    it('does NOT leak the raw character ceiling (4500) into the user-facing copy', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'a'.repeat(10000) },
      });
      const body = res.json<{ message: string }>();
      // User sees "700 words" — the 4500-char implementation detail is internal.
      expect(body.message).not.toContain('4500');
      expect(body.message).not.toContain('char');
    });

    it('measures the trimmed message (trailing whitespace does not count)', async () => {
      const app = await buildApp();
      // 4500 'a's + 100 trailing spaces — should be accepted because trim()
      // brings it back to 4500.
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'a'.repeat(4500) + ' '.repeat(100) },
      });
      if (res.statusCode === 400) {
        expect(res.json<Record<string, unknown>>().error).not.toBe('message_too_long');
      }
    });
  });
});
