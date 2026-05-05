import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sponsors } from './sponsors.js';
import { sponsorUserRole } from './enums.js';

/**
 * Sponsor portal identity (Phase 9A.7). One row per human who can log into the
 * sponsor portal. Authentication flows through `src/identity/token.ts` —
 * this table just records who's allowed in and what role they hold.
 *
 * Email is the magic-link target. Lower-cased + unique per sponsor so we
 * don't accidentally issue two tokens for "Foo@Bar.com" vs "foo@bar.com".
 *
 * `sponsorId` is null when role='hogaan_ops' — internal staff aren't tied to
 * a specific sponsor.
 */
export const sponsorUsers = pgTable(
  'sponsor_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sponsorId: uuid('sponsor_id').references(() => sponsors.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    role: sponsorUserRole('role').notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailUnique: uniqueIndex('sponsor_users_email_unique').on(t.email),
  }),
);

export type SponsorUser = typeof sponsorUsers.$inferSelect;
export type NewSponsorUser = typeof sponsorUsers.$inferInsert;
