import type { DegradationFlags } from '../shared/types/index.js';
import { truncateMemoryHalf, truncateSessionToLastTurns } from './blocks.js';
import type { PromptUnderConstruction } from './types.js';

/**
 * Process #9 §12 — token budget enforcement.
 *
 * Hard cap: 4000 tokens for the assembled prompt. Token estimator is
 * char-based at ~3.5 chars/token. **Caveat**: not the actual Anthropic
 * tokenizer — accuracy is ±10% for English. Adequate for the budget gate
 * (we're well below the 200k Haiku context); a Phase 9 swap to a real
 * tokenizer would tighten precision but won't change the cascade logic.
 *
 * Degradation cascade (per BPMN, in order):
 *   1. Truncate memory block to half its entries.
 *   2. If still over: truncate session context to last 1–2 turns.
 *   3. If still over: drop cultural framing entirely.
 *   4. If still over after all three: oversize=true (caller maps to E9).
 */

const TOKEN_BUDGET = 4000;
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface BudgetResult {
  prompt: PromptUnderConstruction;
  tokenCount: number;
  oversize: boolean;
  flags: DegradationFlags;
}

export function enforceTokenBudget(
  initial: PromptUnderConstruction,
  baseFlags: DegradationFlags,
): BudgetResult {
  let prompt = initial;
  const flags: DegradationFlags = { ...baseFlags };

  let tokens = countAllTokens(prompt);
  if (tokens <= TOKEN_BUDGET) {
    return { prompt, tokenCount: tokens, oversize: false, flags };
  }

  // Strategy 1: half-truncate memory.
  const halvedMemory = truncateMemoryHalf(prompt.memoryBlockText);
  if (halvedMemory !== prompt.memoryBlockText) {
    prompt = { ...prompt, memoryBlockText: halvedMemory };
    flags.memoryTruncated = true;
    tokens = countAllTokens(prompt);
    if (tokens <= TOKEN_BUDGET) {
      return { prompt, tokenCount: tokens, oversize: false, flags };
    }
  }

  // Strategy 2: truncate session to last 1–2 turns.
  const truncatedSession = truncateSessionToLastTurns(prompt.sessionContextText, 2);
  if (truncatedSession !== prompt.sessionContextText) {
    prompt = { ...prompt, sessionContextText: truncatedSession };
    flags.sessionTruncated = true;
    tokens = countAllTokens(prompt);
    if (tokens <= TOKEN_BUDGET) {
      return { prompt, tokenCount: tokens, oversize: false, flags };
    }
  }

  // Strategy 3: drop cultural framing.
  if (prompt.culturalFramingText !== null) {
    prompt = { ...prompt, culturalFramingText: null, culturalFramingConcept: null };
    flags.culturalFramingDropped = true;
    tokens = countAllTokens(prompt);
    if (tokens <= TOKEN_BUDGET) {
      return { prompt, tokenCount: tokens, oversize: false, flags };
    }
  }

  return { prompt, tokenCount: tokens, oversize: true, flags };
}

function countAllTokens(prompt: PromptUnderConstruction): number {
  let total = 0;
  total += estimateTokens(prompt.systemTemplateText);
  total += estimateTokens(prompt.practiceFramingText);
  total += estimateTokens(prompt.levelFramingText);
  total += estimateTokens(prompt.voiceRulesText);
  if (prompt.culturalFramingText !== null) {
    total += estimateTokens(prompt.culturalFramingText);
  }
  total += estimateTokens(prompt.memoryBlockText);
  total += estimateTokens(prompt.sessionContextText);
  total += estimateTokens(prompt.userProfileBlockText);
  total += estimateTokens(prompt.userMessageText);
  return total;
}

export const TOKEN_BUDGET_LIMIT = TOKEN_BUDGET;
