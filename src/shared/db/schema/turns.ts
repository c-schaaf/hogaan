import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { users } from './users.js';

/**
 * One row per inbound message + response. Process #2 §12a writes this as part
 * of the fail-open post-turn persistence. Stored verbatim for audit + voice
 * fidelity review (Phase 7.15 / 10.2 harness reads from here).
 *
 * Content note: this table holds plaintext user messages and Hamse-voice
 * responses. Both are PII-bearing and must NEVER be exposed to sponsors
 * (PRD §8 hard rule). Sponsor portal queries aggregate over `intent`,
 * `practice_tag`, `qa_outcome` — never `user_message` or `response_text`.
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
