import { anthropicChat } from '../shared/llm/anthropic.js';
import { LlmError } from '../shared/llm/errors.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { CheckResult } from './types.js';

/**
 * Process #10 §FailMerge → §ConstructCorrective → §Regenerate loop.
 *
 * Corrective prompts are template-based for v1 (per plan §5A.8). They name
 * which check(s) failed, the specific reasons, and instruct the LLM to
 * regenerate while preserving the practice tag, level tag, and underlying
 * answer to the user's question.
 *
 * Regeneration uses Anthropic Claude Haiku 4.5 directly — same primary
 * model as the original generation — with the corrective system instruction
 * stacked above the user message. We deliberately do NOT route through the
 * full chat() fallback chain: a transient error during regeneration should
 * surface to the QC orchestrator as service_unavailable rather than silently
 * swap to Groq mid-loop.
 */

export interface CorrectiveOptions {
  /** Original system prompt that produced the failed candidate (from prompt assembly). */
  originalSystemPrompt: string;
  /** Original user message — preserved verbatim. */
  userMessage: string;
  /** The failing candidate that needs correction. */
  failedCandidate: string;
  /** Failed checks driving this regeneration. */
  failedChecks: CheckResult[];
}

/**
 * R-07 / 2026-05-08 — regen timeout raised from 3s to 10s. The original 3s cap
 * (set against PRD §5.1's old 6000ms total budget) became the active bottleneck
 * once PRIMARY_TIMEOUT_DEFAULT_MS rose to 12000ms (commit 6db2967): regen on
 * the 3700-token coaching prompt cannot complete in 3s, so every regen-firing
 * turn timed out → E6_ServiceUnavailable → fallback. With LATENCY_BUDGET_MS
 * now 15000ms and the predictive budget gate in QC orchestrator (also R-07)
 * refusing to start a regen that cannot fit in remaining budget, 10s fits the
 * worst case.
 *
 * Hogaan timeout hierarchy (must be reviewed together):
 * - LATENCY_BUDGET_MS = 15000 (total turn cap, src/coaching/orchestrator.ts)
 * - PRIMARY_TIMEOUT_DEFAULT_MS = 12000 (primary LLM call, src/shared/llm/chat.ts)
 * - REGEN_TIMEOUT_MS = 10000 (regenerate call, this file)
 * - REGEN_BUDGET_HEADROOM_MS = 12000 (predictive regen-skip gate, this file)
 * - BREAKER_ANTHROPIC_TIMEOUT_MS = 14000 (must be > PRIMARY_TIMEOUT_DEFAULT_MS
 *     to avoid double-counting in the circuit breaker; src/shared/llm/breaker.ts)
 * Any change to one requires audit of all five. Notably:
 *   REGEN_BUDGET_HEADROOM_MS must cover REGEN_TIMEOUT_MS + final QC pass +
 *   delivery, NOT just REGEN_TIMEOUT_MS — otherwise the regen completes but
 *   the final pass + delivery push past LATENCY_BUDGET_MS, and the user
 *   receives FALLBACK_DEGRADED via the R-06 budget gate at
 *   src/coaching/orchestrator.ts (the symptom we're solving here).
 *   BREAKER_ANTHROPIC_TIMEOUT_MS must be > PRIMARY_TIMEOUT_DEFAULT_MS — see
 *   audit F-02 (2026-05-08): Opossum's per-call timeout otherwise fires
 *   before the LLM timeout, counting healthy-but-slow Anthropic calls as
 *   breaker failures and risking circuit-open at the volume threshold.
 *   tests/shared/llm/breaker.test.ts asserts this invariant programmatically.
 */
const REGEN_TIMEOUT_MS = 10_000;
const REGEN_MAX_TOKENS = 1024;

