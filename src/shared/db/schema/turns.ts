import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { users } from './users.js';

/**
 * One row per inbound message + response. Process #2 §12a writes this as part
 * of the fail-open post-turn persistence. Stored verbatim for audit + voice
 * fidelity review (Phase 7.15 / 10.2 harness reads from here).
 *
 * Content note: this table holds plaintext user messages and Hamse-voice
 * responses. Both are PII-bearing — CLAUDE.md hard rule #3. Internal
 * aggregations should query `intent`, `practice_tag`, `qa_outcome` and
 * leave `user_message` / `response_text` alone.
 */
export const turns = pgTable('turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userMessage: text('user_message').notNull(),
  responseText: text('response_text'),
  intent: text('intent'),
  practiceTag: text('practice_tag'),
  levelTag: text('level_tag'),
  /** Phase 11 R17 — secondary tagger output (when the tagger surfaces a runner-up
   *  practice/level alongside the primary). NULL when the tagger had only one
   *  signal. Used by the QC review queue to surface ambiguous turns. */
  secondaryPracticeTag: text('secondary_practice_tag'),
  secondaryLevelTag: text('secondary_level_tag'),
  /** Phase 11 R17 — tagger confidence ∈ [0, 1]. Turns with confidence < 0.6
   *  are queued for human review. Defaults to NULL on existing rows; the
   *  tagger writes a real value going forward. */
  taggerConfidence: text('tagger_confidence'),
  responseMode: text('response_mode'),
  /** 'claude-haiku-4-5' | 'llama-3.3-70b' | 'safe-template' | 'none'. */
  modelUsed: text('model_used'),
  fallbackPath: text('fallback_path'),
  qaOutcome: text('qa_outcome'),
  retryCount: integer('retry_count').notNull().default(0),
  latencyMs: integer('latency_ms'),
  /** {memoryTruncated, sessionTruncated, culturalFramingDropped, fallbackModelUsed, contextFetchPartial}. */
  degradationFlags: jsonb('degradation_flags'),
  /** Pinned library version snapshot — replay reproduces this turn deterministically. */
  libraryVersions: jsonb('library_versions'),
  determinismHash: text('determinism_hash'),
  /** Process #11 receipt + dispatch path. */
  deliveryReceipt: jsonb('delivery_receipt'),
  /** Process #2 terminal end event id (E1..E12). */
  terminalEvent: text('terminal_event'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
