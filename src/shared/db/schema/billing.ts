import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** P4.1 — the leader's paid plan, mirrored from Stripe webhooks. No row = Free. */
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** free | personal. (Sponsored seats come from cohort membership — Phase 5.) */
  plan: text('plan').notNull().default('free'),
  /** Stripe subscription status: active, trialing, past_due, canceled, … */
  status: text('status').notNull().default('inactive'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  /** `created` time of the newest Stripe event applied — older events are ignored. */
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Stripe webhook idempotency ledger. */
export const billingEvents = pgTable('billing_events', {
  eventId: text('event_id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});
