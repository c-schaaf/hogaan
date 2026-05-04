import type { RedisBundle } from './client.js';

/**
 * Sorted-set delivery queue. Used by Process #11 §6 to defer messages that hit
 * the per-second or per-user rate limit. Score = unix-ms timestamp at which
 * the item becomes ready for redelivery; member = correlationId.
 *
 * Consumers `popDue()` periodically; non-due items remain in the set. Bounded
 * depth: caller must check `size()` and reject inserts past a depth ceiling
 * to prevent unbounded growth (PRD plan open question §32).
 */

export interface QueueOptions {
  key: string;
}

export async function enqueue(
  redis: RedisBundle,
  opts: QueueOptions,
  member: string,
  readyAtMs: number,
): Promise<void> {
  await redis.withTimeout('zadd:queue', 500, () =>
    redis.client.zadd(opts.key, { score: readyAtMs, member }),
  );
}

export async function popDue(
  redis: RedisBundle,
  opts: QueueOptions,
  nowMs: number,
  limit: number,
): Promise<string[]> {
  const due = await redis.withTimeout('zrange:queue', 500, () =>
    redis.client.zrange(opts.key, 0, nowMs, { byScore: true, offset: 0, count: limit }),
  );
  if (!Array.isArray(due) || due.length === 0) {
    return [];
  }
  await redis.withTimeout('zrem:queue', 500, () =>
    redis.client.zrem(opts.key, ...(due as string[])),
  );
  return due as string[];
}

export async function size(redis: RedisBundle, opts: QueueOptions): Promise<number> {
  const n = await redis.withTimeout('zcard:queue', 500, () => redis.client.zcard(opts.key));
  return typeof n === 'number' ? n : 0;
}
