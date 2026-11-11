import type { FastifyInstance } from 'fastify';
import { entitlementSummary } from '../entitlements/index.js';
import { reportP2 } from '../incident-handling/index.js';
import { isEnabled } from '../shared/flags/index.js';
import type { WebApiRoutesOpts } from '../web-api/routes.js';
import { requireSupabaseSession } from '../web-api/supabase-session.js';
import {
  createCheckoutUrl,
  createPortalUrl,
  DEMO_WEBHOOK_SECRET,
  handleStripeEvent,
  signTestPayload,
  verifyWebhook,
} from './stripe.js';

/**
 * P4 routes (all 404 unless FEATURE_BILLING is on):
 *   GET  /api/billing            plan, limits, usage
 *   POST /api/billing/checkout   -> Stripe-hosted Checkout URL
 *   POST /api/billing/portal     -> Stripe customer portal URL (cancel, card)
 *   POST /api/billing/webhook    Stripe -> us; signature verified on the raw body
 *   POST /api/demo/billing {action: subscribe|cancel}
 *        DEMO MODE ONLY: builds the events Stripe would send, signs them with a
 *        local secret, and runs them through the same verify + handle code.
 */
export function registerBillingRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  const off = () => !isEnabled(opts.config, 'billing');
  const view = async (userId: string) => ({
    ...(await entitlementSummary(opts.config, opts.db, userId)),
    demo: opts.config.demoMode === true,
    priceLabel: '$20 / month',
  });

  app.get('/api/billing', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Billing');
    if (s === null) return;
    return reply.send(await view(s.userId));
  });

  app.post('/api/billing/checkout', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Billing');
    if (s === null) return;
    if (opts.config.demoMode === true) return reply.send({ demo: true });
    try {
      return reply.send({
        url: await createCheckoutUrl(opts.config, opts.db, s.userId, s.email ?? ''),
      });
    } catch (err) {
      reportP2('billing checkout failed', {
        source: 'Billing.Checkout',
        extra: { error: err instanceof Error ? err.message : String(err) },
      });
      return reply.code(503).send({ error: 'billing_unavailable' });
    }
  });

  app.post('/api/billing/portal', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Billing');
    if (s === null) return;
    if (opts.config.demoMode === true) return reply.send({ demo: true });
    try {
      return reply.send({ url: await createPortalUrl(opts.config, opts.db, s.userId) });
    } catch {
      return reply.code(503).send({ error: 'billing_unavailable' });
    }
  });

  // Raw body is required for Stripe signature verification, so this route
  // lives in its own encapsulated context with a buffer body parser.
  void app.register((child, _o, done) => {
    child.removeAllContentTypeParsers();
    child.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, next) => next(null, body));
    child.post('/api/billing/webhook', async (req, reply) => {
      if (off()) return reply.code(404).send({ error: 'feature_off' });
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') return reply.code(400).send({ error: 'missing_signature' });
      let event;
      try {
        event = verifyWebhook(opts.config, req.body as Buffer, sig);
      } catch {
        return reply.code(400).send({ error: 'invalid_signature' });
      }
      const result = await handleStripeEvent(opts.db, event, {
        personalPriceId: opts.config.stripePricePersonal,
      });
      return reply.send({ received: true, result });
    });
    done();
  });

  app.post<{ Body: { action?: unknown } }>('/api/demo/billing', async (req, reply) => {
    if (off() || opts.config.demoMode !== true || opts.config.nodeEnv === 'production') {
      return reply.code(404).send({ error: 'not_found' });
    }
    const s = await requireSupabaseSession(req, reply, opts, 'E1_DemoTools');
    if (s === null) return;
    const subId = `sub_demo_${s.userId.slice(0, 8)}`;
    const t = Math.floor(Date.now() / 1000);
    const subscription = (status: string) => ({
      id: subId,
      object: 'subscription',
      status,
      customer: 'cus_demo',
      cancel_at_period_end: false,
      metadata: { hogaanUserId: s.userId },
      items: { object: 'list', data: [{ current_period_end: t + 30 * 86400 }] },
    });
    const events =
      req.body?.action === 'subscribe'
        ? [
            {
              id: `evt_demo_${Date.now()}_1`,
              type: 'checkout.session.completed',
              data: {
                object: {
                  object: 'checkout.session',
                  mode: 'subscription',
                  client_reference_id: s.userId,
                  customer: 'cus_demo',
                  subscription: subId,
                  payment_status: 'paid',
                },
              },
            },
            {
              id: `evt_demo_${Date.now()}_2`,
              type: 'customer.subscription.updated',
              data: { object: subscription('active') },
            },
          ]
        : req.body?.action === 'cancel'
          ? [
              {
                id: `evt_demo_${Date.now()}_3`,
                type: 'customer.subscription.deleted',
                data: { object: subscription('canceled') },
              },
            ]
          : null;
    if (events === null) return reply.code(400).send({ error: 'invalid_action' });
    for (const e of events) {
      const payload = JSON.stringify({
        object: 'event',
        created: Math.floor(Date.now() / 1000),
        ...e,
      });
      const event = verifyWebhook(
        opts.config,
        payload,
        signTestPayload(payload, DEMO_WEBHOOK_SECRET),
      );
      await handleStripeEvent(opts.db, event);
    }
    return reply.send(await view(s.userId));
  });
}
