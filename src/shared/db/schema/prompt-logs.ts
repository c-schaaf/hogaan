import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { turns } from './turns.js';
import { users } from './users.js';

/**
 * Process #9 §14 async prompt log. One row per assembled prompt — used for
 * offline voice-fidelity audit, regression testing, and replay-determinism
 * verification.
 *
 * `prompt_text_encrypted` holds the assembled prompt encrypted via the same
 * AES-256-GCM key as plaintext PII columns. The prompt may contain user
 * messages, memory excerpts, and Hamse-voice content; PII discipline applies.
 *
 * `determinism_hash` lets us look up "all prompts that were structurally
 * identical to this one" — the basis for the Phase 7.15 voice-fidelity
 * audit harness.
 */
// SCRUM (PR 5) — `practice_tag` and `level_tag` columns dropped in
// migration 0016. The tagger has been stubbed since the unified prompt
// landed (`src/prompt-assembly/validate.ts:7-15`) so they have been null
// on every live row. The `analytics.prompt_logs_safe` view was re-created
// in 0017 without these columns.
export const promptLogs = pgTable('prompt_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'set null' }),
  responseMode: text('response_mode').notNull(),
  /** AES-256-GCM ciphertext of the full assembled prompt body. */
  promptTextEncrypted: text('prompt_text_encrypted').notNull(),
  tokenCount: integer('token_count').notNull(),
  /** {memoryTruncated, sessionTruncated, culturalFramingDropped, fallbackModelUsed, contextFetchPartial}. */
  degradationFlags: jsonb('degradation_flags').notNull(),
  /** {promptTemplates: {version, hash}, voiceRules: {...}, culturalFraming: {...}, resolvedAt}. */
  libraryVersions: jsonb('library_versions').notNull(),
  determinismHash: text('determinism_hash').notNull(),
  /** True when the assembler returned E10_PromptLogWriteFailed (the row was inserted later via retry). */
  logWriteRetried: boolean('log_write_retried').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PromptLogRow = typeof promptLogs.$inferSelect;
export type NewPromptLogRow = typeof promptLogs.$inferInsert;
