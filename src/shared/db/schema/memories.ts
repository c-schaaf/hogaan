import { jsonb, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';
import { turns } from './turns.js';
import { users } from './users.js';

/**
 * Vector memory — Process #8 read/write. PRD §6: voyage-3-lite at 1024 dim,
 * indefinite retention for active users.
 *
 * `kind` discriminator in metadata: 'turn' (auto-extracted from turn content),
 * 'event' (user told us "I got promoted"), 'fact' (curated profile bits).
 *
 * The HNSW cosine index is created out-of-band in the migration SQL —
 * drizzle's `using('hnsw', ...)` helper varies by version, so we keep that
 * declarative SQL alongside the table CREATE.
 */
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  embedding: vector('embedding', { dimensions: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
