import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { triggerSource } from './enums.js';
import { users } from './users.js';

/**
 * Append-only identity audit log. CLAUDE.md hard rule #4: audit-log writes
 * are FAIL-CLOSED. If we cannot insert, the request returns 5xx and the
 * route handler is never invoked.
 *
 * Post-WhatsApp retirement (launch-cleanup batch), the writer is
 * src/web-api/supabase-session.ts — one row per authenticated /api/*
 * request. The phone_hash column was dropped in the same batch (no
 * remaining writer carried a phone hash).
 *
 * The post-migration SQL revokes UPDATE/DELETE on this table from the
 * application role; only INSERT is granted.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: text('request_id').notNull(),
  triggerSource: triggerSource('trigger_source').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Terminal end event id. Today: E1_SupabaseSessionValidated. */
  targetEndEvent: text('target_end_event').notNull(),
  ipAddress: text('ip_address'),
  inputErrors: jsonb('input_errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
