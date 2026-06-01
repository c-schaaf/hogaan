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
 * F4 (beta pre-flight): the streaming chat handler MUST NOT echo raw
 * exception text back to the browser. Pre-fix, routes.ts:380 wrote
 * `stream failed: ${err.message}` into the SSE error frame — leaking
 * Drizzle / Anthropic / postgres-js internals to any client console.
 *
 * This test forces the LLM stream to throw a recognisable secret-looking
 * error and asserts that:
 *   1. the secret never appears in any SSE frame the client receives,
 *   2. the SSE error frame carries the fixed generic copy,
 *   3. the frame includes a correlationId for support handoff.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-errcopy-001';
const SECRET_LIKE_ERROR =
  'PostgresError: connection terminated unexpectedly at db-prod-east-2.internal:5432';

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
  chat: vi.fn().mockRejectedValue(new Error('chat() fallback also failed')),
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

async function wireMocks() {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const { resolveSession } = await import('../../src/session-lifecycle/index.js');
  vi.mocked(resolveSession).mockResolvedValue({
    sessionId: SESSION_ID as never,
    isNew: true,
    turnCount: 0,
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
    libraryVersions: {
      promptTemplates: { version: 'v1', hash: 'h-pt' },
      voiceRules: { version: 'v2', hash: 'h-vr' },
      culturalFraming: { version: 'v3', hash: 'h-cf' },
      resolvedAt: new Date(),
    },
  } as never);

  const { chatStream } = await import('../../src/shared/llm/chat.js');
  vi.mocked(chatStream).mockImplementation(
    () =>
      (async function* () {
        throw new Error(SECRET_LIKE_ERROR);
      })() as never,
  );
}

async function buildApp() {
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

describe('POST /api/chat/turn/stream — SSE error frame copy (F4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never leaks raw exception text in the SSE error frame', async () => {
    await wireMocks();
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'will fail' },
    });

    const body = res.payload;

    // Hard guarantee: the actual error message must never reach the wire.
    expect(body).not.toContain(SECRET_LIKE_ERROR);
    expect(body).not.toContain('PostgresError');
    expect(body).not.toContain('db-prod-east-2');
    expect(body).not.toContain('stream failed:');
  });

  it('emits the fixed generic copy with a correlationId on failure', async () => {
    await wireMocks();
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'will fail' },
    });

    const body = res.payload;

    // Find the SSE error event line and parse it.
    const lines = body.split('\n');
    const dataLineIdx = lines.findIndex(
      (l, i) => l.startsWith('data:') && lines[i - 1] === 'event: error',
    );
    expect(dataLineIdx).toBeGreaterThan(-1);

    const rawJson = lines[dataLineIdx]!.slice('data:'.length).trim();
    const parsed = JSON.parse(rawJson) as { message?: unknown; correlationId?: unknown };

    expect(parsed.message).toBe('The coach is briefly unavailable. Please try again.');
    expect(typeof parsed.correlationId).toBe('string');
    expect((parsed.correlationId as string).length).toBeGreaterThan(0);
  });
});
