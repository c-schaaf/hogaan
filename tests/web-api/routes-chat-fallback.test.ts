import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import { fakeConfig, fakeRateLimiters, fakeRedis } from '../phase-10/helpers/fakes.js';
import type { TraceEmitter, TurnTrace } from '../../src/shared/trace/index.js';

/**
 * SCRUM-F1: streaming chat handler must fall back to non-streaming chat()
 * (Anthropic primary + Groq fallback) when the Anthropic stream errors
 * BEFORE any words have been delivered to the user. Mid-stream failures
 * cannot be recovered and must propagate to the SSE error event path.
 *
 * Five scoped cases cover the behaviour:
 *   1. Anthropic stream fails immediately → fallback fires → user gets one
 *      delta + end, TurnTrace tagged with fallbackPath='fast-model'.
 *   2. Anthropic stream succeeds → no fallback, normal flow (regression
 *      guard so the success path doesn't accidentally start invoking
 *      chat()).
 *   3. Anthropic streams 2 deltas then fails → fallback does NOT fire (the
 *      mid-stream invariant; we cannot undo what the user already saw).
 *   4. Anthropic stream fails AND fallback chat() also fails → user gets
 *      the SSE error event (existing F4 generic copy + correlationId).
 *   5. TurnTrace degradationFlags.fallbackModelUsed=true when Groq served
 *      the response — the single most actionable Anthropic-outage signal.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-f1-001';

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
  chat: vi.fn(),
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

async function wireBasicMocks() {
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

describe('POST /api/chat/turn/stream — SCRUM-F1 fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('case 1 — Anthropic stream-open failure triggers fallback; user gets a single delta + end', async () => {
    await wireBasicMocks();
    const { chatStream, chat } = await import('../../src/shared/llm/chat.js');
    // chatStream throws on the FIRST .next() call — before any delta.
    vi.mocked(chatStream).mockImplementation(
      () =>
        (async function* () {
          throw new Error('Anthropic stream open failed (503)');
        })() as never,
    );
    // chat() returns the Groq fallback response.
    vi.mocked(chat).mockResolvedValue({
      text: 'A fallback coaching response from Groq Llama.',
      modelUsed: 'llama-3.3-70b',
      fallbackPath: 'fast-model',
      latencyMs: 1500,
      inputTokens: 3700,
      outputTokens: 12,
    } as never);

    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'I have a hard conversation tomorrow.' },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(1);

    // SSE wire should carry exactly: start → delta(full text) → end.
    const body = res.payload;
    expect(body).toContain('event: start');
    expect(body).toContain('event: delta');
    expect(body).toContain('A fallback coaching response from Groq Llama.');
    expect(body).toContain('event: end');
    // The Anthropic-side error message must never reach the wire.
    expect(body).not.toContain('Anthropic stream open failed');

    // Exactly ONE delta — the fallback is delivered atomically.
    const deltaCount = body.split('event: delta').length - 1;
    expect(deltaCount).toBe(1);
  });

  it('case 2 — Anthropic streaming succeeds end-to-end → no fallback, normal multi-delta flow', async () => {
    await wireBasicMocks();
    const { chatStream, chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chatStream).mockImplementation(
      () =>
        (async function* () {
          yield 'Hello ';
          yield 'there. ';
          yield 'What is heaviest?';
          return { modelUsed: 'claude-haiku-4-5' };
        })() as never,
    );
    vi.mocked(chat).mockResolvedValue({ text: 'SHOULD NOT BE CALLED' } as never);

    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'good morning' },
    });

    expect(res.statusCode).toBe(200);
    // Regression guard: the success path must NOT invoke chat() — that would
    // double the Anthropic spend per turn on every healthy turn.
    expect(vi.mocked(chat)).not.toHaveBeenCalled();

    const body = res.payload;
    expect(body).not.toContain('SHOULD NOT BE CALLED');
    // Three deltas streamed individually, not concatenated.
    const deltaCount = body.split('event: delta').length - 1;
    expect(deltaCount).toBe(3);
  });

  it('case 3 — mid-stream failure (after at least one delta) does NOT fall back', async () => {
    await wireBasicMocks();
    const { chatStream, chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chatStream).mockImplementation(
      () =>
        (async function* () {
          yield 'I hear ';
          yield 'you. ';
          // Stream dies HERE — we have already shown the user partial text.
          throw new Error('Anthropic stream died mid-flight');
        })() as never,
    );
    vi.mocked(chat).mockResolvedValue({ text: 'SHOULD NOT BE CALLED' } as never);

    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'walk me through firing' },
    });

    // Cannot recover — chat() must NOT be invoked when we've already shown
    // the user partial text from a different model.
    expect(vi.mocked(chat)).not.toHaveBeenCalled();

    const body = res.payload;
    // Partial text shown to user
    expect(body).toContain('I hear');
    expect(body).toContain('you.');
    // SSE error frame carries the F4 generic copy (no raw exception text)
    expect(body).toContain('The coach is briefly unavailable');
    expect(body).not.toContain('Anthropic stream died mid-flight');
  });

  it('case 4 — Anthropic stream fails AND fallback chat() also fails → SSE error frame fires', async () => {
    await wireBasicMocks();
    const { chatStream, chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chatStream).mockImplementation(
      () =>
        (async function* () {
          throw new Error('Anthropic 503');
        })() as never,
    );
    vi.mocked(chat).mockRejectedValue(new Error('Both providers down'));

    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'help me' },
    });

    expect(vi.mocked(chat)).toHaveBeenCalledTimes(1);
    const body = res.payload;
    // F4 generic copy + correlationId, NOT raw exception text.
    expect(body).toContain('The coach is briefly unavailable');
    expect(body).not.toContain('Anthropic 503');
    expect(body).not.toContain('Both providers down');
  });

  it('case 5 — TurnTrace correctly tags fallback turns (fallbackPath=fast-model, modelUsed=llama, degradationFlags.fallbackModelUsed=true)', async () => {
    await wireBasicMocks();
    const { chatStream, chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chatStream).mockImplementation(
      () =>
        (async function* () {
          throw new Error('Anthropic stream open failed');
        })() as never,
    );
    vi.mocked(chat).mockResolvedValue({
      text: 'Fallback response.',
      modelUsed: 'llama-3.3-70b',
      fallbackPath: 'fast-model',
      latencyMs: 1500,
      inputTokens: 3700,
      outputTokens: 4,
    } as never);

    const emitter = recordingEmitter();
    const app = await buildApp(emitter);

    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'help' },
    });

    expect(emitter.records).toHaveLength(1);
    const r = emitter.records[0]!;
    expect(r.modelUsed).toBe('llama-3.3-70b');
    expect(r.fallbackPath).toBe('fast-model');
    expect(r.degradationFlags.fallbackModelUsed).toBe(true);
    // Hard Rule #3 — userIdHash, never raw uuid.
    expect(r.userIdHash).toMatch(/^[a-f0-9]{16}$/);
    expect(r.terminalEvent).toBe('Process_2.Step_StreamComplete');
  });
});
