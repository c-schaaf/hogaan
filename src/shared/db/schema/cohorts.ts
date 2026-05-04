import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sponsors } from './sponsors.js';

/**
 * A cohort is a single sponsor purchase: N seats for a specific population
 * over a specific window. Codes are issued at cohort granularity, not per-user.
 */
export const cohorts = pgTable('cohorts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sponsorId: uuid('sponsor_id')
    .notNull()
    .references(() => sponsors.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  seatCount: integer('seat_count').notNull(),
  redemptionWindowStart: timestamp('redemption_window_start', { withTimezone: true }).notNull(),
  redemptionWindowEnd: timestamp('redemption_window_end', { withTimezone: true }).notNull(),
  /** Days a redeemed seat remains active. */
  seatDurationDays: integer('seat_duration_days').notNull(),
  /** Mogadishu | Hargeisa | Other | Mixed (PRD §8). */
  targetGeography: text('target_geography').notNull(),
  targetUserDescription: text('target_user_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Cohort = typeof cohorts.$inferSelect;
export type NewCohort = typeof cohorts.$inferInsert;
