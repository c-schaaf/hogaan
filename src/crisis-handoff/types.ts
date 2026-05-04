import type { PhoneE164, SessionId, TurnId, UserId } from '../shared/types/index.js';

/**
 * Crisis Handoff input. Two trigger sources:
 *   - 'process_2_step_1'      — first-line classifier on the inbound message
 *   - 'process_10_check_8'    — second-line safety classifier in QC
 *
 * No transcript fields here — the original message IS the trigger but we
 * never store it in `crisis_events`. PRD §8 sponsor reporting aggregates
 * over outcome categories only.
 */
export type CrisisTriggerSource = 'process_2_step_1' | 'process_10_check_8';

export interface CrisisHandoffInput {
  triggerSource: CrisisTriggerSource;
  /** E.164 of the user in crisis. Becomes the recipient on the Process #11 send. */
  phoneE164: PhoneE164;
  /** Tracking IDs — go on the audit row, never reach Twilio. */
  userId?: UserId;
  sessionId?: SessionId;
  turnId?: TurnId;
}

export type CrisisOutcomeCategory =
  | 'handoff_dispatched'
  | 'handoff_failed'
  | 'duplicate_suppressed'
  | 'handoff_blocked_by_suppression';

export interface CrisisHandoffResult {
  outcomeCategory: CrisisOutcomeCategory;
  /** Crisis_resources library version pinned at handoff time (e.g. 'v2'). */
  resourcesVersion: string;
  /** Twilio waMessageId when dispatch succeeded. */
  waMessageId?: string;
  /** Sanitized failure reason when outcomeCategory != dispatched. */
  errorReason?: string;
  /** crisis_events row id, for ops cross-reference. */
  auditEventId: string;
}
