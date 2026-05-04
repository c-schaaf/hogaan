import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { suppressionReason } from './enums.js';

/**
 * Durable suppression list. The Redis set (`suppression:set`) is the hot path
 * for Process #11 §3 / Process #12 §3 SISMEMBER checks; this table is the
 * source of truth so a Redis flush doesn't lose opt-out state.
 *
 * `phone_hash` is the primary key — the only legal identifier (CLAUDE.md
 * hard rule #4: "phone numbers hashed for IDs").
 */
export const suppressionList = pgTable('suppression_list', {
  phoneHash: text('phone_hash').primaryKey(),
  reason: suppressionReason('reason').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
});

export type SuppressionEntry = typeof suppressionList.$inferSelect;
export type NewSuppressionEntry = typeof suppressionList.$inferInsert;
