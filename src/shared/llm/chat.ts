import type { AppConfig } from '../secrets/config.js';
import { anthropicChat } from './anthropic.js';
import { buildBreaker } from './breaker.js';
import {
  LlmServiceUnavailableError,
  isFailClosedLlmError,
  shouldFallbackToFastModel,
  shouldUseSafeTemplate,
} from './errors.js';
import { groqChat } from './groq.js';
import { withRetry } from './retry.js';

export interface ChatRequest {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Token budget for the model output. */
  maxTokens: number;
  /** Per-call hard cap. Process #2 Step 9 caps primary at 5000ms. */
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  temperature?: number;
}

export type ModelUsed = 'claude-haiku-4-5' | 'llama-3.3-70b' | 'safe-template';
export type FallbackPath = 'none' | 'fast-model' | 'safe-template';

export interface ChatResponse {
  text: string;
  modelUsed: ModelUsed;
  fallbackPath: FallbackPath;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Process #2 Step 9 dispatch:
 *   1. Anthropic Claude Haiku 4.5, hard-cap 5s
 *   2. On timeout / rate-limit / circuit-open → Groq Llama 3.3 70B fast model
 *   3. On content-filter from either provider → safe template (no model retry)
 *   4. On 5xx from primary → fail-closed (caller maps to E11)
 *
 * Service-unavailable from the FALLBACK is also fail-closed. Auth failures at
 * any layer fail-closed (P0 incident).
 *
 * `safeTemplate` is the brand-aligned holding response for content-filter
 * scenarios, supplied by the caller (Process #10 owns the canonical text).
 */

const PRIMARY_TIMEOUT_DEFAULT_MS = 5000;
const FALLBACK_TIMEOUT_DEFAULT_MS = 2000;

let primaryBreaker:
  | ReturnType<
      typeof buildBreaker<
        [AppConfig, Parameters<typeof anthropicChat>[1]],
        Awaited<ReturnType<typeof anthropicChat>>
      >
    >
  | undefined;
let fallbackBreaker:
  | ReturnType<
      typeof buildBreaker<
        [AppConfig, Parameters<typeof groqChat>[1]],
        Awaited<ReturnType<typeof groqChat>>
      >
    >
  | undefined;

function getPrimaryBreaker(): NonNullable<typeof primaryBreaker> {
  primaryBreaker ??= buildBreaker('anthropic', anthropicChat);
  return primaryBreaker;
}
function getFallbackBreaker(): NonNullable<typeof fallbackBreaker> {
  fallbackBreaker ??= buildBreaker('groq', groqChat);
  return fallbackBreaker;
}

export async function chat(
  config: AppConfig,
  req: ChatRequest,
  safeTemplate: string,
): Promise<ChatResponse> {
  const start = Date.now();
  const primaryTimeoutMs = req.primaryTimeoutMs ?? PRIMARY_TIMEOUT_DEFAULT_MS;
  const fallbackTimeoutMs = req.fallbackTimeoutMs ?? FALLBACK_TIMEOUT_DEFAULT_MS;

  // ---- Primary: Anthropic Claude Haiku 4.5
  try {
    const result = await withRetry(() =>
      getPrimaryBreaker()(config, {
        model: 'claude-haiku-4-5',
        systemPrompt: req.systemPrompt,
        messages: req.messages,
        maxTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        timeoutMs: primaryTimeoutMs,
      }),
    );
    return {
      text: result.text,
      modelUsed: 'claude-haiku-4-5',
      fallbackPath: 'none',
      latencyMs: Date.now() - start,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (primaryErr) {
    if (shouldUseSafeTemplate(primaryErr)) {
      return safeTemplateResponse(safeTemplate, start);
    }
    if (!shouldFallbackToFastModel(primaryErr)) {
      // 5xx, auth, or unexpected — fail-closed.
      throw primaryErr;
    }

    // ---- Fallback: Groq Llama 3.3 70B
    try {
      const result = await getFallbackBreaker()(config, {
        model: 'llama-3.3-70b-versatile',
        systemPrompt: req.systemPrompt,
        messages: req.messages,
        maxTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        timeoutMs: fallbackTimeoutMs,
      });
      return {
        text: result.text,
        modelUsed: 'llama-3.3-70b',
        fallbackPath: 'fast-model',
        latencyMs: Date.now() - start,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    } catch (fallbackErr) {
      if (shouldUseSafeTemplate(fallbackErr)) {
        return safeTemplateResponse(safeTemplate, start);
      }
      if (isFailClosedLlmError(fallbackErr)) {
        throw fallbackErr;
      }
      // Anything else from the fallback (timeout, rate-limit again, transient
      // exhausted) — escalate to fail-closed; Process #2 routes to E11.
      throw new LlmServiceUnavailableError(
        'groq',
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      );
    }
  }
}

function safeTemplateResponse(text: string, startedAt: number): ChatResponse {
  return {
    text,
    modelUsed: 'safe-template',
    fallbackPath: 'safe-template',
    latencyMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Test reset helper. */
export function resetChatBreakersForTests(): void {
  primaryBreaker = undefined;
  fallbackBreaker = undefined;
}
