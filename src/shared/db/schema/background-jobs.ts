import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * P2.5 — durable background job queue (see src/jobs/runner.ts). Work that
 * must never run inside the chat turn: brief updates, follow-up emails,
 * weekly nudges. `dedupe_key` is unique, which makes enqueue idempotent.
 */
export const backgroundJobs = pgTable('background_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  payload: jsonb('payload').notNull().default({}),
  /** pending | running | done | failed | cancelled */
  status: text('status').notNull().default('pending'),
  runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export type BackgroundJobRow = typeof backgroundJobs.$inferSelect;
