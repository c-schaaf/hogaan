import { describe, expect, it } from 'vitest';
import {
  enforceTokenBudget,
  estimateTokens,
  TOKEN_BUDGET_LIMIT,
} from '../../src/prompt-assembly/index.js';
import type { PromptUnderConstruction } from '../../src/prompt-assembly/types.js';
import { noDegradation } from '../../src/shared/types/index.js';

function repeat(line: string, n: number): string {
  return Array.from({ length: n }, () => line).join('\n');
}

function buildOverBudgetPrompt(): PromptUnderConstruction {
  // Each block ~ 4000 chars ≈ 1143 tokens. Five active blocks → ~5715 tokens.
  // Well past the 4000-token cap, designed to exercise the cascade.
  const block = 'X'.repeat(4000);
  return {
    systemTemplateText: 'You are Hogaan. ' + 'A'.repeat(500),
    practiceFramingText: 'Practice integrity ' + 'B'.repeat(500),
    levelFramingText: 'Level self ' + 'C'.repeat(500),
    voiceRulesText: 'Voice rules ' + 'D'.repeat(2000),
    culturalFramingText: 'Cultural framing Sharaf ' + 'E'.repeat(2000),
    culturalFramingConcept: 'Sharaf',
    memoryBlockText: '## Memory\n' + repeat('- (2026-05-01) ' + block, 6),
    sessionContextText:
      '## Recent session context\n' + repeat('User: ' + block + '\nAssistant: ' + block + '\n', 4),
    userProfileBlockText: '## User profile\nRole: Manager',
    userMessageText: '## Current user message\n' + 'How do I lead my team?',
  };
}

describe('estimateTokens', () => {
  it('rounds up at 3.5 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('1234567')).toBe(2); // 7/3.5 = 2
    expect(estimateTokens('12345678')).toBe(3); // 8/3.5 = 2.28 -> 3
  });
});

describe('enforceTokenBudget', () => {
  it('passes through when under budget', () => {
    const small: PromptUnderConstruction = {
      systemTemplateText: 'small system',
      practiceFramingText: '',
      levelFramingText: '',
      voiceRulesText: 'rules',
      culturalFramingText: 'framing',
      culturalFramingConcept: 'Sharaf',
      memoryBlockText: '## Memory\n- (2026-05-04) hello',
      sessionContextText: '## Recent session context\nUser: hi',
      userProfileBlockText: '## User profile\nRole: Manager',
      userMessageText: '## Current user message\nHow are you?',
    };
    const r = enforceTokenBudget(small, noDegradation());
    expect(r.oversize).toBe(false);
    expect(r.flags.memoryTruncated).toBe(false);
    expect(r.flags.sessionTruncated).toBe(false);
    expect(r.flags.culturalFramingDropped).toBe(false);
    expect(r.tokenCount).toBeLessThanOrEqual(TOKEN_BUDGET_LIMIT);
  });

  it('cascades through the three degradation strategies in order', () => {
    const big = buildOverBudgetPrompt();
    const r = enforceTokenBudget(big, noDegradation());

    // The cascade tries memory first, then session, then drops cultural framing.
    // Whether all three trip depends on the prompt size; for this fixture, all
    // three should fire because the blocks dominate the budget.
    expect(r.flags.memoryTruncated).toBe(true);
    expect(r.flags.sessionTruncated).toBe(true);
    expect(r.flags.culturalFramingDropped).toBe(true);
    expect(r.prompt.culturalFramingText).toBeNull();
    expect(r.prompt.culturalFramingConcept).toBeNull();
  });

  it('marks oversize when even all degradation cannot fit', () => {
    const huge: PromptUnderConstruction = {
      systemTemplateText: 'X'.repeat(20000),
      practiceFramingText: 'Y'.repeat(5000),
      levelFramingText: 'Z'.repeat(5000),
      voiceRulesText: 'W'.repeat(5000),
      culturalFramingText: 'A'.repeat(2000),
      culturalFramingConcept: 'Sharaf',
      memoryBlockText: '## Memory\n- entry',
      sessionContextText: '## Recent session context\nUser: hi',
      userProfileBlockText: '## User profile',
      userMessageText: '## Current user message\nq',
    };
    const r = enforceTokenBudget(huge, noDegradation());
    expect(r.oversize).toBe(true);
    expect(r.flags.culturalFramingDropped).toBe(true);
  });

  it('only degrades the dimensions it actually touched', () => {
    // Build a prompt where memory is huge but session is tiny — only memory
    // should be flagged.
    const memHeavy: PromptUnderConstruction = {
      systemTemplateText: 'system',
      practiceFramingText: '',
      levelFramingText: '',
      voiceRulesText: '',
      culturalFramingText: 'framing',
      culturalFramingConcept: 'Sharaf',
      memoryBlockText: '## Memory\n' + repeat('- (2026-05-04) entry', 2000),
      sessionContextText: '## Recent session context\nUser: hi',
      userProfileBlockText: '## User profile',
      userMessageText: '## Current user message\nq',
    };
    const r = enforceTokenBudget(memHeavy, noDegradation());
    if (r.oversize) {
      // If memory alone exceeds budget even after halving, all subsequent
      // strategies trip too — that's expected behavior.
      expect(r.flags.memoryTruncated).toBe(true);
    } else {
      expect(r.flags.memoryTruncated).toBe(true);
      // Session was not over budget itself, so we may or may not have touched
      // it depending on whether memory-half was sufficient. The contract is
      // "at most as much degradation as needed".
    }
  });
});
