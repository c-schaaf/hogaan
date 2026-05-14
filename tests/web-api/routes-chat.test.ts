import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { fakeConfig, fakeRedis, fakeRateLimiters, fakeTraceEmitter } from '../phase-10/helpers/fakes.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-0000-0000-0000-000000000001';
const TURN_ID = 'turn-0000-0000-0000-000000000001';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('../../src/coaching/orchestrator.js', () => ({
  runCoachingTurn: vi.fn(),
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
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
}

async function buildApp() {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const { runCoachingTurn } = await import('../../src/coaching/orchestrator.js');
  vi.mocked(runCoachingTurn).mockResolvedValue({
    endEvent: 'E1_TurnCompleted',
    responseText: 'A coaching response.',
    practiceTag: null,
    levelTag: null,
    latencyMs: 250,
    sessionId: SESSION_ID as never,
    turnId: TURN_ID as never,
    traceId: 'trace-1',
  });

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

describe('POST /api/chat/turn', () => {
  it('returns 400 when message is empty', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>().error).toBe('message_required');
  });

  it('returns 400 when message is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with responseText and sessionId on success', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: { message: 'I need help leading my team.' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.responseText).toBe('A coaching response.');
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.endEvent).toBe('E1_TurnCompleted');
  });

  it('calls runCoachingTurn with channel=web', async () => {
    const { runCoachingTurn } = await import('../../src/coaching/orchestrator.js');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: { message: 'A coaching question' },
    });

    expect(vi.mocked(runCoachingTurn)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'web', body: 'A coaching question' }),
    );
  });

  it('sets isPrivate=true when private flag sent', async () => {
    const { runCoachingTurn } = await import('../../src/coaching/orchestrator.js');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn',
      payload: { message: 'Private question', private: true },
    });

    expect(vi.mocked(runCoachingTurn)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isPrivate: true }),
    );
  });
});

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
});
