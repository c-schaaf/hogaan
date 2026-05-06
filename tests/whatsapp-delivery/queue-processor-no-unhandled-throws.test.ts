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
  type QueueItem,
} from '../../src/whatsapp-delivery/queue-processor.js';

/**
 * R-12 (HIGH audit risk) — regression lock that the queue-processor's
 * catch (queue-processor.ts:165) is unreachable on standard inputs after
 * R-04. Pre-R-04, PromptAssemblyError thrown by runCoachingTurn would
 * bubble out of routeInboundMessage and the user would receive nothing
 * (silent dead-letter).
 *
 * This test mocks routeInboundMessage at two extremes:
 *   1. Resolves cleanly (post-R-04 contract): no dead-letter.
 *   2. Throws an unexpected non-business error (TypeError): dead-letter
 *      pipe still alive — defense-in-depth for genuinely unknown errors.
 *
 * See audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md.
 */

vi.mock('../../src/coaching/webhook-router.js', () => ({
  routeInboundMessage: vi.fn(),
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

function buildItem(sid: string): QueueItem {
  return {
    inboundMessageSid: sid,
    fromE164: '+254700099012',
    body: 'I had a rough day today',
    mediaUrls: [],
    receivedAtIso: new Date().toISOString(),
    traceId: `trace-${sid}`,
  };
}

const deps = (redis: RedisBundle) => ({
  config: { logLevel: 'error' } as never,
  db: {} as unknown as Database,
  sql: {} as unknown as SqlClient,
  redis,
  rateLimiters: {} as unknown as RateLimiters,
  traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() },
});

beforeEach(async () => {
  _resetQueueProcessorForTests();
  const wrMod = await import('../../src/coaching/webhook-router.js');
  vi.mocked(wrMod.routeInboundMessage).mockReset();
});

describe('R-12 queue-processor regression', () => {
  it('routeInboundMessage resolves cleanly → no dead-letter, no unhandled throw (post-R-04 contract)', async () => {
    const { redis, store } = fakeRedis();
    const wrMod = await import('../../src/coaching/webhook-router.js');

    // Post-R-04 contract: even on an internal PromptAssemblyError,
    // runCoachingTurn finalizes E11 and routeInboundMessage resolves
    // with kind:'coaching'. The queue-processor should NOT dead-letter.
    vi.mocked(wrMod.routeInboundMessage).mockResolvedValue({
      kind: 'coaching',
      result: {
        endEvent: 'E11_ServiceUnavailable',
        responseText: "Something on my end isn't responding",
        practiceTag: null,
        levelTag: null,
        latencyMs: 100,
        sessionId: 'sess-r12',
        turnId: null,
      } as never,
    });

    await enqueueInbound(redis, buildItem('SMtest-r12-clean'));
    await processInboundFromQueue(deps(redis));

    expect(store.lists.get(INBOUND_QUEUE_KEY) ?? []).toHaveLength(0);
    expect(store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? []).toHaveLength(0);
  });

  it('routeInboundMessage throws TypeError → dead-letter still fires (negative control)', async () => {
    const { redis, store } = fakeRedis();
    const wrMod = await import('../../src/coaching/webhook-router.js');

    // Genuinely unexpected programming error must still land in
    // dead-letter — proves the catch at queue-processor.ts:165 is alive
    // for non-business-error cases.
    vi.mocked(wrMod.routeInboundMessage).mockImplementation(() => {
      throw new TypeError('totally unexpected');
    });

    await enqueueInbound(redis, buildItem('SMtest-r12-typeerror'));
    await processInboundFromQueue(deps(redis));

    const dl = store.lists.get(INBOUND_DEAD_LETTER_KEY) ?? [];
    expect(dl).toHaveLength(1);
  });
});
