import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { users } from './users.js';

/**
 * One row per inbound message + response. The streaming chat handler
 * (src/web-api/routes.ts) is the sole writer.
 *
 * Content note: this table holds plaintext user messages and Hamse-voice
 * responses. Both are PII-bearing — CLAUDE.md hard rule #3. Analytics
 * surfaces (analytics.turns_safe) must mask these columns.
 *
 * The legacy tagger / triage / quality-check columns (intent, practice_tag,
 * level_tag, secondary_*, tagger_confidence, response_mode, fallback_path,
 * qa_outcome, retry_count, delivery_receipt, degradation_flags,
 * terminal_event) were dropped in the launch-cleanup batch — the
 * pre-2026-05-13 multi-step pipeline that wrote them is gone.
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
  /** 'claude-haiku-4-5' | 'llama-3.3-70b' | 'safe-template' | 'none'. */
  modelUsed: text('model_used'),
  latencyMs: integer('latency_ms'),
  /** Pinned library version snapshot — replay reproduces this turn deterministically. */
  libraryVersions: jsonb('library_versions'),
  determinismHash: text('determinism_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
