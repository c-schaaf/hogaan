import type { RedisBundle } from '../redis/client.js';

/**
 * SCRUM (PR 7, launch-readiness D-7) — multi-instance circuit-breaker
 * coordination via Upstash Redis.
 *
 * Pre-fix, each Render instance had its own in-process opossum breaker.
 * On a vendor outage, instance A's breaker would trip after observing N
 * failures, but instance B was oblivious and kept hammering the dead
 * upstream — wasting time, money, and the user's patience. The audit
 * required cross-instance coordination once we deployed ≥2 instances.
 *
 * Design choice: rather than rip out opossum, we add a thin Redis-backed
 * "shared open flag" alongside the local opossum. When ANY instance's
 * local opossum opens, it sets a Redis key with TTL = resetTimeout. Every
 * instance — before firing the local breaker — checks the shared flag
 * (with a 1-second in-process cache so the hot path doesn't take a Redis
 * round-trip on every call). If the flag is set, the call short-circuits
 * with the same `LlmCircuitOpenError` opossum would have thrown locally.
 *
 * Convergence: any instance's trip is visible to all others within ~1
 * second. Cost on the hot path: ~1 Redis GET per provider per second per
 * instance, regardless of call volume.
 *
 * Fail-open semantics: if Redis is unreachable, we degrade gracefully and
 * fall back to local-only breaker state. The audit's intent was "cross-
 * instance coordination as an upgrade," not "Redis becomes a SPOF for
 * every LLM call."
 */

export type BreakerProvider = 'anthropic' | 'groq' | 'voyage';

let installedRedis: RedisBundle | undefined;

/**
 * Wire the Redis bundle in once at startup. Called from `src/web-api/setup.ts`.
 * If never called (e.g. tests or solo-instance deploys), the breaker-sync
 * functions all no-op safely.
 */
export function installRedisForBreakerSync(redis: RedisBundle): void {
  installedRedis = redis;
}

/** Test-only seam. */
export function resetBreakerSyncForTests(): void {
  installedRedis = undefined;
  for (const k of Object.keys(localCache)) delete localCache[k];
}

const REDIS_KEY = (p: BreakerProvider): string => `llm-breaker:open:${p}`;
const LOCAL_CACHE_TTL_MS = 1_000;

interface CacheEntry {
  open: boolean;
  expiresAt: number;
}
const localCache: Record<string, CacheEntry | undefined> = {};

/**
 * Mark the shared breaker open. Called from the local opossum's `open`
 * event handler. Fire-and-forget — if Redis is down we don't block the
 * caller, we just lose cross-instance coordination for this trip.
 *
 * `ttlSec` should equal the provider's `resetTimeout` so the shared flag
 * naturally expires when local opossums would attempt half-open trials.
 */
export function markBreakerOpenShared(provider: BreakerProvider, ttlSec: number): void {
  if (installedRedis === undefined) return;
  // Local cache also flips immediately so this same process sees its own
  // trip on the next call without waiting for Redis to round-trip.
  localCache[provider] = { open: true, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS };
  const setPromise = installedRedis.client.set(REDIS_KEY(provider), '1', { ex: ttlSec });
  // Defensive: catch any Promise rejection so we don't trigger an
  // unhandledRejection on an Upstash hiccup.
  Promise.resolve(setPromise).catch(() => undefined);
}

/**
 * Check the shared breaker open flag with a 1-second in-process cache.
 * Returns `false` (closed) on any Redis error so we degrade gracefully —
 * the local opossum is still the load-bearing guard.
 */
export async function isBreakerOpenShared(provider: BreakerProvider): Promise<boolean> {
  if (installedRedis === undefined) return false;
  const now = Date.now();
  const cached = localCache[provider];
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.open;
  }
  let open = false;
  try {
    const val = await installedRedis.client.get(REDIS_KEY(provider));
    open = val !== null && val !== undefined;
  } catch {
    // Redis unreachable — fall back to local-only state. Don't trip the
    // breaker just because we can't read Redis.
    open = false;
  }
  localCache[provider] = { open, expiresAt: now + LOCAL_CACHE_TTL_MS };
  return open;
}
