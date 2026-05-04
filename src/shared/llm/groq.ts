import Groq from 'groq-sdk';
import { type AppConfig, requireConfig } from '../secrets/config.js';
import {
  LlmAuthError,
  LlmContentFilterError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTransientError,
} from './errors.js';
import { withTimeout } from './retry.js';

let cached: Groq | undefined;

function getClient(config: AppConfig): Groq {
  if (cached === undefined) {
    cached = new Groq({ apiKey: requireConfig(config, 'groqApiKey') });
  }
  return cached;
}

export interface GroqChatRequest {
  model: 'llama-3.3-70b-versatile';
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  /** Caller can request strict JSON shape for intent-classification calls. */
  jsonMode?: boolean;
  timeoutMs: number;
}

export interface GroqChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function groqChat(config: AppConfig, req: GroqChatRequest): Promise<GroqChatResponse> {
  const client = getClient(config);

  const response = await withTimeout('groq', req.timeoutMs, async () => {
    try {
      return await client.chat.completions.create({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [
          { role: 'system', content: req.systemPrompt },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        ...(req.jsonMode === true ? { response_format: { type: 'json_object' as const } } : {}),
      });
    } catch (err) {
      throw mapGroqError(err);
    }
  });

  const text = response.choices[0]?.message?.content ?? '';
  return {
    text,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

function mapGroqError(err: unknown): Error {
  if (err instanceof Groq.APIError) {
    const status: number = typeof err.status === 'number' ? err.status : 0;
    if (status === 401 || status === 403) {
      return new LlmAuthError('groq', err);
    }
    if (status === 429) {
      return new LlmRateLimitError('groq', err);
    }
    if (status >= 500 && status < 600) {
      return new LlmServiceUnavailableError('groq', err);
    }
    if (status === 400) {
      const rawMsg: unknown = err.message;
      const msg = typeof rawMsg === 'string' ? rawMsg.toLowerCase() : '';
      if (msg.includes('content') || msg.includes('refus') || msg.includes('safety')) {
        return new LlmContentFilterError('groq', err);
      }
    }
    return new LlmTransientError('groq', status, err);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function resetGroqClientForTests(): void {
  cached = undefined;
}
