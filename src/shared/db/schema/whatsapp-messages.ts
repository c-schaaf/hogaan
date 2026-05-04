import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  whatsappDirection,
  whatsappMessageType,
  whatsappPriority,
  whatsappStatus,
} from './enums.js';
import { users } from './users.js';

/**
 * Process #11 §9 message log. Inbound + outbound rows live here for full
 * compliance trail. Idempotency state is in Redis (24h TTL); this table is
 * the durable record.
 *
 * `correlation_id` is unique on outbound rows so duplicate dispatches can be
 * detected at the DB layer if Redis somehow lost state. (Defense in depth —
 * Process #11 calls this out explicitly.)
 *
 * `content_text` holds the message body. PII discipline: never expose to
 * sponsors; never send to LLM providers in raw form (always go through the
 * Process #9 prompt assembly which strips PII).
 */
export const whatsappMessages = pgTable('whatsapp_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  correlationId: text('correlation_id').notNull().unique(),
  callerProcessId: text('caller_process_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  direction: whatsappDirection('direction').notNull(),
  messageType: whatsappMessageType('message_type').notNull(),
  templateName: text('template_name'),
  templateParams: jsonb('template_params'),
  contentText: text('content_text'),
  priority: whatsappPriority('priority').notNull().default('Normal'),
  status: whatsappStatus('status').notNull().default('queued'),
  /** Provider-side identifier (Twilio Message SID). */
  waMessageId: text('wa_message_id'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }).defaultNow().notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  /** Process #11 E1..E15. */
  terminalEndEvent: text('terminal_end_event'),
  /** {retryCount, queueLoops, dispatchPathTaken} — for trace + debugging. */
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsAppMessage = typeof whatsappMessages.$inferInsert;
