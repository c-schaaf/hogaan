import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cohorts } from './cohorts.js';
import { userStatus } from './enums.js';

/**
 * Users keyed on phone hash. PII discipline (CLAUDE.md hard rule #4):
 *   - phone_hash: SHA-256 of E.164. Stable identifier for joins.
 *   - phone_encrypted: AES-256-GCM(E.164). Decryptable only by app via
 *     ENCRYPTION_KEY_BASE64. DB never has the key.
 *   - first_name_encrypted: same encryption discipline. First name is the
 *     ONLY name-shaped data we keep. Never displayed to LLM providers
 *     (Process #9 strips it before prompt assembly).
 *
 * lastCompletedStep drives Process #1 resume routing.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneHash: text('phone_hash').notNull().unique(),
  phoneEncrypted: text('phone_encrypted'),
  firstNameEncrypted: text('first_name_encrypted'),
  status: userStatus('status').notNull().default('provisional'),
  lastCompletedStep: integer('last_completed_step').notNull().default(0),
  needsProfileReview: boolean('needs_profile_review').notNull().default(false),
  /** Self-reported leadership goals (PRD onboarding step 4). */
  goals: jsonb('goals'),
  /** Student | Professional | Leader. Kept nullable for backwards compatibility;
   *  superseded by experience_band per customer-feedback PR4. */
  role: text('role'),
  /**
   * Years of leadership experience: '<5' | '5-10' | '10+'. Customer-feedback
   * PR4 — replaces role as the primary segmentation in prompt assembly.
   * Nullable; existing rows are unaffected.
   */
  experienceBand: text('experience_band'),
  /** Free-text city/region. */
  location: text('location'),
  timezone: text('timezone').default('Africa/Mogadishu'),
  isDiaspora: boolean('is_diaspora').notNull().default(false),
  /** Twelve-practice subset the user has signaled focus on. */
  mappedPractices: jsonb('mapped_practices'),
  /** Free-form profile flags (e.g., needs_profile_review caveats, ops review notes). */
  profileFlags: jsonb('profile_flags'),
  cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'set null' }),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
