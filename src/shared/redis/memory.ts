import type { RateLimiters } from './rate-limit.js';
import type { RedisBundle } from './client.js';

/**
 * In-process Redis stand-in for DEMO MODE ONLY (one process, no Upstash).
 * Implements the handful of commands Hogaan uses: get/set(nx,ex)/del,
 * sadd/sismember, zadd/zrange(byScore)/zrem/zcard. Not used in production.
 */
export function createMemoryRedis(): RedisBundle {
  const kv = new Map<string, { value: unknown; expiresAt: number | null }>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
  const live = (k: string) => {
    const e = kv.get(k);
    if (e === undefined) return undefined;
    if (e.expiresAt !== null && e.expiresAt < Date.now()) {
      kv.delete(k);
      return undefined;
    }
    return e;
  };
  const setOf = (k: string) => {
    let s = sets.get(k);
    if (s === undefined) sets.set(k, (s = new Set<string>()));
    return s;
  };
  const zOf = (k: string) => {
    let z = zsets.get(k);
    if (z === undefined) zsets.set(k, (z = new Map<string, number>()));
    return z;
  };
  const client = {
    get: (k: string) => Promise.resolve(live(k)?.value ?? null),
    set: (k: string, v: unknown, o?: { ex?: number; nx?: boolean }) => {
      if (o?.nx === true && live(k) !== undefined) return Promise.resolve(null);
      kv.set(k, { value: v, expiresAt: o?.ex !== undefined ? Date.now() + o.ex * 1000 : null });
      return Promise.resolve('OK');
    },
    del: (k: string) => Promise.resolve(kv.delete(k) ? 1 : 0),
    sadd: (k: string, m: string) => {
      const s = setOf(k);
      const had = s.has(m);
      s.add(m);
      return Promise.resolve(had ? 0 : 1);
    },
    sismember: (k: string, m: string) => Promise.resolve(setOf(k).has(m) ? 1 : 0),
    zadd: (k: string, e: { score: number; member: string }) => {
      zOf(k).set(e.member, e.score);
      return Promise.resolve(1);
    },
    zrange: (k: string, min: number, max: number, o?: { count?: number }) => {
      const out = [...zOf(k).entries()]
        .filter(([, s]) => s >= min && s <= max)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      return Promise.resolve(o?.count !== undefined ? out.slice(0, o.count) : out);
    },
    zrem: (k: string, ...ms: string[]) => {
      let n = 0;
      for (const m of ms) if (zOf(k).delete(m)) n++;
      return Promise.resolve(n);
    },
    zcard: (k: string) => Promise.resolve(zOf(k).size),
  };
  return {
    // The bundle is typed against @upstash/redis; this stand-in covers the
    // subset of its surface Hogaan calls.
    client: client as unknown as RedisBundle['client'],
    withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
  };
}

/** Rate limiters that always allow (demo mode only: one user, one process). */
export function createPassThroughRateLimiters(): RateLimiters {
  const allow = {
    limit: () =>
      Promise.resolve({
        success: true,
        limit: 1_000_000,
        remaining: 1_000_000,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      }),
  };
  return {
    perSecond: allow,
    perDay: allow,
    perUser: allow,
    perUserDay: allow,
  } as unknown as RateLimiters;
}
