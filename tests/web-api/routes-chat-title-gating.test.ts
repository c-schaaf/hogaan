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
 * SCRUM — pre-fix, the title generator fired on every turn (it self-
 * short-circuited inside via a SELECT, but the per-turn DB hop was waste).
 * The route now gates the fire on `resolved.isNew || resolved.turnCount===0`
 * so subsequent turns on titled sessions skip the call entirely.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-title-001';

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

function passthroughDb() {
  const txStub = {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'turn-1' }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'turn-1' }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(txStub),
  };
}

async function buildApp(resolved: { isNew: boolean; turnCount: number }) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const { resolveSession } = await import('../../src/session-lifecycle/index.js');
  vi.mocked(resolveSession).mockResolvedValue({
    sessionId: SESSION_ID as never,
    isNew: resolved.isNew,
    turnCount: resolved.turnCount,
    lastTurnAt: new Date(),
    metadata: null,
  });

  const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
  vi.mocked(fetchCoachingContext).mockResolvedValue({
    profile: {} as never,
    sessionTurns: [],
    memories: [],
  });

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
        return { modelUsed: 'claude-haiku-4-5' };
      })() as never,
  );

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: passthroughDb() as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

/**
 * SCRUM-F9: title generation now fires on the user's 3rd message
 * (resolved.turnCount === 2 — i.e. two turns already persisted before
 * the current one). This skips title-gen entirely on sessions that die
 * after 1 or 2 turns — saving roughly half of all title-gen Anthropic
 * calls, since one-shot questions are common (especially after the
 * "homepage always opens a new session" product decision).
 *
 * Title quality is preserved: generateSessionTitle now fetches the
 * session's FIRST user message from the turns table internally, so the
 * title still summarises the opening topic even though the call fires
 * on a later turn.
 */
describe('POST /api/chat/turn/stream — title generation gating (SCRUM-F9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT fire title generation on the brand-new first turn (isNew=true, turnCount=0)', async () => {
    const app = await buildApp({ isNew: true, turnCount: 0 });
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'first message' },
    });
    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).not.toHaveBeenCalled();
  });

  it('does NOT fire title generation on the 2nd turn (turnCount=1)', async () => {
    const app = await buildApp({ isNew: false, turnCount: 1 });
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'second message', sessionId: SESSION_ID },
    });
    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).not.toHaveBeenCalled();
  });

  it('FIRES title generation on the 3rd turn (turnCount=2) — the F9 trigger', async () => {
    const app = await buildApp({ isNew: false, turnCount: 2 });
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'third message', sessionId: SESSION_ID },
    });
    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-fire title generation on later turns (turnCount=4)', async () => {
    const app = await buildApp({ isNew: false, turnCount: 4 });
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'fifth message', sessionId: SESSION_ID },
    });
    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).not.toHaveBeenCalled();
  });

  it('still skips title generation on a re-attached empty session (turnCount=0) — pre-F9 this fired', async () => {
    // Regression guard against the prior gating where `turnCount === 0`
    // also triggered title-gen on a re-attached empty session.
    const app = await buildApp({ isNew: false, turnCount: 0 });
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'first real turn', sessionId: SESSION_ID },
    });
    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).not.toHaveBeenCalled();
  });
});
