import type { VoiceRulesPayload } from '../libraries/index.js';
import {
  isLevelTag,
  isPracticeTag,
  type LevelTag,
  type PracticeTag,
  type ResponseMode,
} from '../shared/types/index.js';
import type { CheckOutcome, CheckResult } from './types.js';

/**
 * Process #10 Check 1 — practice tag exists in the catalog (12 valid).
 */
export function check1PracticeTag(predicted: PracticeTag | undefined): CheckResult {
  return {
    checkId: 'check_01_practice_tag',
    outcome:
      predicted === undefined || isPracticeTag(predicted)
        ? predicted === undefined
          ? { status: 'not_required' }
          : { status: 'pass' }
        : { status: 'hard_fail', reason: `unknown practice "${predicted as string}"` },
  };
}

/**
 * Process #10 Check 2 — level tag (Self/Team/Org/Community).
 *
 * Congruence note: the BPMN names "level + congruence" — congruence between
 * the response's framing and the predicted level. v1 takes a permissive
 * interpretation: tag must be in the 4-enum and the upstream tagger
 * (Process #2 §6) was responsible for choosing it. Phase 7 may add semantic
 * congruence as a deeper LLM check; flagged in plan §5A.5.
 */
export function check2LevelTag(predicted: LevelTag | undefined): CheckResult {
  return {
    checkId: 'check_02_level_tag',
    outcome:
      predicted === undefined || isLevelTag(predicted)
        ? predicted === undefined
          ? { status: 'not_required' }
          : { status: 'pass' }
        : { status: 'hard_fail', reason: `unknown level "${predicted as string}"` },
  };
}

/**
 * Process #10 Check 5 — hero/savior/victim phrase flags. Substring search on
 * the heroPhraseFlags catalog (lower-case). Soft-fail when any flag matches.
 */
export function check5HeroToGuide(voiceRules: VoiceRulesPayload, candidate: string): CheckResult {
  const lower = candidate.toLowerCase();
  const matched = voiceRules.heroPhraseFlags.find((flag) => lower.includes(flag.toLowerCase()));
  return {
    checkId: 'check_05_hero_to_guide',
    outcome:
      matched === undefined
        ? { status: 'pass' }
        : { status: 'soft_fail', reason: `hero/savior phrase detected: "${matched}"` },
  };
}

/**
 * Process #10 Check 6 — "useful to society" anchor presence.
 *
 * **Fail-closed for Self + Community levels**: the anchor MUST appear (any
 * pattern from voice_rules.usefulToSocietyPatterns matches). For Team + Org
 * levels, the anchor may be implicit, so a missing anchor returns
 * `not_required` rather than soft_fail.
 *
 * Modes that don't carry a level tag (ClarifyingQuestion, MetaResponse) are
 * `not_required`.
 */
export function check6UsefulToSociety(
  voiceRules: VoiceRulesPayload,
  candidate: string,
  level: LevelTag | undefined,
): CheckResult {
  const required = level === 'self' || level === 'community';
  const lower = candidate.toLowerCase();
  const matched = voiceRules.usefulToSocietyPatterns.some((p) => lower.includes(p.toLowerCase()));

  let outcome: CheckOutcome;
  if (matched) {
    outcome = { status: 'pass' };
  } else if (required) {
    outcome = {
      status: 'soft_fail',
      reason: 'useful-to-society anchor missing on a Self/Community-level response',
    };
  } else {
    outcome = { status: 'not_required' };
  }

  return { checkId: 'check_06_useful_to_society', outcome };
}

/**
 * Process #10 Check 9 — length range, mode-specific. Word count proxies are
 * cheap and stable; char-length variants would be tighter but add no
 * meaningful signal.
 *
 * Mode-by-mode ranges (from PRD §7 + prompt_templates v1 token budgets):
 *   - FullCoachingResponse:        120 .. 250 words
 *   - ProfileUpdateAcknowledgment:  30 ..  90 words
 *   - ClarifyingQuestion:           20 ..  90 words
 *   - MetaResponse:                 60 .. 220 words
 *   - ScenarioRolePlay:             80 .. 220 words
 */
export function check9Length(candidate: string, mode: ResponseMode): CheckResult {
  const words = countWords(candidate);
  const range = LENGTH_RANGES[mode];
  let outcome: CheckOutcome;
  if (words < range.min) {
    outcome = {
      status: 'soft_fail',
      reason: `response too short (${words} words; min ${range.min} for ${mode})`,
    };
  } else if (words > range.max) {
    outcome = {
      status: 'soft_fail',
      reason: `response too long (${words} words; max ${range.max} for ${mode})`,
    };
  } else {
    outcome = { status: 'pass' };
  }
  return { checkId: 'check_09_length', outcome };
}

const LENGTH_RANGES: Record<ResponseMode, { min: number; max: number }> = {
  FullCoachingResponse: { min: 120, max: 250 },
  ProfileUpdateAcknowledgment: { min: 30, max: 90 },
  ClarifyingQuestion: { min: 20, max: 90 },
  MetaResponse: { min: 60, max: 220 },
  ScenarioRolePlay: { min: 80, max: 220 },
};

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export const _internal = { LENGTH_RANGES, countWords };
