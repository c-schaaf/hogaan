import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import {
  fakeConfig,
  fakeRateLimiters,
  fakeRedis,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

/**
 * SCRUM-53 — POST /api/chat/turn/stream must forward the client's sessionId
 * into resolveSession so a "Continue past session" turn lands on the named
 * session row instead of creating a duplicate.
 *
 * This is the integration layer: the route handler + the resolver call site
 * are wired together. The DB and LLM are still mocked.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const PAST_SESSION_ID = 'sess-past-0001';

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

vi.mock('../../src/coaching/orchestrator.js', () => ({
  runCoachingTurn: vi.fn(),
}));

function fakeDb() {
  const stub = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
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

  const { resolveSession } = await import('../../src/session-lifecycle/index.js');
  vi.mocked(resolveSession).mockResolvedValue({
    sessionId: PAST_SESSION_ID as never,
    isNew: false,
    turnCount: 3,
    lastTurnAt: new Date(),
    metadata: null,
  });

  const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
  vi.mocked(fetchCoachingContext).mockResolvedValue({
    profile: {} as never,
    sessionTurns: [],
    memories: [],
  });

  // assemblePrompt + chatStream are not exercised by these assertions, but
  // they need to resolve to *something* so the route doesn't throw mid-flow.
  // We assert before any LLM call, by inspecting resolveSession args.
  const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');
  vi.mocked(assemblePrompt).mockResolvedValue({
    endEvent: 'E1_PromptAssembledNormal',
    assembledPrompt: 'prompt',
  } as never);

  const { chatStream } = await import('../../src/shared/llm/chat.js');
  vi.mocked(chatStream).mockImplementation(
    () =>
      (async function* () {
        yield 'ok';
      })() as never,
  );

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: fakeDb() as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

describe('POST /api/chat/turn/stream — SCRUM-53 sessionId honoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the client sessionId into resolveSession when provided', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Continuing yesterday.', sessionId: PAST_SESSION_ID },
    });

    const { resolveSession } = await import('../../src/session-lifecycle/index.js');
    expect(vi.mocked(resolveSession)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: TEST_USER_ID,
        sessionId: PAST_SESSION_ID,
      }),
    );
  });

  it('omits sessionId from resolveSession options when the client does not send it', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Fresh question.' },
    });

    const { resolveSession } = await import('../../src/session-lifecycle/index.js');
    const call = vi.mocked(resolveSession).mock.calls[0];
    expect(call).toBeDefined();
    const optsArg = call?.[1] as { userId: string; sessionId?: string };
    expect(optsArg.userId).toBe(TEST_USER_ID);
    expect(optsArg.sessionId).toBeUndefined();
  });

  it('ignores empty-string sessionId from the client (treats as absent)', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Hi.', sessionId: '' },
    });

    const { resolveSession } = await import('../../src/session-lifecycle/index.js');
    const optsArg = vi.mocked(resolveSession).mock.calls[0]?.[1] as {
      userId: string;
      sessionId?: string;
    };
    expect(optsArg.sessionId).toBeUndefined();
  });

  it('ignores non-string sessionId payload (treats as absent)', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Hi.', sessionId: 12345 },
    });

    const { resolveSession } = await import('../../src/session-lifecycle/index.js');
    const optsArg = vi.mocked(resolveSession).mock.calls[0]?.[1] as {
      userId: string;
      sessionId?: string;
    };
    expect(optsArg.sessionId).toBeUndefined();
  });
});
