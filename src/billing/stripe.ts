import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import type { Database } from '../shared/db/client.js';
import { billingEvents, subscriptions } from '../shared/db/schema/billing.js';
import { requireConfig, type AppConfig } from '../shared/secrets/config.js';

/**
 * P4.1 — Stripe subscriptions (TEST MODE on the fork). Built against
 * stripe-node 23.0.1 (API version 2026-09-30.endive) following Stripe's
 * "Build a subscriptions integration — Stripe-hosted page" guide:
 *   - hosted Checkout in `subscription` mode, `client_reference_id` = our user id
 *   - provision on `checkout.session.completed`, track status from
 *     `customer.subscription.created|updated|deleted`
 *   - customer portal for cancel / card changes
 *   - webhook signature verified on the RAW body; each event id handled once
 * Hogaan never sees or stores card data.
 */

/** Demo mode only: a local signing secret so demo upgrades exercise the real webhook path. */
export const DEMO_WEBHOOK_SECRET = 'whsec_hogaan_demo_only';

let cached: Stripe | undefined;
export function getStripe(config: AppConfig): Stripe {
  cached ??= new Stripe(requireConfig(config, 'stripeSecretKey'));
  return cached;
}
/** Signature helpers need no network and no real key. */
const offline = new Stripe('sk_test_offline_signature_helper_only');

export function webhookSecret(config: AppConfig): string {
  if (config.demoMode === true && config.stripeWebhookSecret === undefined)
    return DEMO_WEBHOOK_SECRET;
  return requireConfig(config, 'stripeWebhookSecret');
}

export function verifyWebhook(
  config: AppConfig,
  rawBody: Buffer | string,
  signature: string,
): Stripe.Event {
  return offline.webhooks.constructEvent(rawBody, signature, webhookSecret(config));
}

export function signTestPayload(payload: string, secret: string): string {
  return offline.webhooks.generateTestHeaderString({ payload, secret });
}

export async function createCheckoutUrl(
  config: AppConfig,
  db: Database,
  userId: string,
  email: string,
): Promise<string> {
  const stripe = getStripe(config);
  const base = config.publicBaseUrl ?? 'http://localhost:3000';
  const existing = (
    await db
      .select({ customer: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1)
  )[0]?.customer;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: requireConfig(config, 'stripePricePersonal'), quantity: 1 }],
    client_reference_id: userId,
    ...(existing ? { customer: existing } : email !== '' ? { customer_email: email } : {}),
    subscription_data: { metadata: { hogaanUserId: userId } },
    success_url: `${base}/profile?billing=success`,
    cancel_url: `${base}/profile?billing=cancelled`,
  });
  if (session.url === null) throw new Error('stripe returned no checkout url');
  return session.url;
}

export async function createPortalUrl(
  config: AppConfig,
  db: Database,
  userId: string,
): Promise<string> {
  const customer = (
    await db
      .select({ customer: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1)
  )[0]?.customer;
  if (customer === null || customer === undefined) throw new Error('no stripe customer for user');
  const base = config.publicBaseUrl ?? 'http://localhost:3000';
  const s = await getStripe(config).billingPortal.sessions.create({
    customer,
    return_url: `${base}/profile`,
  });
  return s.url;
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : v.id;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  // Newer API versions carry the period on each subscription item.
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const ts = item?.current_period_end ?? legacy;
  return typeof ts === 'number' ? new Date(ts * 1000) : null;
}

export type HandleResult = 'handled' | 'duplicate' | 'ignored' | 'stale';

/**
 * Applies one verified Stripe event. Safety rules (from the build's
 * security review):
 *   - The ledger row and the subscription change commit together in ONE
 *     transaction, so a failed update is retried by Stripe instead of being
 *     recorded as done.
 *   - Stripe does not guarantee order: an event older than the newest one
 *     already applied for that leader is ignored ('stale').
 *   - checkout.session.completed grants nothing unless payment_status is
 *     'paid'; subscription events grant Personal only for the configured
 *     Personal price (when STRIPE_PRICE_PERSONAL is set).
 */
export async function handleStripeEvent(
  db: Database,
  event: Stripe.Event,
  opts: { personalPriceId?: string | undefined } = {},
): Promise<HandleResult> {
  const at = new Date(event.created * 1000);
  return db.transaction(async (tx) => {
    const fresh = await tx
      .insert(billingEvents)
      .values({ eventId: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: billingEvents.eventId });
    if (fresh[0] === undefined) return 'duplicate';

    const current = async (where: ReturnType<typeof eq>) =>
      (
        await tx
          .select({ userId: subscriptions.userId, lastEventAt: subscriptions.lastEventAt })
          .from(subscriptions)
          .where(where)
          .limit(1)
      )[0];
    const isStale = (last: Date | null | undefined) =>
      last !== null && last !== undefined && last.getTime() > at.getTime();

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode !== 'subscription' || s.client_reference_id === null) return 'ignored';
        const row = await current(eq(subscriptions.userId, s.client_reference_id));
        if (isStale(row?.lastEventAt)) return 'stale';
        const paid = s.payment_status === 'paid';
        const values = {
          userId: s.client_reference_id,
          plan: 'personal',
          status: paid ? 'active' : 'incomplete',
          stripeCustomerId: idOf(s.customer),
          stripeSubscriptionId: idOf(s.subscription),
          cancelAtPeriodEnd: false,
          lastEventAt: at,
          updatedAt: new Date(),
        };
        await tx
          .insert(subscriptions)
          .values(values)
          .onConflictDoUpdate({ target: subscriptions.userId, set: values });
        return 'handled';
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const priceId = (sub.items?.data?.[0] as { price?: { id?: string } } | undefined)?.price
          ?.id;
        const wrongPrice =
          opts.personalPriceId !== undefined &&
          priceId !== undefined &&
          priceId !== opts.personalPriceId;
        const status =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : wrongPrice
              ? 'other_product'
              : sub.status;
        const set = {
          status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          currentPeriodEnd: periodEnd(sub),
          stripeCustomerId: idOf(sub.customer),
          lastEventAt: at,
          updatedAt: new Date(),
        };
        const bySub = await current(eq(subscriptions.stripeSubscriptionId, sub.id));
        if (bySub !== undefined) {
          if (isStale(bySub.lastEventAt)) return 'stale';
          await tx
            .update(subscriptions)
            .set(set)
            .where(eq(subscriptions.stripeSubscriptionId, sub.id));
          return 'handled';
        }
        const userId = sub.metadata?.['hogaanUserId'];
        if (typeof userId !== 'string' || userId === '') return 'ignored';
        const byUser = await current(eq(subscriptions.userId, userId));
        if (isStale(byUser?.lastEventAt)) return 'stale';
        const values = { userId, plan: 'personal', stripeSubscriptionId: sub.id, ...set };
        await tx
          .insert(subscriptions)
          .values(values)
          .onConflictDoUpdate({ target: subscriptions.userId, set: values });
        return 'handled';
      }
      default:
        return 'ignored';
    }
  });
}
