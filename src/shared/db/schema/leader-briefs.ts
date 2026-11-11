import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { users } from './users.js';

/**
 * P1.1 / P1.2 — the leader brief. Three living documents plus structured
 * work-context fields, each stored as AES-256-GCM ciphertext of JSON (see
 * src/leader-context/store.ts). One row per leader; deleted with the user.
 */
export const leaderBriefs = pgTable('leader_briefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  profileFieldsEncrypted: text('profile_fields_encrypted'),
  profileEncrypted: text('profile_encrypted'),
  goalsEncrypted: text('goals_encrypted'),
  notesEncrypted: text('notes_encrypted'),
  version: integer('version').notNull().default(0),
  lastSessionId: uuid('last_session_id').references(() => sessions.id, { onDelete: 'set null' }),
  /** 'model:<id>' | 'leader' | 'scripted-demo' | 'system'. */
  updatedBy: text('updated_by').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type LeaderBriefRow = typeof leaderBriefs.$inferSelect;
