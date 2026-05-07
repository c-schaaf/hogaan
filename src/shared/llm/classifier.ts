import { anthropicChat } from './anthropic.js';
import type { AppConfig } from '../secrets/config.js';

/**
 * Small/fast classifier wrapper on Anthropic Haiku 4.5.
 *
 * Used for short, structured-JSON classification calls (intent triage,
 * practice-grounding judge). Distinct from the primary coaching `chat()`
 * (which is also Haiku 4.5 but for full coaching responses with retry +
 * Groq fallback + safe template).
 *
 * Anthropic has no native JSON mode (no `response_format: json_object`
 * like Groq/OpenAI). To force-JSON we use the "prefill" pattern: append
 * an assistant turn whose content is the literal `{` character.
 * Haiku continues from `{` and produces well-formed JSON. The wrapper
 * reconstructs the full JSON by prepending `{` to the response text.
 *
 * Defensive: if Haiku ignores the prefill and returns text already
 * starting with `{`, return as-is.
 *
 * Errors propagate via the existing LlmError hierarchy (anthropicChat
 * already maps Anthropic API errors). Callers' `catch (err)` blocks for
 * `LlmError`/`LlmServiceUnavailableError` etc. continue to work
 * unchanged after migration from groqChat.
 */

const DEFAULT_MAX_TOKENS = 200;
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_TEMPERATURE = 0;

export interface ClassifierChatRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Default 200. Small JSON output. */
  maxTokens?: number;
  /** Default 0 (deterministic for classification). */
  temperatureOverride?: number;
  /** Default 4000ms. Same per-call budget the Groq classifier had. */
  timeoutMs?: number;
}

export interface ClassifierChatResponse {
  /** Reconstructed JSON text. Always starts with `{`. */
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const PREFILL = '{';

export async function classifierChat(
  config: AppConfig,
  req: ClassifierChatRequest,
): Promise<ClassifierChatResponse> {
  const res = await anthropicChat(config, {
    model: 'claude-haiku-4-5',
    systemPrompt: req.systemPrompt,
    messages: [
      { role: 'user', content: req.userPrompt },
      { role: 'assistant', content: PREFILL },
    ],
    maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: req.temperatureOverride ?? DEFAULT_TEMPERATURE,
    timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const text = res.text.startsWith(PREFILL) ? res.text : PREFILL + res.text;

  return {
    text,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}

export const _internal = {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TEMPERATURE,
  PREFILL,
};
