import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Sponsors fund cohorts. PRD §8: legal name, primary contact, mission summary,
 * billing, reporting preferences, compliance attestations.
 *
 * No direct user data here — sponsors never see individuals.
 */
export const sponsors = pgTable('sponsors', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  primaryContactEmail: text('primary_contact_email').notNull(),
  missionSummary: text('mission_summary'),
  billingAddress: jsonb('billing_address'),
  reportingPreferences: jsonb('reporting_preferences'),
  complianceNotes: text('compliance_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Sponsor = typeof sponsors.$inferSelect;
export type NewSponsor = typeof sponsors.$inferInsert;
