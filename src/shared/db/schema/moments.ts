import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { turns } from './turns.js';
import { users } from './users.js';

/** P2.1 — an upcoming conversation or event the leader is preparing for. */
export const moments = pgTable('moments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  whatEncrypted: text('what_encrypted').notNull(),
  /** By role ("their director"), never a full name. Encrypted. */
  withWhomEncrypted: text('with_whom_encrypted'),
  happensAt: timestamp('happens_at', { withTimezone: true }),
  /** upcoming | reflected | dismissed */
  status: text('status').notNull().default('upcoming'),
  /** conversation | leader | assistant (MCP) */
  source: text('source').notNull().default('conversation'),
  /** sha256 of normalized "what" — stops the updater duplicating a moment. */
  dedupeHash: text('dedupe_hash').notNull(),
  followupSentAt: timestamp('followup_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** P2.3 — how it went, what they would do differently. */
export const momentOutcomes = pgTable('moment_outcomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  momentId: uuid('moment_id')
    .notNull()
    .references(() => moments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** well | mixed | hard */
  howItWent: text('how_it_went').notNull(),
  differentlyEncrypted: text('differently_encrypted'),
  /** Optional 1–5 self-rating before / after (feeds "confidence change"). */
  confidenceBefore: integer('confidence_before'),
  confidenceAfter: integer('confidence_after'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** P2.4 — helpful / not helpful on a coach reply. */
export const turnRatings = pgTable('turn_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  turnId: uuid('turn_id')
    .notNull()
    .references(() => turns.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** helpful | not_helpful */
  rating: text('rating').notNull(),
  noteEncrypted: text('note_encrypted'),
  promptVersion: text('prompt_version'),
  determinismHash: text('determinism_hash'),
  modelUsed: text('model_used'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** D4 — explicit opt-ins for proactive email. Absent row = opted out. */
export const notificationPrefs = pgTable('notification_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  followupEmailOptIn: boolean('followup_email_opt_in').notNull().default(false),
  weeklyNudgeOptIn: boolean('weekly_nudge_opt_in').notNull().default(false),
  unsubscribedAllAt: timestamp('unsubscribed_all_at', { withTimezone: true }),
  quietStartHour: integer('quiet_start_hour').notNull().default(21),
  quietEndHour: integer('quiet_end_hour').notNull().default(8),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Hard Rule 5 — idempotency + frequency-cap ledger. No email content. */
export const emailSends = pgTable('email_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  /** sending | sent | captured (demo) | failed */
  status: text('status').notNull().default('sending'),
  providerMessageId: text('provider_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
