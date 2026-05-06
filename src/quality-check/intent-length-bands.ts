import type { Intent } from '../shared/types/index.js';
import type { CheckResult } from './types.js';

/**
 * Phase 11 R32 — per-intent length bands.
 *
 * The audit found that responses were being validated by ResponseMode
 * (FullCoachingResponse / ProfileUpdateAcknowledgment / etc.) which is
 * coarser than Intent. Intent comes from the triage classifier and
 * captures *what the user is asking for*; ResponseMode captures *how
 * Hogaan is replying*. They usually align but can diverge — e.g. a
 * Coaching intent that the QC truncates into a clarifying question.
 *
 * These bands are the ground truth for "is the length appropriate for
 * what the user actually asked?". Used by:
 *   - Static template tests: every templated response (GREETING_RESPONSE,
 *     AFFIRMATION_RESPONSE, etc.) must fall within its intent's band.
 *     A future edit that bloats a greeting to 200 words trips the test.
 *   - QC runtime length check (Process #10 Check 9), which intersects this
 *     band with the ResponseMode band already in checks-rule-based.ts.
 *
 * Word-count is the proxy (matches PRD §7 token budgets within ~1.5x).
 */
export interface LengthBand {
  /** Inclusive minimum word count. */
  min: number;
  /** Inclusive maximum word count. */
  max: number;
}

export const INTENT_LENGTH_BANDS: Record<Intent, LengthBand> = {
  Greeting: { min: 10, max: 80 },
  Affirmation: { min: 5, max: 50 },
  MetaQuestion: { min: 30, max: 100 },
  ProfileUpdate: { min: 20, max: 80 },
  Coaching: { min: 150, max: 300 },
  ScenarioRequest: { min: 150, max: 400 },
  ClarificationResponse: { min: 30, max: 200 },
  OutOfScope: { min: 20, max: 100 },
};

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export type LengthCheckOutcome =
  | { status: 'pass'; words: number }
  | { status: 'too_short'; words: number; min: number; intent: Intent }
  | { status: 'too_long'; words: number; max: number; intent: Intent };

/**
 * Validate `candidate` against the band for `intent`. Returns a discriminated
 * outcome the QC orchestrator can map to a CheckResult or a static-test
 * assertion can match on.
 */
export function checkIntentLength(candidate: string, intent: Intent): LengthCheckOutcome {
  const band = INTENT_LENGTH_BANDS[intent];
  const words = countWords(candidate);
  if (words < band.min) {
    return { status: 'too_short', words, min: band.min, intent };
  }
  if (words > band.max) {
    return { status: 'too_long', words, max: band.max, intent };
  }
  return { status: 'pass', words };
}

/**
 * QC orchestrator adapter — converts the discriminated LengthCheckOutcome
 * into the CheckResult shape expected by runAllChecks. Produces a soft_fail
 * with the concrete (words, band) values in the reason for QC's corrective
 * prompt.
 */
export function checkIntentLengthAsCheckResult(candidate: string, intent: Intent): CheckResult {
  const outcome = checkIntentLength(candidate, intent);
  if (outcome.status === 'pass') {
    return { checkId: 'check_14_intent_length', outcome: { status: 'pass' } };
  }
  if (outcome.status === 'too_short') {
    return {
      checkId: 'check_14_intent_length',
      outcome: {
        status: 'soft_fail',
        reason: `${outcome.words} words below ${intent} min ${outcome.min}`,
      },
    };
  }
  return {
    checkId: 'check_14_intent_length',
    outcome: {
      status: 'soft_fail',
      reason: `${outcome.words} words above ${intent} max ${outcome.max}`,
    },
  };
}
