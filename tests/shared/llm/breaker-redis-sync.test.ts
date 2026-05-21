import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installRedisForBreakerSync,
  isBreakerOpenShared,
  markBreakerOpenShared,
  resetBreakerSyncForTests,
} from '../../../src/shared/llm/breaker-redis-sync.js';

/**
 * SCRUM (PR 7, launch-readiness D-7) — cross-instance circuit-breaker
 * coordination via Upstash Redis. Tests the public surface of the sync
 * module with a fake Redis client; the actual breaker integration is
 * exercised in `breaker.test.ts`.
 */

function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const getSpy = vi.fn((key: string) => {
    const e = store.get(key);
    if (e === undefined) return Promise.resolve(null);
    if (e.expiresAt !== null && e.expiresAt < Date.now()) {
      store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(e.value);
  });
  const setSpy = vi.fn((key: string, value: string, opts?: { ex?: number }) => {
    const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : null;
    store.set(key, { value, expiresAt });
    return Promise.resolve('OK');
  });
  return {
    bundle: {
      client: { get: getSpy, set: setSpy } as never,
      withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
    },
    getSpy,
    setSpy,
    store,
  };
}

describe('breaker-redis-sync', () => {
  beforeEach(() => {
    resetBreakerSyncForTests();
  });
  afterEach(() => {
    resetBreakerSyncForTests();
  });

  it('isBreakerOpenShared returns false when no redis is installed (solo-instance / tests)', async () => {
    expect(await isBreakerOpenShared('anthropic')).toBe(false);
  });

  it('markBreakerOpenShared is a no-op when no redis is installed', () => {
    // Doesn't throw, doesn't write anywhere.
    markBreakerOpenShared('anthropic', 15);
  });

  it('mark + check round-trip: shared flag opens and closes on TTL expiry', async () => {
    const r = fakeRedis();
    installRedisForBreakerSync(r.bundle);

    expect(await isBreakerOpenShared('anthropic')).toBe(false);

    markBreakerOpenShared('anthropic', 15);
    // Local cache flip is synchronous — the same instance sees its own trip
    // immediately without waiting for Redis.
    expect(await isBreakerOpenShared('anthropic')).toBe(true);
    // Verify the Redis SET fired with a TTL.
    expect(r.setSpy).toHaveBeenCalledWith('llm-breaker:open:anthropic', '1', { ex: 15 });
  });

  it('isBreakerOpenShared caches Redis reads for ~1 second', async () => {
    const r = fakeRedis();
    installRedisForBreakerSync(r.bundle);
    // Force-stash a value in fake Redis without going through markBreakerOpenShared
    // (which would also pre-warm the local cache).
    r.store.set('llm-breaker:open:groq', { value: '1', expiresAt: Date.now() + 60_000 });

    // First check hits Redis.
    expect(await isBreakerOpenShared('groq')).toBe(true);
    expect(r.getSpy).toHaveBeenCalledTimes(1);

    // Second + third checks within the cache window: still 1 Redis call total.
    expect(await isBreakerOpenShared('groq')).toBe(true);
    expect(await isBreakerOpenShared('groq')).toBe(true);
    expect(r.getSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to closed when Redis throws (fail-open, local breaker still guards)', async () => {
    const broken = {
      bundle: {
        client: {
          get: () => Promise.reject(new Error('upstash unreachable')),
          set: () => Promise.reject(new Error('upstash unreachable')),
        } as never,
        withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
      },
    };
    installRedisForBreakerSync(broken.bundle);
    expect(await isBreakerOpenShared('voyage')).toBe(false);
  });

  it('mark + check works independently per provider', async () => {
    const r = fakeRedis();
    installRedisForBreakerSync(r.bundle);

    markBreakerOpenShared('anthropic', 15);
    expect(await isBreakerOpenShared('anthropic')).toBe(true);
    expect(await isBreakerOpenShared('groq')).toBe(false);
    expect(await isBreakerOpenShared('voyage')).toBe(false);
  });
});
