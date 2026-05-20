import Anthropic from '@anthropic-ai/sdk';
import { type AppConfig, requireConfig } from '../secrets/config.js';
import {
  LlmAuthError,
  LlmContentFilterError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTransientError,
} from './errors.js';
import { withTimeout } from './retry.js';

let cached: Anthropic | undefined;

function getClient(config: AppConfig): Anthropic {
  if (cached === undefined) {
    cached = new Anthropic({ apiKey: requireConfig(config, 'anthropicApiKey') });
  }
  return cached;
}

export interface AnthropicChatRequest {
  model: 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7';
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
}

export interface AnthropicChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';
}

export async function anthropicChat(
  config: AppConfig,
  req: AnthropicChatRequest,
): Promise<AnthropicChatResponse> {
  const client = getClient(config);

  const response = await withTimeout('anthropic', req.timeoutMs, async () => {
    try {
      return await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        system: req.systemPrompt,
        messages: req.messages,
      });
    } catch (err) {
      throw mapAnthropicError(err);
    }
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason ?? 'end_turn',
  };
}

function mapAnthropicError(err: unknown): Error {
  // SCRUM — connection/abort/pre-flight failures had no numeric HTTP status,
  // so the prior code path flattened them to `LlmTransientError(provider, 0)`
  // which read in production logs as the misleading
  // `anthropic transient error (0)`. They are now mapped to
  // LlmServiceUnavailableError BEFORE the status flatten so callers can
  // dispatch a real "service unavailable" branch.
  if (
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    err instanceof Anthropic.APIUserAbortError
  ) {
    return new LlmServiceUnavailableError('anthropic', err);
  }
  // Defence-in-depth: cover the abort class even when the SDK didn't wrap
  // it (some Node fetch paths surface a raw AbortError).
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIConnectionError')) {
    return new LlmServiceUnavailableError('anthropic', err);
  }
  if (err instanceof Anthropic.APIError) {
    const status: number = typeof err.status === 'number' ? err.status : 0;
    if (status === 401 || status === 403) {
      return new LlmAuthError('anthropic', err);
    }
    if (status === 429) {
      return new LlmRateLimitError('anthropic', err);
    }
    if (status >= 500 && status < 600) {
      return new LlmServiceUnavailableError('anthropic', err);
    }
    if (status === 400) {
      // Anthropic returns 400 with type=invalid_request_error for content filter
      // and prompt-too-long. We can't always tell them apart from the SDK
      // surface, so be conservative: treat 400 with refusal-shaped message as
      // content filter, otherwise transient.
      const rawMsg: unknown = err.message;
      const msg = typeof rawMsg === 'string' ? rawMsg.toLowerCase() : '';
      if (msg.includes('content') || msg.includes('refus') || msg.includes('safety')) {
        return new LlmContentFilterError('anthropic', err);
      }
    }
    return new LlmTransientError('anthropic', status, err);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Streaming variant of anthropicChat. Yields text deltas as the model
 * generates them. The final accumulated text + usage are returned in the
 * resolved promise after the stream closes.
 *
 * Stream-open is wrapped in a TTFB timeout + bounded retry: an
 * APIConnectionError or APIConnectionTimeoutError on the open is retried
 * once with backoff. Once the first byte has arrived the stream proceeds
 * un-supervised — a mid-stream timeout would leave the user looking at a
 * half-written reply, and re-opening the stream after deltas have been
 * delivered would duplicate the bot bubble.
 */
export interface AnthropicStreamFinal {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';
}

/**
 * Stream-open guard rails. The 8s TTFB cap mirrors what production observed
 * as healthy stream-start latency from Render-Virginia → Anthropic on
 * 3700-token coaching prompts (well under p95). Retry attempts are bounded
 * so we never multiply user-perceived latency more than 2x.
 */
const STREAM_OPEN_TIMEOUT_MS = 8_000;
const STREAM_OPEN_MAX_ATTEMPTS = 2;

function isStreamOpenRetryable(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

type AnthropicStream = Awaited<ReturnType<Anthropic['messages']['create']>> &
  AsyncIterable<Anthropic.RawMessageStreamEvent>;

async function openStreamWithRetry(
  client: Anthropic,
  req: Omit<AnthropicChatRequest, 'timeoutMs'>,
): Promise<AnthropicStream> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= STREAM_OPEN_MAX_ATTEMPTS; attempt++) {
    try {
      // Lower-level streaming API — returns an async iterable of raw events.
      // Preferred over messages.stream() because event types are stable across
      // SDK versions and we don't depend on the helper's finalMessage() shape.
      // The SDK types the return as a union of Message | Stream; since we
      // pass stream:true the runtime value is always the Stream branch.
      const result = await withTimeout('anthropic', STREAM_OPEN_TIMEOUT_MS, () =>
        client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          system: req.systemPrompt,
          messages: req.messages,
          stream: true,
        }),
      );
      return result as AnthropicStream;
    } catch (err) {
      lastErr = err;
      // Only retry on connection / abort class errors. Auth, rate-limit,
      // 4xx content issues, and 5xx server errors should surface immediately
      // — retrying them just wastes the user's time.
      if (!isStreamOpenRetryable(err) || attempt === STREAM_OPEN_MAX_ATTEMPTS) break;
      const exp = Math.min(1000, 250 * 2 ** (attempt - 1));
      await sleep(Math.floor(Math.random() * exp));
    }
  }
  throw lastErr;
}

export async function* anthropicChatStream(
  config: AppConfig,
  req: Omit<AnthropicChatRequest, 'timeoutMs'>,
): AsyncGenerator<string, AnthropicStreamFinal, void> {
  const client = getClient(config);

  let stream;
  try {
    stream = await openStreamWithRetry(client, req);
  } catch (err) {
    throw mapAnthropicError(err);
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: AnthropicStreamFinal['stopReason'] = 'end_turn';

  try {
    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
        outputTokens = event.message.usage.output_tokens;
      } else if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        event.delta.text.length > 0
      ) {
        text += event.delta.text;
        yield event.delta.text;
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
        const sr = event.delta.stop_reason;
        if (
          sr === 'end_turn' ||
          sr === 'max_tokens' ||
          sr === 'stop_sequence' ||
          sr === 'tool_use' ||
          sr === 'pause_turn' ||
          sr === 'refusal'
        ) {
          stopReason = sr;
        }
      }
    }
  } catch (err) {
    throw mapAnthropicError(err);
  }

  return { text, inputTokens, outputTokens, stopReason };
}

export function resetAnthropicClientForTests(): void {
  cached = undefined;
}

/**
 * Test-only seam — inject a stub client so the streaming + retry paths can
 * be exercised without a network call. The override is removed by
 * `resetAnthropicClientForTests`.
 */
export function __setAnthropicClientForTests(stub: Anthropic): void {
  cached = stub;
}
