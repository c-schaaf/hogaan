import { stripPii, type PiiFilterOptions } from '../pii/filter.js';
import type { AppConfig, BackgroundModelId, ChatModelId } from '../secrets/config.js';
import {
  anthropicChat,
  anthropicChatStream,
  type AnthropicStreamFinal,
  type SystemBlock,
} from './anthropic.js';
import { buildBreaker } from './breaker.js';
import {
  LlmServiceUnavailableError,
  isFailClosedLlmError,
  shouldFallbackToFastModel,
  shouldUseSafeTemplate,
} from './errors.js';
import { groqChat } from './groq.js';
import { withRetry } from './retry.js';
import { scriptedCoachReply, scriptedStream } from './scripted.js';

/**
 * A system block. `trusted: true` marks library content (Hamse-owned system
 * prompt, knowledge digest) that is NOT run through the PII filter — it
 * legitimately names public people. Everything else is filtered.
 */
export interface ChatSystemBlock extends SystemBlock {
  trusted?: boolean;
}

export interface ChatRequest {
  systemPrompt: string;
  /** Preferred over `systemPrompt` when present (cache breakpoints + trust marks). */
  systemBlocks?: ChatSystemBlock[];
  /** Extra names to strip for this caller (e.g. the leader's own surname). */
  pii?: PiiFilterOptions;
  /** Demo-mode stand-in text. Default: the scripted coach reply. */
  scripted?: () => string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Token budget for the model output. */
  maxTokens: number;
  /** Per-call hard cap. Process #2 Step 9 caps primary at 12000ms. */
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  temperature?: number;
}

export type ModelUsed = ChatModelId | 'llama-3.3-70b' | 'safe-template' | 'scripted-demo';
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
const DEFAULT_CHAT_MODEL: ChatModelId = 'claude-haiku-4-5';

function chatModel(config: AppConfig): ChatModelId {
  return config.llmChatModel ?? DEFAULT_CHAT_MODEL;
}

/**
 * Demo mode with no model key: answer with the scripted stand-in coach.
 * Impossible in production because loadConfig refuses DEMO_MODE there.
 */
export function useScriptedModel(config: AppConfig): boolean {
  return config.demoMode === true && config.anthropicApiKey === undefined;
}

/**
 * D2 privacy filter at the provider boundary. Every message and every
 * untrusted system block passes through stripPii before any provider call.
 */
export function sanitizeRequest<
  T extends ChatRequest | Omit<ChatRequest, 'primaryTimeoutMs' | 'fallbackTimeoutMs'>,
>(req: T): T {
  const opts = req.pii ?? {};
  return {
    ...req,
    systemPrompt: stripPii(req.systemPrompt, opts),
    ...(req.systemBlocks !== undefined
      ? {
          systemBlocks: req.systemBlocks.map((b) =>
            b.trusted === true ? b : { ...b, text: stripPii(b.text, opts) },
          ),
        }
      : {}),
    messages: req.messages.map((m) => ({ ...m, content: stripPii(m.content, opts) })),
  };
}

function systemText(req: Pick<ChatRequest, 'systemPrompt' | 'systemBlocks'>): string {
  return req.systemBlocks !== undefined
    ? req.systemBlocks.map((b) => b.text).join('\n\n')
    : req.systemPrompt;
}

