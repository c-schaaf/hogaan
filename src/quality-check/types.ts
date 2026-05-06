import type {
  LevelTag,
  PracticeTag,
  ResponseMode,
  SessionId,
  TurnId,
  UserId,
} from '../shared/types/index.js';
import type { QcEndEvent } from './end-events.js';

export interface QcInput {
  candidateResponseText: string;
  /** The user message that prompted this candidate. Needed for Check 8 second-line crisis. */
  userMessage: string;
  responseMode: ResponseMode;
  predictedPracticeTag?: PracticeTag;
  predictedLevelTag?: LevelTag;
  /** Tracking IDs — included on crisis_events / incidents but never on the LLM prompts. */
  userId?: UserId;
  sessionId?: SessionId;
  turnId?: TurnId;
}

export type CheckId =
  | 'check_01_practice_tag'
  | 'check_02_level_tag'
  | 'check_03_signature_structure'
  | 'check_04_asset_based'
  | 'check_05_hero_to_guide'
  | 'check_06_useful_to_society'
  | 'check_07_tone'
  | 'check_08_safety_crisis'
  | 'check_09_length'
  | 'check_10_lived_experience'
  | 'check_11_formatting_discipline'
  | 'check_12_tangible_action'
  | 'check_13_voice_consistency';

export type CheckOutcome =
  | { status: 'pass' }
  /** A check that doesn't apply to this mode/tag (e.g., useful-to-society on Team level). */
  | { status: 'not_required' }
  /** Soft failure — caller will regenerate with a corrective prompt. */
  | { status: 'soft_fail'; reason: string }
  /** Process #10 §8 crisis branch — bypass all downstream checks. */
  | { status: 'crisis'; reason: string }
  /** Hard failure — DO NOT regenerate (input-side issue). */
  | { status: 'hard_fail'; reason: string }
  /** Internal LLM/service error — for safety check, this means fail-closed. */
  | { status: 'service_unavailable'; reason: string };

export interface CheckResult {
  checkId: CheckId;
  outcome: CheckOutcome;
}

export interface QcResult {
  endEvent: QcEndEvent;
  /** Final approved or fallback text the caller should ship to the user. Empty when E5/E7. */
  responseText: string;
  /** Process #10 §8 crisis: the original input is forwarded to Crisis Handoff by the caller. */
  crisisDetected: boolean;
  /** Number of regeneration attempts made (0 = first attempt approved or non-regeneration outcome). */
  retryCount: number;
  /** True for E6 — caller should treat the response as a degraded variant. */
  degraded: boolean;
  /** Per-check outcomes from the FINAL pass — useful for trace + Phase 7.15 audit. */
  checks: CheckResult[];
  /** History of corrective prompts issued, for replay/debug. */
  correctivePromptHistory: string[];
}

export class QcError extends Error {
  public readonly endEvent: QcEndEvent;
  constructor(message: string, endEvent: QcEndEvent) {
    super(message);
    this.name = 'QcError';
    this.endEvent = endEvent;
  }
}
