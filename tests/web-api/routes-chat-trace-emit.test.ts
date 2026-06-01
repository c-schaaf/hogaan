import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { fakeConfig, fakeRateLimiters, fakeRedis } from '../phase-10/helpers/fakes.js';
import type { TraceEmitter, TurnTrace } from '../../src/shared/trace/index.js';

/**
 * Regression test for the Axiom-dataset-empty bug: the streaming chat handler
 * MUST call traceEmitter.emit exactly once per turn — both on success and on
 * failure. Pre-fix the emit call was missing entirely (left out when the
 * multi-step pipeline was removed in SCRUM-43), so Axiom received zero events
 * and the Stream page stayed on the empty-state "choose ingest method"
 * screen forever.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-trace-001';

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
  chat: vi.fn().mockRejectedValue(new Error('chat() not used in this test path')),
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

function recordingEmitter(): TraceEmitter & { records: TurnTrace[] } {
  const records: TurnTrace[] = [];
  return {
    records,
    emit(record) {
      records.push(record);
    },
    flush: () => Promise.resolve(),
  };
}

async function wireMocks(opts: { streamThrows?: boolean } = {}) {
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
        if (opts.streamThrows === true) {
          throw new Error('upstream LLM 503');
        }
        yield 'hello';
        return { modelUsed: 'claude-haiku-4-5' };
      })() as never,
  );
}

async function buildApp(emitter: TraceEmitter) {
  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: passthroughDb() as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: emitter,
  });
  await app.ready();
  return app;
}

describe('POST /api/chat/turn/stream — TurnTrace emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits exactly one TurnTrace per successful turn with PII-safe userIdHash', async () => {
    await wireMocks();
    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'first message' },
    });

    expect(emitter.records).toHaveLength(1);
    const r = emitter.records[0]!;
    expect(r.sessionId).toBe(SESSION_ID);
    expect(r.turnId).toBe('turn-1');
    expect(r.terminalEvent).toBe('Process_2.Step_StreamComplete');
    expect(r.modelUsed).toBe('claude-haiku-4-5');
    expect(r.qaOutcome).toBe('skipped');
    expect(r.libraryVersions.promptTemplates.version).toBe('v1');
    // Hard Rule #3 — never plaintext userId in trace.
    expect(r.userIdHash).not.toBe(TEST_USER_ID);
    expect(r.userIdHash).toMatch(/^[a-f0-9]{16}$/);
    expect(typeof r.latencyMs).toBe('number');
  });

  it('emits a TurnTrace for failed turns too with service-unavailable outcome', async () => {
    await wireMocks({ streamThrows: true });
    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'will fail' },
    });

    expect(emitter.records).toHaveLength(1);
    const r = emitter.records[0]!;
    expect(r.terminalEvent).toBe('Process_2.Step_StreamFailed');
    expect(r.qaOutcome).toBe('service-unavailable');
    expect(r.fallbackPath).toBe('service-unavailable');
    expect(r.modelUsed).toBe('none');
    // The session was resolved before the throw, so sessionId is populated.
    expect(r.sessionId).toBe(SESSION_ID);
  });
});