/**
 * Predictive regen-skip headroom — minimum remaining budget required at the
 * R-07 gate before permitting a regen attempt. Sized to cover the full
 * post-regen tail:
 *   - regen call: up to REGEN_TIMEOUT_MS = 10000ms
 *   - final QC pass on the regenerated candidate: ~1500ms p95
 *   - delivery to Twilio: ~500ms p95
 * Total: ~12000ms.
 *
 * Calibrated 2026-05-08 against the smoke-test trace
 * (waMessageId SM64e518d1c30d37188b68601ede72d5e6) which observed:
 *   regen 7648ms + QC pass 2 ~1000-1500ms + delivery ~250ms ≈ 9.4s envelope.
 * 12000ms gives ~2.5s safety margin.
 *
 * If LATENCY_BUDGET_MS, REGEN_TIMEOUT_MS, or QC parallel-batch latency
 * shifts materially, re-derive this from observation rather than guessing.
 */
const REGEN_BUDGET_HEADROOM_MS = 12_000;

export function buildCorrectivePrompt(opts: CorrectiveOptions): string {
  const relevant = opts.failedChecks.filter(
    (c) => c.outcome.status === 'soft_fail' || c.outcome.status === 'hard_fail',
  );

  const failures = relevant
    .map((c) => {
      const reason =
        c.outcome.status === 'soft_fail' || c.outcome.status === 'hard_fail'
          ? c.outcome.reason
          : '';
      return `- ${c.checkId}: ${reason}`;
    })
    .join('\n');

  // Per-check targeted hints — added when the regenerator otherwise paraphrases
  // a fix that the rule-based checks (5, 6) don't recognize. v1 covers the
  // checks we've seen the regenerator miss; widens as we observe new modes.
  const hints: string[] = [];
  if (relevant.some((c) => c.checkId === 'check_06_useful_to_society')) {
    hints.push(
      'CHECK 6 IS RULE-BASED. Your response MUST contain at least one of these literal phrases (case-insensitive): "useful to", "in service of", "serve your", "something larger", "larger than", "usefulness". Pick ONE that fits the user\'s situation and use it naturally.',
    );
  }
  if (relevant.some((c) => c.checkId === 'check_05_hero_to_guide')) {
    hints.push(
      'CHECK 5 IS RULE-BASED. Avoid these phrases entirely (they read as hero/savior voice): "I would tell", "I would do", "let me solve this", "just trust me", "I\'ve advised", "as I always say", "believe in yourself", "you\'ve got this", "champion", "rockstar", "optimize the stakeholder", "leverage synergies".',
    );
  }
  const hintsBlock = hints.length === 0 ? '' : `\n\nTargeted guidance:\n${hints.join('\n\n')}`;

  return `Your previous response did not pass Hogaan's quality gates. The specific issues:

${failures}${hintsBlock}

Regenerate the response. Keep the same underlying answer to the user's question — same practice anchor, same level, same overall direction. Address every issue listed above. Stay within Hogaan's voice rules (warm + pragmatic, asset-based, hero-to-guide, useful-to-society anchor for Self/Community level, ≤7 short paragraphs, at most one Somali term, at most one lived-experience anecdote).

Previous (failed) response — for context only, do not echo it back:
"""
${opts.failedCandidate}
"""`;
}

export async function regenerate(
  config: AppConfig,
  opts: CorrectiveOptions,
): Promise<{ text: string } | { error: string }> {
  const correctivePrompt = buildCorrectivePrompt(opts);
  // Stack the corrective instruction onto the original system prompt so the
  // LLM sees both Hogaan's voice rules AND the fix request.
  const stackedSystem = `${opts.originalSystemPrompt}\n\n---\n${correctivePrompt}`;

  try {
    const res = await anthropicChat(config, {
      model: 'claude-haiku-4-5',
      systemPrompt: stackedSystem,
      messages: [{ role: 'user', content: opts.userMessage }],
      maxTokens: REGEN_MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: REGEN_TIMEOUT_MS,
    });
    return { text: res.text };
  } catch (err) {
    return {
      error: err instanceof LlmError ? `${err.name}: ${err.message}` : (err as Error).message,
    };
  }
}

/** Test seam — exposes the regen timing constants for direct assertion. */
export const _internal = { REGEN_TIMEOUT_MS, REGEN_MAX_TOKENS, REGEN_BUDGET_HEADROOM_MS };

export { REGEN_BUDGET_HEADROOM_MS };
