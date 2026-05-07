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
 * **Phase 12 R5 — required across all 4 levels**. Self- and Community-level
 * responses must land the anchor explicitly; Team- and Organization-level
 * may anchor it more implicitly (in service of the team's mission, the
 * org's purpose, the community impact) but must still land it.
 *
 * The R4 tightening of usefulToSocietyPatterns (phrasal anchors only)
 * prevents incidental mentions from passing falsely.
 *
 * Modes that don't carry a level tag (ClarifyingQuestion, MetaResponse,
 * ProfileUpdateAcknowledgment) are `not_required` — those responses don't
 * need the anchor.
 */
export function check6UsefulToSociety(
  voiceRules: VoiceRulesPayload,
  candidate: string,
  level: LevelTag | undefined,
): CheckResult {
  if (level === undefined) {
    return { checkId: 'check_06_useful_to_society', outcome: { status: 'not_required' } };
  }
  const lower = candidate.toLowerCase();
  const matched = voiceRules.usefulToSocietyPatterns.some((p) => lower.includes(p.toLowerCase()));

  let outcome: CheckOutcome;
  if (matched) {
    outcome = { status: 'pass' };
  } else {
    outcome = {
      status: 'soft_fail',
      reason: `useful-to-society anchor missing on a ${level}-level response`,
    };
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

/**
 * Phase 11 R39 — Voice Rule 11 (formatting discipline).
 *
 * WhatsApp does NOT render markdown headers (## / ###); they show up as
 * literal text. WhatsApp DOES render *bold*, but multiple bolds turn the
 * response into visual noise that undermines the "warm and pragmatic" voice.
 *
 * Hard caps enforced:
 *   - boldCount  ≤ 1   (the key insight, not a list)
 *   - headerCount === 0
 *   - bulletLineCount === 0  (no leading "- " or "* " lines)
 *
 * Soft-fail when violated. The QC retry loop gets one chance to fix; if it
 * regresses again the response is degraded but still delivered (Voice Rule
 * violations are not safety-critical).
 */
export function checkFormattingDiscipline(candidate: string): CheckResult {
  const headerCount = (candidate.match(/^#{1,6}\s/gm) ?? []).length;
  // WhatsApp bold is *...* (single asterisk pair). Markdown bold (**...**)
  // is also flagged — it renders as visual noise on WhatsApp regardless.
  // Match either form, conservatively: any pair of *...* containing
  // at least one non-* character.
  const boldMatches = candidate.match(/\*+[^*\n]+\*+/g) ?? [];
  const boldCount = boldMatches.length;
  const bulletLineCount = (candidate.match(/^[ \t]*[-*]\s+\S/gm) ?? []).length;

  const violations: string[] = [];
  if (headerCount > 0) {
    violations.push(`${headerCount} markdown header(s) (max 0)`);
  }
  if (boldCount > 1) {
    violations.push(`${boldCount} bold segment(s) (max 1)`);
  }
  if (bulletLineCount > 0) {
    violations.push(`${bulletLineCount} bullet-list line(s) (max 0)`);
  }

  let outcome: CheckOutcome;
  if (violations.length === 0) {
    outcome = { status: 'pass' };
  } else {
    outcome = {
      status: 'soft_fail',
      reason: `formatting discipline violated: ${violations.join('; ')}`,
    };
  }

  return { checkId: 'check_11_formatting_discipline', outcome };
}

/**
 * Batch P Piece 2 — Check 16 deterministic level-fidelity.
 *
 * Density signal: count off-level phrases (drawn from the OTHER three
 * levels' phrase sets) against on-level phrases for the tagged level. If
 * off-level density meaningfully exceeds on-level density, soft_fail with
 * the count signal. Conservative thresholds — false positives cost a
 * regen round; false negatives are handled by the LLM-judged Check 17.
 *
 * Engineering-authored phrase lists; not Hamse content. Per level:
 *   ON-level phrases — small set that signals correct anchoring.
 *   OFF-level phrases — phrases from the OTHER 3 levels that signal drift.
 *
 * Skip semantics:
 *   - responseMode !== 'FullCoachingResponse' → not_required
 *   - levelTag undefined                       → not_required
 */
const ON_LEVEL_PHRASES: Record<LevelTag, string[]> = {
  self: ['i feel', 'i notice', "i'm sitting with", 'within me', 'my own'],
  team: ['my team', 'my report', 'one-on-one', 'team meeting'],
  organization: ['the org', 'company-wide', 'cross-functional'],
  community: ['civic', 'community', 'sector', 'public'],
};

const OFF_LEVEL_PHRASES: Record<LevelTag, string[]> = {
  // For self-tagged: drift = team / org / community phrasing
  self: [
    'your team needs',
    'the team should',
    'your colleagues',
    'cross-functional',
    'company-wide',
    'the org',
    'the sector',
  ],
  // For team-tagged: drift = self-introspection or org-structural
  team: [
    'your own integrity',
    'within yourself',
    'company-wide',
    'the org',
    'cross-functional',
    'civic',
    'sectoral',
  ],
  // For org-tagged: drift = self-introspection or team-meeting specifics
  organization: [
    'within yourself',
    'your own',
    'the team meeting',
    'one-on-one',
    'civic',
    'community at large',
  ],
  // For community-tagged: drift = self / team / private-org
  community: ['within yourself', 'your own', 'your team', 'company-wide', 'the org'],
};

function countSubstringHits(haystack: string, needles: string[]): number {
  let n = 0;
  for (const needle of needles) {
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      n += 1;
      idx += needle.length;
    }
  }
  return n;
}

export function check16LevelFidelity(
  candidate: string,
  levelTag: LevelTag | undefined,
  responseMode: ResponseMode,
): CheckResult {
  if (responseMode !== 'FullCoachingResponse' || levelTag === undefined) {
    return { checkId: 'check_16_level_fidelity', outcome: { status: 'not_required' } };
  }
  const lower = candidate.toLowerCase();
  const onHits = countSubstringHits(lower, ON_LEVEL_PHRASES[levelTag]);
  const offHits = countSubstringHits(lower, OFF_LEVEL_PHRASES[levelTag]);

  // Trigger condition: at least 2 off-level hits AND off-level density > 2× on-level.
  // The 2-hit floor avoids tripping on a one-word incidental mention; the
  // 2× ratio gives the response room to reference other levels in passing.
  const triggers = offHits >= 2 && offHits > Math.max(1, onHits) * 2;

  let outcome: CheckOutcome;
  if (triggers) {
    outcome = {
      status: 'soft_fail',
      reason: `level drift: ${offHits} off-level phrase hit(s) vs ${onHits} on-level for tagged ${levelTag}`,
    };
  } else {
    outcome = { status: 'pass' };
  }
  return { checkId: 'check_16_level_fidelity', outcome };
}

export const _internal = {
  LENGTH_RANGES,
  countWords,
  ON_LEVEL_PHRASES,
  OFF_LEVEL_PHRASES,
};