function providerBlocks(blocks: ChatSystemBlock[] | undefined): SystemBlock[] | undefined {
  return blocks?.map((b) => ({ text: b.text, ...(b.cache === true ? { cache: true } : {}) }));
}

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
  rawReq: ChatRequest,
  safeTemplate: string,
): Promise<ChatResponse> {
  const start = Date.now();
  const req = sanitizeRequest(rawReq);
  if (useScriptedModel(config)) {
    const text = req.scripted?.() ?? scriptedCoachReply(systemText(req), req.messages);
    return {
      text,
      modelUsed: 'scripted-demo',
      fallbackPath: 'none',
      latencyMs: Date.now() - start,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  const primaryModel = chatModel(config);
  const blocks = providerBlocks(req.systemBlocks);
  const primaryTimeoutMs = req.primaryTimeoutMs ?? PRIMARY_TIMEOUT_DEFAULT_MS;
  const fallbackTimeoutMs = req.fallbackTimeoutMs ?? FALLBACK_TIMEOUT_DEFAULT_MS;

  // ---- Primary: Anthropic Claude Haiku 4.5
  try {
    const result = await withRetry(() =>
      getPrimaryBreaker()(config, {
        model: primaryModel,
        systemPrompt: req.systemPrompt,
        ...(blocks !== undefined ? { systemBlocks: blocks } : {}),
        effort: config.llmChatEffort ?? 'low',
        messages: req.messages,
        maxTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        timeoutMs: primaryTimeoutMs,
      }),
    );
    return {
      text: result.text,
      modelUsed: primaryModel,
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
        systemPrompt: systemText(req),
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
  modelUsed: ChatModelId | 'scripted-demo';
  latencyMs: number;
}

export async function* chatStream(
  config: AppConfig,
  rawReq: Omit<ChatRequest, 'primaryTimeoutMs' | 'fallbackTimeoutMs'>,
): AsyncGenerator<string, ChatStreamFinal, void> {
  const start = Date.now();
  const req = sanitizeRequest(rawReq);
  if (useScriptedModel(config)) {
    const text = req.scripted?.() ?? scriptedCoachReply(systemText(req), req.messages);
    yield* scriptedStream(text);
    return {
      text,
      inputTokens: 0,
      outputTokens: 0,
      stopReason: 'end_turn',
      modelUsed: 'scripted-demo',
      latencyMs: Date.now() - start,
    };
  }
  const model = chatModel(config);
  const blocks = providerBlocks(req.systemBlocks);
  const final = yield* anthropicChatStream(config, {
    model,
    systemPrompt: req.systemPrompt,
    ...(blocks !== undefined ? { systemBlocks: blocks } : {}),
    effort: config.llmChatEffort ?? 'low',
    messages: req.messages,
    maxTokens: req.maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
  return {
    ...final,
    modelUsed: model,
    latencyMs: Date.now() - start,
  };
}

/**
 * Background (off the chat turn) structured call. D3: the stronger model
 * (`claude-opus-5-5` by default) — no latency budget applies because this
 * never runs inside a chat turn. Returns parsed JSON matching `schema`.
 *
 * Demo mode with no key: returns `scripted()` so background features are
 * visible without a model account. Outside demo mode with no key the call
 * throws, and the job runner records the failure (fail-open: chat is
 * untouched).
 */
export interface BackgroundJsonRequest<T> {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  pii?: PiiFilterOptions;
  scripted: () => T;
  timeoutMs?: number;
}

export async function backgroundJson<T>(
  config: AppConfig,
  req: BackgroundJsonRequest<T>,
): Promise<{ value: T; model: BackgroundModelId | 'scripted-demo' }> {
  if (useScriptedModel(config)) {
    return { value: req.scripted(), model: 'scripted-demo' };
  }
  const model = config.llmBackgroundModel ?? 'claude-opus-5-5';
  const opts = req.pii ?? {};
  const res = await anthropicChat(config, {
    model,
    systemPrompt: req.system,
    messages: [{ role: 'user', content: stripPii(req.user, opts) }],
    maxTokens: req.maxTokens ?? 16_000,
    effort: 'medium',
    jsonSchema: req.schema,
    timeoutMs: req.timeoutMs ?? 120_000,
  });
  return { value: JSON.parse(res.text) as T, model };
}

/** Test reset helper. */
export function resetChatBreakersForTests(): void {
  primaryBreaker = undefined;
  fallbackBreaker = undefined;
}

/** Test seam — exposes the per-call timeout constants for invariant assertion
 *  against the circuit-breaker defaults in src/shared/llm/breaker.ts. */
export const _internal = { PRIMARY_TIMEOUT_DEFAULT_MS, FALLBACK_TIMEOUT_DEFAULT_MS };
