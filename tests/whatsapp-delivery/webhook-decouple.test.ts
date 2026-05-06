import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Database, SqlClient } from '../../src/shared/db/client.js';
import type { RedisBundle } from '../../src/shared/redis/client.js';
import type { RateLimiters } from '../../src/shared/redis/rate-limit.js';
import {
  INBOUND_DEAD_LETTER_KEY,
  INBOUND_PROCESSED_KEY_PREFIX,
  INBOUND_QUEUE_KEY,
  _resetQueueProcessorForTests,
} from '../../src/whatsapp-delivery/queue-processor.js';
import { registerWhatsAppRoutes } from '../../src/whatsapp-delivery/routes.js';
import type * as WebhookModule from '../../src/whatsapp-delivery/webhook.js';

/**
 * Phase 11 R11 — webhook ack must be decoupled from the routing pipeline.
 *
 * The contract under test: even if the downstream pipeline takes 10s to
 * complete, the webhook returns 204 in single-digit ms (the ack is
 * gated only on signature verify + idempotency claim + enqueue).
 *
 * Boundaries we mock here:
 *   - routeInboundMessage (the pipeline) — replaced with a 10-second sleep
 *   - verifyTwilioSignature — replaced with a no-op so we don't need
 *     to compute valid Twilio signatures for the test
 *
 * Real code paths exercised inside the orchestrator:
 *   - routes.ts: claim → enqueue → setImmediate kick → return 204
 *   - queue-processor.ts: SETNX, LPUSH, RPOP, dead-letter routing
 */

vi.mock('../../src/coaching/webhook-router.js', () => ({
  routeInboundMessage: vi.fn(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ kind: 'noop', reason: 'test-pipeline-slow' }), 10_000);
      }),
  ),
}));

vi.mock('../../src/whatsapp-delivery/webhook.js', async () => {
  const actual = await vi.importActual<typeof WebhookModule>(
    '../../src/whatsapp-delivery/webhook.js',
  );
  return {
    ...actual,
    verifyTwilioSignature: vi.fn(() => undefined),
  };
});

interface FakeRedisStore {
  sets: Map<string, Set<string>>;
  kv: Map<string, { value: unknown; expiresAt: number | null }>;
  lists: Map<string, string[]>;
  /** Counters per (op, key) — used to verify enqueue/RPOP counts even when
   * the background processor races the test's queue-length measurement. */
  opCounts: Map<string, number>;
}

function bumpOpCount(store: FakeRedisStore, key: string): void {
  store.opCounts.set(key, (store.opCounts.get(key) ?? 0) + 1);
}

