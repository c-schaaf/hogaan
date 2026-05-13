import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Coaching session — a contiguous run of turns from one user. New session
 * starts when last_turn_at is older than the session-idle threshold (Phase 4B
 * decides; default 30 min, see plan open question §2).
 *
 * closed_at non-null = session terminated normally (Process #2 E2 SignalClose
 * or session-lifecycle archival). Reopened sessions start a new row.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  lastTurnAt: timestamp('last_turn_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  turnCount: integer('turn_count').notNull().default(0),
  metadata: jsonb('metadata'),
  /** 3-7 word summary derived after the first turn (Phase C). NULL until set. */
  title: text('title'),
  /**
   * Web-app "Private session" toggle. When true, the chat turn API doesn't
   * write turns to the turns table (or scrubs them at session close). These
   * sessions are filtered from /api/sessions list output.
   */
  isPrivate: boolean('is_private').notNull().default(false),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
