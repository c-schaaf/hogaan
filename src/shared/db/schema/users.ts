import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userStatus } from './enums.js';

/**
 * Users keyed on phone hash. PII discipline (CLAUDE.md hard rule #4):
 *   - phone_hash: SHA-256 of E.164. Stable identifier for joins. For
 *     web-only signups (no phone yet) the auth code generates a synthetic
 *     value of sha256('web:' || users.id) so the NOT NULL UNIQUE invariant
 *     holds without coupling web onboarding to phone capture.
 *   - phone_encrypted: AES-256-GCM(E.164). Decryptable only by app via
 *     ENCRYPTION_KEY_BASE64. DB never has the key. NULL for web-only users.
 *   - first_name_encrypted: same encryption discipline. First name is the
 *     ONLY name-shaped data we keep. Never displayed to LLM providers
 *     (Process #9 strips it before prompt assembly).
 *   - full_name_encrypted: web signup captures full name; AES-256-GCM
 *     encrypted same way as first_name_encrypted. Both columns exist
 *     during the migration period; long-term we'll move to one.
 *   - email / password_hash / email_verified_at: web auth (Phase B).
 *     Email is case-insensitive unique via a partial index defined in
 *     drizzle/0007_web_user_email.sql.
 *   - comm_style / response_depth: typeform onboarding outputs.
 *     'direct' | 'warm' and 'quick' | 'standard' | 'deep' respectively.
 *
 * lastCompletedStep drives Process #1 resume routing.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneHash: text('phone_hash').notNull().unique(),
  phoneEncrypted: text('phone_encrypted'),
  firstNameEncrypted: text('first_name_encrypted'),
  fullNameEncrypted: text('full_name_encrypted'),
  email: text('email'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash'),
  /**
   * Supabase Auth uuid (auth.users.id). Populated JIT on first /api/*
   * call from a Supabase-authed session. Unique-when-not-null via the
   * partial index in drizzle/0008_supabase_auth.sql. WhatsApp users
   * keep this NULL.
   */
  supabaseUserId: uuid('supabase_user_id'),
  status: userStatus('status').notNull().default('provisional'),
  lastCompletedStep: integer('last_completed_step').notNull().default(0),
  needsProfileReview: boolean('needs_profile_review').notNull().default(false),
  /** Student | Professional | Leader. Kept nullable for backwards compatibility;
   *  superseded by experience_band per customer-feedback PR4. */
  role: text('role'),
  /**
   * Years of leadership experience: '<5' | '5-10' | '10+'. Customer-feedback
   * PR4 — replaces role as the primary segmentation in prompt assembly.
   * Nullable; existing rows are unaffected.
   */
  experienceBand: text('experience_band'),
  /** Communication style preference: 'direct' | 'warm'. Web onboarding. */
  commStyle: text('comm_style'),
  /** Default response depth: 'quick' | 'standard' | 'deep'. Web onboarding. */
  responseDepth: text('response_depth'),
  /** Free-text city/region. */
  location: text('location'),
  timezone: text('timezone').default('Africa/Mogadishu'),
  /** Twelve-practice subset the user has signaled focus on. */
  mappedPractices: jsonb('mapped_practices'),
  /** Free-form profile flags (e.g., needs_profile_review caveats, ops review notes). */
  profileFlags: jsonb('profile_flags'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
