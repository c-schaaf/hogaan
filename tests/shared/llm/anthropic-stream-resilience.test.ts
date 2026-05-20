import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setAnthropicClientForTests,
  anthropicChatStream,
  resetAnthropicClientForTests,
} from '../../../src/shared/llm/anthropic.js';
import {
  LlmAuthError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTransientError,
} from '../../../src/shared/llm/errors.js';
import { fakeConfig } from '../../phase-10/helpers/fakes.js';

/**
 * SCRUM — pre-fix, the streaming path had zero resilience: any pre-first-
 * byte network blip surfaced as `LlmTransientError(provider, 0)`, which the
 * route echoed back to the user as the misleading
 * "anthropic transient error (0)" string. Stream-open is now wrapped in a
 * TTFB timeout + bounded retry, and the SDK's connection/abort classes
 * map to LlmServiceUnavailableError instead of transient(0).
 */

const messagesCreate = vi.fn();

function mockSdk() {
  // Inject a stub client whose `messages.create` is a vi.fn the test
  // controls. The real Anthropic class is still imported so SDK error
  // classes (APIError / APIConnectionError / ...) remain available for
  // `throw new Anthropic.APIError(...)` and instanceof checks.
  __setAnthropicClientForTests({ messages: { create: messagesCreate } } as unknown as Anthropic);
}

async function consume<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

function makeStream(deltas: string[]) {
  const events: Anthropic.RawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg-1',
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null,
        },
      } as never,
    },
    ...deltas.map(
      (text) =>
        ({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        }) as never,
    ),
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 } as never,
    } as never,
  ];
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          if (i < events.length) {
            return Promise.resolve({ value: events[i++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

const REQ = {
  model: 'claude-haiku-4-5' as const,
  systemPrompt: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 100,
};

describe('anthropicChatStream — stream-open resilience', () => {
  beforeEach(() => {
    resetAnthropicClientForTests();
    messagesCreate.mockReset();
    mockSdk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: yields deltas and a final', async () => {
    messagesCreate.mockResolvedValueOnce(makeStream(['Hello ', 'world.']));

    const gen = anthropicChatStream(fakeConfig(), REQ);
    const deltas = await consume(gen);
    expect(deltas).toEqual(['Hello ', 'world.']);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('retries stream-open once on APIConnectionError, then succeeds', async () => {
    const connErr = new Anthropic.APIConnectionError({ message: 'ECONNRESET' });
    messagesCreate.mockRejectedValueOnce(connErr).mockResolvedValueOnce(makeStream(['ok']));

    const gen = anthropicChatStream(fakeConfig(), REQ);
    const deltas = await consume(gen);
    expect(deltas).toEqual(['ok']);
    expect(messagesCreate).toHaveBeenCalledTimes(2);
  });

  it('maps a bare AbortError (name only) to LlmServiceUnavailableError after retries', async () => {
    const abortish = new Error('aborted');
    abortish.name = 'AbortError';
    messagesCreate.mockRejectedValue(abortish);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmServiceUnavailableError);
    // Bounded retry: opens stream STREAM_OPEN_MAX_ATTEMPTS times then gives up.
    expect(messagesCreate).toHaveBeenCalledTimes(2);
  });

  it('maps an SDK APIConnectionError to LlmServiceUnavailableError (not LlmTransientError(_,0))', async () => {
    const connErr = new Anthropic.APIConnectionError({ message: 'broken pipe' });
    messagesCreate.mockRejectedValue(connErr);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmServiceUnavailableError);
  });

  it('does NOT retry on a 401 — surfaces as LlmAuthError immediately', async () => {
    const authErr = Object.assign(new Anthropic.APIError(401, {}, '401 unauthorized', undefined), {
      status: 401,
    });
    messagesCreate.mockRejectedValue(authErr);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmAuthError);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a 429 — surfaces as LlmRateLimitError immediately', async () => {
    const rateErr = Object.assign(new Anthropic.APIError(429, {}, 'too many', undefined), {
      status: 429,
    });
    messagesCreate.mockRejectedValue(rateErr);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmRateLimitError);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a 500 — surfaces as LlmServiceUnavailableError immediately', async () => {
    const srvErr = Object.assign(new Anthropic.APIError(500, {}, 'boom', undefined), {
      status: 500,
    });
    messagesCreate.mockRejectedValue(srvErr);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmServiceUnavailableError);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('a non-retryable 400 (no connection class) surfaces as LlmTransientError with the real status (not 0)', async () => {
    const badReq = Object.assign(new Anthropic.APIError(400, {}, 'bad request', undefined), {
      status: 400,
    });
    messagesCreate.mockRejectedValue(badReq);

    const gen = anthropicChatStream(fakeConfig(), REQ);
    // Crucially: status is 400, not the misleading 0 the audit flagged.
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmTransientError);
    await expect(consume(anthropicChatStream(fakeConfig(), REQ))).rejects.toThrow(/\(400\)/);
  });
});
