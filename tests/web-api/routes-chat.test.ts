import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
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

  // SCRUM-B9: SSE backpressure / client-disconnect cleanup. When the
  // browser drops the connection mid-stream, the LLM call's AbortController
  // must fire so we free the DB pool slot and stop Anthropic billing.
  describe('SCRUM-B9 — client-disconnect cleanup', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('aborts the LLM AbortController when the client closes the connection mid-stream', async () => {
      const { chatStream } = await import('../../src/shared/llm/chat.js');
      const { resolveSession } = await import('../../src/session-lifecycle/index.js');
      const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
      const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');
      const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');

      vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);
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

      // The chat stream yields one delta then blocks until the test allows
      // it to continue. The test triggers the client-close BEFORE releasing
      // the second yield — so the route's next loop iteration sees the
      // aborted signal and bails. The generator is created OUTSIDE the
      // mockImplementation so we can hold a reference and spy on its
      // .return() — the SDK iterator cleanup path that releases the
      // upstream connection (the real Anthropic-billing-stop signal).
      let releaseSecondDelta: (() => void) | undefined;
      const secondDeltaGate = new Promise<void>((resolve) => {
        releaseSecondDelta = resolve;
      });
      const gen = (async function* (): AsyncGenerator<string, unknown, void> {
        yield 'first ';
        await secondDeltaGate;
        yield 'second';
        return {
          modelUsed: 'claude-haiku-4-5',
          text: 'first second',
          inputTokens: 1,
          outputTokens: 2,
        };
      })();
      const streamReturnSpy = vi.spyOn(gen, 'return');
      vi.mocked(chatStream).mockReturnValue(gen as never);

      // Spy on AbortController.prototype.abort so we can assert it was
      // called once for this route invocation.
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      // Hook on onRequest so the test can grab req.raw for the streaming
      // turn and emit 'close' on it mid-flight.
      let capturedReq: FastifyRequest | undefined;
      const app = Fastify({ logger: false });
      app.addHook('onRequest', async (req) => {
        if (req.url === '/api/chat/turn/stream') {
          capturedReq = req;
        }
      });
      registerWebApiRoutes(app, {
        config: fakeConfig(),
        db: buildChatDb() as never,
        redis: fakeRedis(),
        rateLimiters: fakeRateLimiters(),
        traceEmitter: fakeTraceEmitter(),
      });
      await app.ready();

      const injectPromise = app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'hello' },
      });

      // Wait until the request handler has captured the raw socket AND the
      // first delta has gone out. A small polling loop avoids depending on
      // wall-clock timing.
      const waitForCapture = async (): Promise<void> => {
        for (let i = 0; i < 50; i++) {
          if (capturedReq !== undefined) return;
          await new Promise((r) => setImmediate(r));
        }
        throw new Error('request never reached the route handler');
      };
      await waitForCapture();
      // Yield a couple of microtask ticks so the first `yield 'first '`
      // can flush through to sendEvent before we trip the close.
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));

      // Trigger the client-disconnect: this is what Node emits when the
      // browser drops the TCP connection.
      capturedReq?.raw.emit('close');
      // Release the gate so the generator can move forward; the route's
      // loop will see signal.aborted=true and call stream.return().
      releaseSecondDelta?.();

      await injectPromise;

      expect(abortSpy).toHaveBeenCalled();
      // The actual cleanup happens via the iterator-protocol `.return()` —
      // that's what closes the underlying SDK connection. Calling abort()
      // alone is symbolic; without stream.return() the upstream HTTP
      // socket leaks. Pin both to prevent a future regression that drops
      // the stream.return() call from the route.
      expect(streamReturnSpy).toHaveBeenCalled();
    });

    it('happy path: stream completes naturally without abort being triggered', async () => {
      const { chatStream } = await import('../../src/shared/llm/chat.js');
      const { resolveSession } = await import('../../src/session-lifecycle/index.js');
      const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
      const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');
      const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');

      vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);
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
        yield 'hello there';
        return {
          modelUsed: 'claude-haiku-4-5',
          text: 'hello there',
          inputTokens: 1,
          outputTokens: 2,
        };
      } as never);

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'hello' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      // The happy-path SSE body contains an end event and our delta.
      expect(res.body).toContain('event: delta');
      expect(res.body).toContain('event: end');
      // Abort must NOT have been called on the happy path.
      expect(abortSpy).not.toHaveBeenCalled();
    });

    // Issue 2: Every-turn 4.5-6.5s post-deploy regression. Root cause: in
    // production HTTP/1.1, Node's IncomingMessage emits 'close' immediately
    // after `reply.raw.end()` (the response is "done"). With the previous
    // ordering (`reply.raw.end()` then `streamCompleted = true`), the close
    // handler observed `streamCompleted === false` and called
    // `streamController.abort()` on every successful turn. This was the
    // tail-latency contract violation that the audit caught.
    //
    // Lock the contract: by the time `req.raw` emits 'close' on the happy
    // path, `streamCompleted` MUST already be true, so the close listener
    // does NOT call abort() and does NOT call stream.return(). The fix is
    // to set `streamCompleted = true` BEFORE `reply.raw.end()` (and before
    // emitting the final 'end' SSE event for symmetry with the abort path).
    it('happy path: late req.raw close (post-end) does NOT abort or call stream.return', async () => {
      const { chatStream } = await import('../../src/shared/llm/chat.js');
      const { resolveSession } = await import('../../src/session-lifecycle/index.js');
      const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
      const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');
      const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');

      vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);
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

      // Generator that yields a single delta and returns naturally — the
      // happy path. We hold a reference so we can spy on `.return()` and
      // assert it is NEVER called.
      const gen = (async function* (): AsyncGenerator<string, unknown, void> {
        yield 'hello';
        return {
          modelUsed: 'claude-haiku-4-5',
          text: 'hello',
          inputTokens: 1,
          outputTokens: 1,
        };
      })();
      const streamReturnSpy = vi.spyOn(gen, 'return');
      vi.mocked(chatStream).mockReturnValue(gen as never);

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      // Capture the FastifyRequest so we can simulate Node's production
      // behavior: after `reply.raw.end()` completes, IncomingMessage emits
      // 'close'. We replay that emission immediately after `reply.raw.end()`
      // by hooking onResponse — onResponse fires AFTER the route handler
      // has returned and AFTER reply.raw.end() has been called.
      let capturedReq: FastifyRequest | undefined;
      const app = Fastify({ logger: false });
      app.addHook('onRequest', async (req) => {
        if (req.url === '/api/chat/turn/stream') {
          capturedReq = req;
        }
      });
      // Fire the close event the moment Fastify reports the response is
      // complete. In production this corresponds to the keep-alive socket
      // signalling that the request lifecycle has ended — Node fires this
      // immediately after end() in HTTP/1.1.
      app.addHook('onResponse', async (req) => {
        if (req.url === '/api/chat/turn/stream') {
          req.raw.emit('close');
        }
      });
      registerWebApiRoutes(app, {
        config: fakeConfig(),
        db: buildChatDb() as never,
        redis: fakeRedis(),
        rateLimiters: fakeRateLimiters(),
        traceEmitter: fakeTraceEmitter(),
      });
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/turn/stream',
        payload: { message: 'hello' },
      });

      // Sanity: the request completed normally.
      expect(res.statusCode).toBe(200);
      expect(capturedReq).toBeDefined();

      // CONTRACT: on the happy path, the late 'close' event must NOT
      // trigger the abort handler. If `streamCompleted` is not set BEFORE
      // `reply.raw.end()` then the close listener observes `false`, calls
      // `streamController.abort()`, and any downstream cleanup (e.g.
      // stream.return() on the SDK iterator) runs spuriously — that was
      // the regression.
      expect(abortSpy).not.toHaveBeenCalled();
      expect(streamReturnSpy).not.toHaveBeenCalled();
    });
  });
});
