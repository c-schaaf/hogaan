import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Database, SqlClient } from '../../src/shared/db/client.js';
import type { RedisBundle } from '../../src/shared/redis/client.js';
import type { RateLimiters } from '../../src/shared/redis/rate-limit.js';
import {
  INBOUND_DEAD_LETTER_KEY,
  INBOUND_QUEUE_KEY,
  _resetQueueProcessorForTests,
  enqueueInbound,
  processInboundFromQueue,
  type DeadLetterItem,
  type QueueItem,
} from '../../src/whatsapp-delivery/queue-processor.js';

/**
 * Phase 11 R22 — when the routing pipeline throws, the offending payload
 * MUST land on the bounded dead-letter queue (not vanish into a log) so
 * ops can triage via scripts/inspect-dead-letter.ts.
 *
 * Mocks the pipeline to throw; asserts the failed item appears on the
 * dead-letter list with sanitized error context.
 */

vi.mock('../../src/coaching/webhook-router.js', () => ({
  routeInboundMessage: vi.fn(() => {
    throw new Error('synthetic-pipeline-failure');
  }),
}));

interface FakeRedisStore {
  kv: Map<string, { value: unknown; expiresAt: number | null }>;
  lists: Map<string, string[]>;
}

function fakeRedis(): { redis: RedisBundle; store: FakeRedisStore } {
  const store: FakeRedisStore = { kv: new Map(), lists: new Map() };
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
        return Promise.resolve(null);
      }
      const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : null;
      store.kv.set(key, { value, expiresAt });
      return Promise.resolve('OK');
    },
    lpush: (key: string, value: string) => {
      getList(key).unshift(value);
      return Promise.resolve(getList(key).length);
    },
    rpop: (key: string) => {
      const popped = getList(key).pop() ?? null;
      return Promise.resolve(popped);
    },
    ltrim: (key: string, start: number, stop: number) => {
      const arr = getList(key).slice(start, stop + 1);
      store.lists.set(key, arr);
      return Promise.resolve('OK');
    },
    llen: (key: string) => Promise.resolve(getList(key).length),
    lrange: (key: string, start: number, stop: number) =>
      Promise.resolve(getList(key).slice(start, stop + 1)),
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

describe('Phase 11 R22 — dead-letter queue captures unhandled processor errors', () => {
  it('failing payload moves to dead-letter list with sanitized error context', async () => {
    const { redis, store } = fakeRedis();

    const item: QueueItem = {
      inboundMessageSid: 'SMtest-dl-001',
      fromE164: '+254700099001',
      body: 'this will blow up',
      mediaUrls: [],
      receivedAtIso: new Date().toISOString(),
      traceId: 'trace-dl-001',
    };
    await enqueueInbound(redis, item);

    await processInboundFromQueue({
      config: { logLevel: 'error' } as never,
      db: {} as unknown as Database,
      sql: {} as unknown as SqlClient,
      redis,
      rateLimiters: {} as unknown as RateLimiters,
      traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
    });

    // Inbound queue is drained.
    expect(store.lists.get(INBOUND_QUEUE_KEY) ?? []).toHaveLength(0);

    // Dead-letter queue has the failed item.
    const dl = store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? [];
    expect(dl).toHaveLength(1);

    const dead = JSON.parse(dl[0]!) as DeadLetterItem;
    expect(dead.inboundMessageSid).toBe('SMtest-dl-001');
    expect(dead.errorName).toBe('Error');
    expect(dead.errorMessage).toBe('synthetic-pipeline-failure');
    expect(typeof dead.failedAt).toBe('string');
    // Original payload preserved for triage.
    expect(dead.fromE164).toBe('+254700099001');
    expect(dead.body).toBe('this will blow up');
    expect(dead.traceId).toBe('trace-dl-001');
  });

  it('dead-letter queue stays bounded (LTRIM after each push)', async () => {
    const { redis, store } = fakeRedis();

    // Pre-load 1500 entries to simulate a backlog past the cap.
    const list = store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? [];
    for (let i = 0; i < 1500; i += 1) {
      list.unshift(JSON.stringify({ idx: i }));
    }
    store.lists.set(INBOUND_DEAD_LETTER_KEY, list);
    expect(store.lists.get(INBOUND_DEAD_LETTER_KEY)?.length).toBe(1500);

    const item: QueueItem = {
      inboundMessageSid: 'SMtest-dl-trim',
      fromE164: '+254700099002',
      body: 'one more for the pile',
      mediaUrls: [],
      receivedAtIso: new Date().toISOString(),
      traceId: 'trace-dl-trim',
    };
    await enqueueInbound(redis, item);

    await processInboundFromQueue({
      config: { logLevel: 'error' } as never,
      db: {} as unknown as Database,
      sql: {} as unknown as SqlClient,
      redis,
      rateLimiters: {} as unknown as RateLimiters,
      traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
    });

    // After LTRIM 0..999, length is exactly 1000 — newest entry is at index 0.
    const dl = store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? [];
    expect(dl).toHaveLength(1000);
    const newest = JSON.parse(dl[0]!) as DeadLetterItem;
    expect(newest.inboundMessageSid).toBe('SMtest-dl-trim');
  });
});
