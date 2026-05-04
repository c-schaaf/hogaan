import { boolean, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { libraryName } from './enums.js';

/**
 * Process #17 (Library / Content Management) — minimal MVP store. Each row is
 * one published version of one library. Process #9 §2 resolves the active
 * version of (prompt_templates, voice_rules, cultural_framing) at the start
 * of every prompt assembly and pins the snapshot in `turns.library_versions`
 * so the audit harness can replay exactly.
 *
 * `payload`: canonical JSON of the library content. `hash`: SHA-256 of
 * canonical-stringify(payload). `active`: exactly one row per library_name
 * may be true at a time (enforced via partial unique index).
 *
 * Hamse owns the content under `payload` per CLAUDE.md hard rule #3 — engineers
 * can change the schema, never the content of voice_rules / cultural_framing.
 */
export const libraryVersions = pgTable(
  'library_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    libraryName: libraryName('library_name').notNull(),
    version: text('version').notNull(),
    payload: jsonb('payload').notNull(),
    hash: text('hash').notNull(),
    active: boolean('active').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    publishedBy: text('published_by').notNull().default('system'),
    notes: text('notes'),
  },
  (t) => ({
    nameVersionUq: uniqueIndex('library_versions_name_version_uq').on(t.libraryName, t.version),
  }),
);

export type LibraryVersionRow = typeof libraryVersions.$inferSelect;
export type NewLibraryVersionRow = typeof libraryVersions.$inferInsert;
