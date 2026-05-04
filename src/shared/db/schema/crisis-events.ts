import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { turns } from './turns.js';
import { users } from './users.js';

/**
 * Phase 5B audit table for every crisis routing event. Two trigger paths
 * (Process #2 Step 1 first-line classifier, Process #10 Check 8 second-line
 * safety classifier) both write a row here when they fire, regardless of
 * whether the downstream Process #11 dispatch ultimately succeeded.
 *
 * **PII discipline**: NO transcript content. The original user message that
 * triggered the crisis is NOT stored — only the structural fact of the event
 * + which path triggered + what the dispatch outcome was. PRD §8 sponsor
 * reporting aggregates by `outcome_category` over hashed user counts.
 */
export const crisisEvents = pgTable('crisis_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'set null' }),
  /** 'process_2_step_1' | 'process_10_check_8' */
  triggerSource: text('trigger_source').notNull(),
  /**
   * 'handoff_dispatched' | 'handoff_failed' | 'duplicate_suppressed' |
   * 'handoff_blocked_by_suppression'
   */
  outcomeCategory: text('outcome_category').notNull(),
  /** Crisis_resources library version pinned at the time of the event. */
  resourcesVersion: text('resources_version').notNull(),
  /** Twilio waMessageId when dispatch succeeded; null otherwise. */
  dispatchedWaMessageId: text('dispatched_wa_message_id'),
  /** Sanitized error string when outcome != dispatched. No PII. */
  errorReason: text('error_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type CrisisEvent = typeof crisisEvents.$inferSelect;
export type NewCrisisEvent = typeof crisisEvents.$inferInsert;
