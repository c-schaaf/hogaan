import type { SqlClient } from './client.js';

export class AdvisoryLockTimeoutError extends Error {
  constructor(key: string, timeoutMs: number) {
    super(`advisory_lock_timeout: key=${key} after ${timeoutMs}ms`);
    this.name = 'AdvisoryLockTimeoutError';
  }
}

/**
 * Run `fn` while holding a transaction-scoped advisory lock on `key`. The lock
 * auto-releases on COMMIT/ROLLBACK, so leaks are not possible.
 *
 * Spec: Process #12 Step 4 acquires with a 2s wait timeout; on timeout we
 * raise AdvisoryLockTimeoutError, which the caller maps to E8 (ConcurrentRequestRejected).
 *
 * Lock key is hashed server-side with `hashtextextended(text, 0::bigint)` so two
 * processes with the same string deterministically agree on the int64 lock id.
 */
export async function withAdvisoryLock<T>(
  sql: SqlClient,
  key: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = (await sql.begin(async (txn) => {
      await txn.unsafe(`SET LOCAL lock_timeout = '${Math.max(1, Math.trunc(timeoutMs))}ms'`);
      await txn`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
      return fn();
    })) as T;
    return result;
  } catch (err) {
    if (isPgLockTimeout(err)) {
      throw new AdvisoryLockTimeoutError(key, timeoutMs);
    }
    throw err;
  }
}

function isPgLockTimeout(err: unknown): boolean {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  // 55P03 = lock_not_available, raised when lock_timeout fires
  return code === '55P03';
}
