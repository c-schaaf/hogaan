import type { AppConfig } from '../../../src/shared/secrets/config.js';
import type { RedisBundle } from '../../../src/shared/redis/client.js';
import type { RateLimiters } from '../../../src/shared/redis/rate-limit.js';
import type { TraceEmitter } from '../../../src/shared/trace/index.js';

/**
 * Minimal fakes for Phase 10 BPMN integration tests. Each fake satisfies
 * the actual call shape used by the orchestrators under test — not the
 * full interface — so a future shape change forces a test update at the
 * fake site, not a downstream cascade.
 *
 * Configurable via constructor options. No real network or DB I/O.
 */

export function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'error',
    publicBaseUrl: 'http://localhost:3000',
    databaseUrl: 'postgres://test',
    redisUrl: undefined,
    upstashRedisRestUrl: undefined,
    upstashRedisRestToken: undefined,
    encryptionKeyBase64: 'KSwSEuoDGo+/FUWKtGzMWcMYAPqSA/9+tcnDpY5EqaI=', // 32 bytes
    jwtSecretBase64: 'a'.repeat(64),
    jwtIssuer: 'hogaan-test',
    jwtAudience: 'aud-test',
    anthropicApiKey: 'sk-test',
    groqApiKey: 'gsk-test',
    voyageApiKey: 'vk-test',
    sentryDsn: undefined,
    axiomToken: undefined,
    axiomDataset: undefined,
    betterstackHeartbeatUrl: undefined,
    resendApiKey: undefined,
    resendFromEmail: undefined,
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    supabaseJwtSecret: undefined,
    ...overrides,
  };
}

/**
 * In-memory Redis fake covering the methods the orchestrators touch:
 *   - sismember / sadd  (suppression + revocation)
 *   - get / set         (idempotency)
 *   - withTimeout       (the bundle's pass-through wrapper)
 */
export interface FakeRedis extends RedisBundle {
  /** Test seam — pre-load suppression hashes. */
  suppress(hash: string): void;
  block(hash: string): void;
  /** Test seam — read idempotency value. */
  getKey(key: string): unknown;
  /** Test seam — clear all in-memory state. */
  reset(): void;
}

export function fakeRedis(): FakeRedis {
  const sets = new Map<string, Set<string>>();
  const kv = new Map<string, { value: unknown; expiresAt: number | null }>();

  function getSet(key: string): Set<string> {
    let s = sets.get(key);
    if (s === undefined) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  }

  const client = {
    sismember: (key: string, member: string): Promise<number> =>
      Promise.resolve(getSet(key).has(member) ? 1 : 0),
    sadd: (key: string, member: string): Promise<number> => {
      const s = getSet(key);
      const had = s.has(member);
      s.add(member);
      return Promise.resolve(had ? 0 : 1);
    },
    get: (key: string): Promise<unknown> => {
      const entry = kv.get(key);
      if (entry === undefined) {
        return Promise.resolve(null);
      }
      if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
        kv.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value);
    },
    set: (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown> => {
      if (opts?.nx === true && kv.has(key)) {
        const existing = kv.get(key);
        if (
          existing !== undefined &&
          (existing.expiresAt === null || existing.expiresAt >= Date.now())
        ) {
          return Promise.resolve(null);
        }
      }
      const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : null;
      kv.set(key, { value, expiresAt });
      return Promise.resolve('OK');
    },
    del: (key: string): Promise<number> => Promise.resolve(kv.delete(key) ? 1 : 0),
  };

  const stub = {
    client,
    withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>): Promise<T> => fn(),
    suppress(hash: string): void {
      getSet('suppression:set').add(hash);
    },
    block(hash: string): void {
      getSet('block:set').add(hash);
    },
    getKey(key: string): unknown {
      return kv.get(key)?.value;
    },
    reset(): void {
      sets.clear();
      kv.clear();
    },
  };
  return stub as unknown as FakeRedis;
}

export function fakeRateLimiters(): RateLimiters {
  // Process #11 rate limiter has three internal limiters; we substitute a
  // pass-through so PROCEED is always returned. Tests targeting rate-limit
  // events would override this with a REJECT result by replacing this.
  const passThrough = {
    limit: () =>
      Promise.resolve({
        success: true,
        limit: 1000,
        remaining: 999,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      }),
  };
  return {
    perSecond: passThrough,
    perDay: passThrough,
    perUser: passThrough,
  } as unknown as RateLimiters;
}

export function fakeTraceEmitter(): TraceEmitter {
  return {
    emit: () => undefined,
    flush: () => Promise.resolve(),
  };
}
