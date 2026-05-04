import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { triggerSource } from './enums.js';
import { users } from './users.js';

/**
 * Process #12 §8 — append-only identity audit log. CLAUDE.md hard rule #4:
 * audit log writes are FAIL-CLOSED. If we cannot insert, we do not return an
 * authentication result to the caller.
 *
 * No raw phone numbers — only the SHA-256 hash. The post-migration SQL revokes
 * UPDATE/DELETE on this table from the application role; only INSERT is granted.
 *
 * No PII discipline beyond hash: trigger source, target end event, sanitized
 * input errors only.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: text('request_id').notNull(),
  triggerSource: triggerSource('trigger_source').notNull(),
  phoneHash: text('phone_hash'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Process #12 E1..E11. */
  targetEndEvent: text('target_end_event').notNull(),
  ipAddress: text('ip_address'),
  inputErrors: jsonb('input_errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
