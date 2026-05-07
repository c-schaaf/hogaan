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
 * R-07 — regen timeout reduced from 15s to 3s. Original 15s pre-dated the
 * R-06 total-budget check; with PRD §5.1's 6000ms total cap enforced
 * before delivery, a single regen round was already capable of blowing
 * the total budget by 2.5×. The elapsed-time skip guard in QC
 * orchestrator (also R-07) ensures regen only runs when there's slack;
 * this cap ensures even the allowed regens fit within the remaining
 * budget. Cross-region Anthropic 4–5s now times out — accepted
 * trade-off: regen quality < total latency budget.
 */
const REGEN_TIMEOUT_MS = 3_000;
const REGEN_MAX_TOKENS = 1024;

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
export const _internal = { REGEN_TIMEOUT_MS, REGEN_MAX_TOKENS };
