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
 * No timeout / breaker / fallback applied at this layer — streaming has
 * different latency semantics (TTFB vs total) and a mid-stream timeout
 * would leave the user looking at a half-written reply. Callers handle
 * mid-stream errors by emitting an error event and closing.
 */
export interface AnthropicStreamFinal {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';
}

export async function* anthropicChatStream(
  config: AppConfig,
  req: Omit<AnthropicChatRequest, 'timeoutMs'>,
): AsyncGenerator<string, AnthropicStreamFinal, void> {
  const client = getClient(config);

  let stream;
  try {
    stream = client.messages.stream({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      system: req.systemPrompt,
      messages: req.messages,
    });
  } catch (err) {
    throw mapAnthropicError(err);
  }

  try {
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        event.delta.text.length > 0
      ) {
        yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      stopReason: final.stop_reason ?? 'end_turn',
    };
  } catch (err) {
    throw mapAnthropicError(err);
  }
}

export function resetAnthropicClientForTests(): void {
  cached = undefined;
}
