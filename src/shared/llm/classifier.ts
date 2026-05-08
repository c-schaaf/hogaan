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
 * Tolerant extraction: at temperature 0 with longer prompts (notably
 * Check 8's two-axis safety classifier) Haiku reliably emits a complete
 * JSON object followed by trailing content — a second `{...}` block, a
 * markdown trailer, or prose. The reconstructed text is run through
 * `extractFirstJsonObject` so callers receive only the first balanced
 * `{...}`. If no balanced object is found the raw text is returned
 * unchanged so the caller's `JSON.parse` still throws and the existing
 * fail-closed paths (notably Process #10 Check 8 → E6) still fire.
 * Brace-matching ignores `{` / `}` inside string literals (with `\"`
 * escape support) so an object whose value contains a `}` is not
 * truncated mid-field. RCA: 2026-05-08 production trace where every
 * turn degraded to E6 because Haiku appended a second JSON object after
 * the verdict block and strict `JSON.parse` rejected the trailing text.
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

/**
 * Return the substring spanning the first balanced `{...}` JSON object in
 * `text`, or `text` itself if no balanced object exists. Brace counting
 * skips characters inside string literals (`"..."`, with `\\` escape
 * handling) so that a `}` appearing inside a string value does not close
 * the object early.
 *
 * If `text` does not start with `{`, it is returned unchanged — the
 * caller's strict `JSON.parse` will then throw, preserving fail-closed
 * semantics for Check 8 + every other classifier consumer.
 */
function extractFirstJsonObject(text: string): string {
  if (text.length === 0 || text[0] !== '{') return text;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  return text;
}

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

  const reconstructed = res.text.startsWith(PREFILL) ? res.text : PREFILL + res.text;
  const text = extractFirstJsonObject(reconstructed);

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
  extractFirstJsonObject,
};
