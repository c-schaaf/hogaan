import type { RedisBundle } from './client.js';

const SUPPRESSION_KEY = 'suppression:set';
const BLOCK_KEY = 'block:set';

const DEFAULT_TIMEOUT_MS = 250;

export type SuppressionStatus = 'clean' | 'suppressed' | 'blocked';

/**
 * Process #11 Step 3 + Process #12 Step 3: parallel SISMEMBER queries against
 * the suppression and block sets. Fail-closed if either query fails — the
 * caller maps a thrown error to a "service unavailable" terminal end event.
 *
 * Both sets are keyed on the SHA-256 phone hash. Updates land via Onboarding
 * opt-out (Process #1 §10) and Incident Handling block-list operations (#18).
 */
export async function checkSuppression(
  redis: RedisBundle,
  phoneHash: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SuppressionStatus> {
  const [suppressed, blocked] = await Promise.all([
    redis.withTimeout('sismember:suppression', timeoutMs, () =>
      redis.client.sismember(SUPPRESSION_KEY, phoneHash),
    ),
    redis.withTimeout('sismember:block', timeoutMs, () =>
      redis.client.sismember(BLOCK_KEY, phoneHash),
    ),
  ]);
  if (blocked === 1) {
    return 'blocked';
  }
  if (suppressed === 1) {
    return 'suppressed';
  }
  return 'clean';
}

export async function addToSuppression(redis: RedisBundle, phoneHash: string): Promise<void> {
  await redis.withTimeout('sadd:suppression', 1000, () =>
    redis.client.sadd(SUPPRESSION_KEY, phoneHash),
  );
}

export async function addToBlocklist(redis: RedisBundle, phoneHash: string): Promise<void> {
  await redis.withTimeout('sadd:block', 1000, () => redis.client.sadd(BLOCK_KEY, phoneHash));
}

export async function removeFromSuppression(redis: RedisBundle, phoneHash: string): Promise<void> {
  await redis.withTimeout('srem:suppression', 1000, () =>
    redis.client.srem(SUPPRESSION_KEY, phoneHash),
  );
}
