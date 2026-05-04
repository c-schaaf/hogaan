import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cohorts } from './cohorts.js';
import { accessCodeStatus } from './enums.js';
import { users } from './users.js';

/**
 * One row per code. Code format per PRD §8 stage 4:
 *   lowercase alphanumeric + dash, e.g., "kobciye-3742".
 *
 * Onboarding (Process #1 step 12) extracts pattern from the first message,
 * looks up by code, marks redeemed atomically, joins user to cohort.
 *
 * One code per phone — enforced in app logic, not DB constraint, since the
 * relationship is one redemption attempt per code+user pair.
 */
export const accessCodes = pgTable('access_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  cohortId: uuid('cohort_id')
    .notNull()
    .references(() => cohorts.id, { onDelete: 'restrict' }),
  status: accessCodeStatus('status').notNull().default('unredeemed'),
  redeemedUserId: uuid('redeemed_user_id').references(() => users.id, { onDelete: 'set null' }),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  generationNote: text('generation_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AccessCode = typeof accessCodes.$inferSelect;
export type NewAccessCode = typeof accessCodes.$inferInsert;
