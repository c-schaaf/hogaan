/**
 * P4 "Done when": an account moves Free -> Personal -> cancelled and limits
 * follow. No Stripe account was available, so instead of a real test card
 * this drives the real webhook endpoint with events signed exactly as Stripe
 * signs them (stripe-node's generateTestHeaderString), in the order Stripe
 * sends them for a Checkout subscription.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signTestPayload } from '../../src/billing/stripe.js';
import { hasCapability } from '../../src/entitlements/index.js';
import { promptTemplatesV2Unified, publishLibraryVersion } from '../../src/libraries/index.js';
import { resetResolverForTests } from '../../src/libraries/resolver.js';
import { setClockForTests } from '../../src/shared/clock.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current, email: 'l@example.com' })),
}));

const SECRET = 'whsec_test_plan_lifecycle';
// Scripted coach, real everything else; not demo for billing (real webhook secret).
const config = demoTestConfig({ stripeWebhookSecret: SECRET });
let edb: EmbeddedDb;
let app: FastifyInstance;

beforeAll(async () => {
  resetEncryptionCache();
  resetResolverForTests();
  edb = await embeddedTestDb();
  await publishLibraryVersion(edb.db, {
    libraryName: 'prompt_templates',
    version: 'test',
    payload: promptTemplatesV2Unified,
    publishedBy: 'test',
    makeActive: true,
  });
  current = await insertLeader(config, edb.db);
  app = await buildRealApp(config, edb.db);
}, 60_000);
afterAll(async () => {
  setClockForTests(null);
  await edb.close();
});

const chat = (sessionId?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/chat/turn/stream',
    payload: { message: 'hello', ...(sessionId !== undefined ? { sessionId } : {}) },
  });
const sessionIdOf = (body: string) => (/"sessionId":"([0-9a-f-]{36})"/.exec(body) ?? [])[1]!;

async function webhook(event: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify({ object: 'event', ...event });
  return app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signTestPayload(payload, secret),
    },
    payload,
  });
}
const sub = (status: string) => ({
  id: 'sub_123',
  object: 'subscription',
  status,
  customer: 'cus_123',
  cancel_at_period_end: false,
  metadata: { hogaanUserId: current },
  items: { object: 'list', data: [{ current_period_end: 1795000000 }] },
});

describe('P4 Free -> Personal -> cancelled', () => {
  let firstSession = '';

  it('Free: 3 new sessions this month, then a friendly 402; continuing a session still works', async () => {
    setClockForTests(new Date('2026-11-12T12:00:00Z'));
    for (let i = 0; i < 3; i++) {
      const r = await chat();
      expect(r.statusCode).toBe(200);
      if (i === 0) firstSession = sessionIdOf(r.body);
    }
    const blocked = await chat();
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json()).toMatchObject({ error: 'session_limit', used: 3, limit: 3 });
    expect((await chat(firstSession)).statusCode).toBe(200);
    expect(await hasCapability(config, edb.db, current, 'followUps')).toBe(false);
    expect(await hasCapability(config, edb.db, current, 'mcp')).toBe(false);
    // P4.3: the free plan cannot connect an assistant (MCP) — upgrade prompt.
    const mcp = await app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { label: 'x' },
    });
    expect(mcp.statusCode).toBe(402);
    expect(mcp.json()).toMatchObject({ error: 'upgrade_required', capability: 'mcp' });
    const b = (await app.inject({ url: '/api/billing' })).json<{ plan: string }>();
    expect(b.plan).toBe('free');
  });

  it('rejects an unsigned or wrongly signed webhook', async () => {
    const bad = await webhook(
      { id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } },
      'whsec_wrong',
    );
    expect(bad.statusCode).toBe(400);
  });

  it('Personal: checkout.session.completed + subscription.updated(active) lift every limit', async () => {
    expect(
      (
        await webhook({
          id: 'evt_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              object: 'checkout.session',
              mode: 'subscription',
              client_reference_id: current,
              customer: 'cus_123',
              subscription: 'sub_123',
            },
          },
        })
      ).json(),
    ).toMatchObject({ result: 'handled' });
    await webhook({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: sub('active') },
    });
    // Stripe retries deliveries: the same event id is processed once.
    expect(
      (
        await webhook({
          id: 'evt_2',
          type: 'customer.subscription.updated',
          data: { object: sub('active') },
        })
      ).json(),
    ).toMatchObject({ result: 'duplicate' });

    const b = (await app.inject({ url: '/api/billing' })).json<{
      plan: string;
      sessionLimit: number | null;
      currentPeriodEnd: string;
    }>();
    expect(b.plan).toBe('personal');
    expect(b.sessionLimit).toBeNull();
    expect(b.currentPeriodEnd).toBe(new Date(1795000000 * 1000).toISOString());
    expect((await chat()).statusCode).toBe(200);
    expect(await hasCapability(config, edb.db, current, 'followUps')).toBe(true);
    expect(await hasCapability(config, edb.db, current, 'mcp')).toBe(true);
  });

  it('Cancelled: subscription.deleted returns the account to Free limits', async () => {
    await webhook({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: sub('canceled') },
    });
    const b = (await app.inject({ url: '/api/billing' })).json<{ plan: string; status: string }>();
    expect(b).toMatchObject({ plan: 'free', status: 'canceled' });
    expect((await chat()).statusCode).toBe(402);
    expect(await hasCapability(config, edb.db, current, 'mcp')).toBe(false);
  });

  it('a new calendar month resets the free allowance', async () => {
    setClockForTests(new Date('2026-12-01T09:00:00Z'));
    // sessions are stamped with the DB's now(), so count from the clock month
    const { sessionsThisMonth } = await import('../../src/entitlements/index.js');
    expect(await sessionsThisMonth(edb.db, current, new Date('2026-12-01T09:00:00Z'))).toBe(0);
  });

  it('with FEATURE_BILLING off nothing is limited (merging changes nothing)', async () => {
    const off = demoTestConfig({ features: {} });
    expect(await hasCapability(off, edb.db, current, 'mcp')).toBe(true);
    const offApp = await buildRealApp(off, edb.db);
    expect((await offApp.inject({ url: '/api/billing' })).statusCode).toBe(404);
  });
});
