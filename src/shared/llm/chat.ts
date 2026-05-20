import type { AppConfig } from '../secrets/config.js';
import { anthropicChat, anthropicChatStream, type AnthropicStreamFinal } from './anthropic.js';
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
  /** Per-call hard cap. Process #2 Step 9 caps primary at 12000ms. */
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
 *   1. Anthropic Claude Haiku 4.5, hard-cap 12s
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

// Raised from 5000ms to 12000ms on 2026-05-07 based on production diagnostic
// showing Haiku TTFT + streaming on 3700-token coaching prompts routinely
// exceeds 5s from Render-Virginia → Anthropic. Result: every coaching turn
// was timing out Haiku and falling through to Llama, which fails Hogaan
// voice rules at 4/9 QC checks. The 5000ms cap was a Batch C era default
// tuned for small prompts. The total turn budget (LATENCY_BUDGET_MS = 15000)
// gives room for this raise — primary should be ~80% of the budget, leaving
// headroom for context-fetch, tagger, prompt-assembly, QC, and delivery.
// See debug/full-pipeline-instrumentation 2026-05-07 logs for evidence.
const PRIMARY_TIMEOUT_DEFAULT_MS = 12000;
const FALLBACK_TIMEOUT_DEFAULT_MS = 2000;

/**
 * Single source of truth for the primary model identifier. Today this is
 * an alias (latest 4.5). Pinning to a dated id like 'claude-haiku-4-5-20251001'
 * would lock production to a known snapshot and shield us from alias drift —
 * do that here when we're ready to take the migration cost. The
 * AnthropicChatRequest model union still type-narrows to the alias.
 */
const PRIMARY_MODEL_ID = 'claude-haiku-4-5' as const;

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
        model: PRIMARY_MODEL_ID,
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

/**
 * Streaming variant of chat(). Primary-only — Claude Haiku 4.5 with no
 * Groq fallback (streaming + cross-provider fallback is complex; first
 * iteration ships without it). On any error during the stream the
 * generator throws and the caller emits an SSE error event.
 *
 * Yields: text deltas as the model generates them.
 * Returns: final accumulated text + token usage after the stream closes.
 */
export interface ChatStreamFinal extends AnthropicStreamFinal {
  modelUsed: 'claude-haiku-4-5';
  latencyMs: number;
}

export async function* chatStream(
  config: AppConfig,
  req: Omit<ChatRequest, 'primaryTimeoutMs' | 'fallbackTimeoutMs'>,
): AsyncGenerator<string, ChatStreamFinal, void> {
  const start = Date.now();
  const final = yield* anthropicChatStream(config, {
    model: 'claude-haiku-4-5',
    systemPrompt: req.systemPrompt,
    messages: req.messages,
    maxTokens: req.maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
  return {
    ...final,
    modelUsed: 'claude-haiku-4-5',
    latencyMs: Date.now() - start,
  };
}

/** Test reset helper. */
export function resetChatBreakersForTests(): void {
  primaryBreaker = undefined;
  fallbackBreaker = undefined;
}

/** Test seam — exposes the per-call timeout constants for invariant assertion
 *  against the circuit-breaker defaults in src/shared/llm/breaker.ts. */
export const _internal = { PRIMARY_TIMEOUT_DEFAULT_MS, FALLBACK_TIMEOUT_DEFAULT_MS };
