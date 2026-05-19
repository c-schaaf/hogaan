import type { PracticeTag } from '../shared/types/index.js';
import type { OnboardingEndEvent } from './end-events.js';

/**
 * Phase 12 R14 — 12-practice picker.
 *
 * The previous 4-goal taxonomy lost information at the 4→12 mapping. v2
 * shows all 12 practices upfront. PracticeOption is an alias for
 * PracticeTag (the canonical 12-element enum from PRD §7).
 */
export type PracticeOption = PracticeTag;

// Backwards compatibility — kept until R20-line callers migrate.
// GoalOption is now an alias of PracticeOption.
export type GoalOption = PracticeOption;
export const GOAL_OPTIONS: readonly PracticeOption[] = [
  'integrity',
  'purpose',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'democracy',
  'peace',
] as const;

/**
 * Roles offered in Step 5. Single-select.
 * Phase 12 R15 — added CommunityLeader and Advocate. Existing
 * Student/Professional/Leader users are unaffected (additive).
 *
 * Customer-feedback PR4 — superseded by EXPERIENCE_BANDS for new users.
 * Kept for backwards compatibility (parser fixtures, existing rows).
 */
export const ROLE_OPTIONS = [
  'Student',
  'Professional',
  'Leader',
  'CommunityLeader',
  'Advocate',
] as const;
export type RoleOption = (typeof ROLE_OPTIONS)[number];

/**
 * Customer-feedback PR4 — leadership experience bands. Replaces role as the
 * Step 5 segmentation. Customer wanted "How many years as a leader?" with
 * 1-5 / 5-10 / 10+. Stored as canonical short tokens; rendered as friendly
 * prose ("Less than 5 years", "5 to 10 years", "Over 10 years") in user-
 * facing strings.
 */
export const EXPERIENCE_BANDS = ['<5', '5-10', '10+'] as const;
export type ExperienceBand = (typeof EXPERIENCE_BANDS)[number];

export class OnboardingError extends Error {
  public readonly endEvent: OnboardingEndEvent;
  constructor(message: string, endEvent: OnboardingEndEvent) {
    super(message);
    this.name = 'OnboardingError';
    this.endEvent = endEvent;
  }
}
