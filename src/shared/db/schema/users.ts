import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userStatus } from './enums.js';

/**
 * Web-only users. Keyed by Supabase Auth via `supabase_user_id`. The
 * WhatsApp-era phone columns (phone_hash, phone_encrypted, password_hash,
 * comm_style, response_depth, profile_flags, last_completed_step,
 * needs_profile_review) were dropped in the launch-cleanup batch.
 *
 *   - first_name_encrypted / full_name_encrypted: AES-256-GCM via
 *     src/shared/db/encryption.ts. The DB never sees plaintext and never
 *     holds the key. Per CLAUDE.md hard rule #3 — names are PII.
 *   - email: case-insensitive unique via the partial index defined in
 *     drizzle/0007_web_user_email.sql.
 *   - supabase_user_id: populated JIT by src/web-api/supabase-session.ts
 *     on first authenticated /api/* call.
 *   - timezone defaults to UTC; users may override during onboarding.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstNameEncrypted: text('first_name_encrypted'),
  fullNameEncrypted: text('full_name_encrypted'),
  email: text('email'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  supabaseUserId: uuid('supabase_user_id'),
  status: userStatus('status').notNull().default('provisional'),
  /** Student | Professional | Leader. Kept nullable for backwards compatibility;
   *  superseded by experience_band per customer-feedback PR4. */
  role: text('role'),
  /**
   * Years of leadership experience: '<5' | '5-10' | '10+'. Customer-feedback
   * PR4 — primary segmentation in prompt assembly.
   */
  experienceBand: text('experience_band'),
  /** Free-text city/region. */
  location: text('location'),
  timezone: text('timezone').default('UTC'),
  /** Twelve-practice subset the user has signaled focus on. */
  mappedPractices: jsonb('mapped_practices'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
