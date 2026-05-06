import type { CohortId, PracticeTag, UserId } from '../shared/types/index.js';
import type { OnboardingEndEvent } from './end-events.js';

/** Per Process #1 §Resume Router: the 6 entry-point steps (0=fresh start). */
export type LastCompletedStep = 0 | 2 | 3 | 4 | 5 | 6 | 7;

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

/** Roles offered in Step 5. Single-select. */
export const ROLE_OPTIONS = ['Student', 'Professional', 'Leader'] as const;
export type RoleOption = (typeof ROLE_OPTIONS)[number];

/**
 * Onboarding orchestrator input — every inbound message handed to
 * handleOnboardingMessage produces this. Identity (#12) supplies userId
 * + status; the message body is the raw text the user typed.
 */
export interface OnboardingInboundEvent {
  userId: UserId;
  /** SHA-256 phone hash, for suppression-list updates on opt-out. */
  phoneHash: string;
  /** E.164 — the recipient on outbound nudges/responses. */
  phoneE164: string;
  /** The user's plaintext message. */
  body: string;
  /** Receive timestamp; defaults to now. Tests override for resume scenarios. */
  receivedAt: Date;
  /** Inbound message id from Twilio (for trace propagation). */
  inboundMessageId: string;
}

export interface OnboardingResult {
  endEvent: OnboardingEndEvent | 'IN_PROGRESS';
  /** New `users.last_completed_step` value after this turn. */
  newLastCompletedStep: LastCompletedStep;
  /** Outbound message dispatched (or queued via Process #11). */
  outboundCorrelationId?: string;
  outboundWaMessageId?: string;
  /** When E1/E2/E7 fire, the cohort the user redeemed into (if any). */
  cohortId?: CohortId;
  /** Practice mapping derived from the chosen goal. */
  mappedPractices?: PracticeTag[];
  /** `true` when defaults were applied because parse failed 3x (E7 path). */
  needsProfileReview: boolean;
  /** Human-readable reason for the result — sanitized, no PII. */
  reason: string;
}

export class OnboardingError extends Error {
  public readonly endEvent: OnboardingEndEvent;
  constructor(message: string, endEvent: OnboardingEndEvent) {
    super(message);
    this.name = 'OnboardingError';
    this.endEvent = endEvent;
  }
}