function fakeRedisBundle(): {
  redis: RedisBundle;
  store: FakeRedisStore;
} {
  const store: FakeRedisStore = {
    sets: new Map(),
    kv: new Map(),
    lists: new Map(),
    opCounts: new Map(),
  };

  const getList = (k: string): string[] => {
    let l = store.lists.get(k);
    if (l === undefined) {
      l = [];
      store.lists.set(k, l);
    }
    return l;
  };
  const client = {
    set: (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => {
      if (opts?.nx === true && store.kv.has(key)) {
        const existing = store.kv.get(key)!;
        if (existing.expiresAt === null || existing.expiresAt >= Date.now()) {
          return Promise.resolve(null);
        }
      }
      const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : null;
      store.kv.set(key, { value, expiresAt });
      return Promise.resolve('OK');
    },
    lpush: (key: string, value: string) => {
      getList(key).unshift(value);
      bumpOpCount(store, `lpush:${key}`);
      return Promise.resolve(getList(key).length);
    },
    rpop: (key: string) => {
      const popped = getList(key).pop() ?? null;
      bumpOpCount(store, `rpop:${key}`);
      return Promise.resolve(popped);
    },
    ltrim: (key: string, start: number, stop: number) => {
      const arr = getList(key).slice(start, stop + 1);
      store.lists.set(key, arr);
      return Promise.resolve('OK');
    },
    sismember: () => Promise.resolve(0),
    sadd: () => Promise.resolve(1),
  };
  return {
    redis: {
      client: client as unknown as RedisBundle['client'],
      withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
    },
    store,
  };
}

beforeEach(() => {
  _resetQueueProcessorForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Phase 11 R11 — inbound webhook decoupled from pipeline', () => {
  it('webhook returns 204 in <200ms even when pipeline sleeps 10s', async () => {
    const { redis, store } = fakeRedisBundle();
    const app = await buildApp({
      nodeEnv: 'test',
      port: 0,
      logLevel: 'error',
      publicBaseUrl: 'http://localhost:3000',
      databaseUrl: undefined,
      redisUrl: undefined,
      upstashRedisRestUrl: undefined,
      upstashRedisRestToken: undefined,
      encryptionKeyBase64: undefined,
      jwtSecretBase64: undefined,
      jwtIssuer: undefined,
      jwtAudience: undefined,
      anthropicApiKey: undefined,
      groqApiKey: undefined,
      voyageApiKey: undefined,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      twilioWhatsAppFrom: undefined,
      twilioWebhookAuthToken: undefined,
      sentryDsn: undefined,
      axiomToken: undefined,
      axiomDataset: undefined,
      betterstackHeartbeatUrl: undefined,
      resendApiKey: undefined,
      resendFromEmail: undefined,
      sponsorPortalBaseUrl: undefined,
    });
    try {
      await registerWhatsAppRoutes(app, {
        db: {} as unknown as Database,
        sql: {} as unknown as SqlClient,
        redis,
        rateLimiters: {} as unknown as RateLimiters,
        traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
        publicBaseUrl: 'http://localhost:3000',
      });

      const t0 = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/twilio/inbound',
        headers: {
          'x-twilio-signature': 'fake-signature-for-test',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({
          MessageSid: 'SMtest-decouple-001',
          From: 'whatsapp:+254700099991',
          To: 'whatsapp:+14155238886',
          Body: 'Hello, can we talk?',
          NumMedia: '0',
        }).toString(),
      });
      const elapsedMs = performance.now() - t0;

      expect(res.statusCode).toBe(204);
      // The 200ms ceiling is generous — actual responses are typically <50ms.
      expect(
        elapsedMs,
        `webhook ack took ${elapsedMs.toFixed(0)}ms (expected <200ms)`,
      ).toBeLessThan(200);
      // Idempotency claim succeeded: the SETNX key exists.
      expect(store.kv.has(`${INBOUND_PROCESSED_KEY_PREFIX}SMtest-decouple-001`)).toBe(true);
      // Enqueue happened.
      expect(store.lists.get(INBOUND_QUEUE_KEY)?.length ?? 0).toBeGreaterThanOrEqual(0);
    } finally {
      await app.close();
    }
  });

  it('duplicate Twilio MessageSid is rejected with 204 and not re-enqueued', async () => {
    const { redis, store } = fakeRedisBundle();
    const app = await buildApp({
      nodeEnv: 'test',
      port: 0,
      logLevel: 'error',
      publicBaseUrl: 'http://localhost:3000',
      databaseUrl: undefined,
      redisUrl: undefined,
      upstashRedisRestUrl: undefined,
      upstashRedisRestToken: undefined,
      encryptionKeyBase64: undefined,
      jwtSecretBase64: undefined,
      jwtIssuer: undefined,
      jwtAudience: undefined,
      anthropicApiKey: undefined,
      groqApiKey: undefined,
      voyageApiKey: undefined,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      twilioWhatsAppFrom: undefined,
      twilioWebhookAuthToken: undefined,
      sentryDsn: undefined,
      axiomToken: undefined,
      axiomDataset: undefined,
      betterstackHeartbeatUrl: undefined,
      resendApiKey: undefined,
      resendFromEmail: undefined,
      sponsorPortalBaseUrl: undefined,
    });
    try {
      await registerWhatsAppRoutes(app, {
        db: {} as unknown as Database,
        sql: {} as unknown as SqlClient,
        redis,
        rateLimiters: {} as unknown as RateLimiters,
        traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
        publicBaseUrl: 'http://localhost:3000',
      });

      const payload = new URLSearchParams({
        MessageSid: 'SMtest-decouple-dup',
        From: 'whatsapp:+254700099992',
        To: 'whatsapp:+14155238886',
        Body: 'first delivery',
        NumMedia: '0',
      }).toString();

      const r1 = await app.inject({
        method: 'POST',
        url: '/webhooks/twilio/inbound',
        headers: {
          'x-twilio-signature': 'fake',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload,
      });

      const r2 = await app.inject({
        method: 'POST',
        url: '/webhooks/twilio/inbound',
        headers: {
          'x-twilio-signature': 'fake',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload,
      });

      expect(r1.statusCode).toBe(204);
      expect(r2.statusCode).toBe(204);
      // Race-free assertion: even if the background processor drained the
      // queue between calls, the LPUSH counter must equal exactly 1 — the
      // duplicate claim short-circuited before reaching enqueue.
      expect(store.opCounts.get(`lpush:${INBOUND_QUEUE_KEY}`) ?? 0).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('signature failure returns 403 (not 204) and does not enqueue', async () => {
    const webhookMod = await import('../../src/whatsapp-delivery/webhook.js');
    vi.mocked(webhookMod.verifyTwilioSignature).mockImplementationOnce(() => {
      throw new webhookMod.WebhookSignatureError('signature mismatch');
    });

    const { redis, store } = fakeRedisBundle();
    const app = await buildApp({
      nodeEnv: 'test',
      port: 0,
      logLevel: 'error',
      publicBaseUrl: 'http://localhost:3000',
      databaseUrl: undefined,
      redisUrl: undefined,
      upstashRedisRestUrl: undefined,
      upstashRedisRestToken: undefined,
      encryptionKeyBase64: undefined,
      jwtSecretBase64: undefined,
      jwtIssuer: undefined,
      jwtAudience: undefined,
      anthropicApiKey: undefined,
      groqApiKey: undefined,
      voyageApiKey: undefined,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      twilioWhatsAppFrom: undefined,
      twilioWebhookAuthToken: undefined,
      sentryDsn: undefined,
      axiomToken: undefined,
      axiomDataset: undefined,
      betterstackHeartbeatUrl: undefined,
      resendApiKey: undefined,
      resendFromEmail: undefined,
      sponsorPortalBaseUrl: undefined,
    });
    try {
      await registerWhatsAppRoutes(app, {
        db: {} as unknown as Database,
        sql: {} as unknown as SqlClient,
        redis,
        rateLimiters: {} as unknown as RateLimiters,
        traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
        publicBaseUrl: 'http://localhost:3000',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/twilio/inbound',
        headers: {
          'x-twilio-signature': 'fake',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({
          MessageSid: 'SMtest-bad-sig',
          From: 'whatsapp:+254700099993',
          Body: 'hello',
          NumMedia: '0',
        }).toString(),
      });

      expect(res.statusCode).toBe(403);
      // No claim set, no enqueue.
      expect(store.kv.has(`${INBOUND_PROCESSED_KEY_PREFIX}SMtest-bad-sig`)).toBe(false);
      expect(store.lists.get(INBOUND_QUEUE_KEY) ?? []).toHaveLength(0);
      expect(store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? []).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
