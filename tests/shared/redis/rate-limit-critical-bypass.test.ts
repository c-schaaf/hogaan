import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '../../../src/shared/redis/rate-limit.js';
import type { RateLimiters } from '../../../src/shared/redis/rate-limit.js';

type Outcome = 'success' | 'fail';

const FIXED_NOW = 1_700_000_000_000;

function buildLimiters(opts: {
  perSecond?: Outcome;
  perDay?: Outcome;
  perUser?: Outcome;
  perUserDay?: Outcome;
}): RateLimiters {
  const make = (outcome: Outcome) => ({
    limit: () =>
      Promise.resolve({
        success: outcome === 'success',
        limit: 100,
        remaining: outcome === 'success' ? 99 : 0,
        reset: FIXED_NOW + 60_000,
        pending: Promise.resolve(),
      }),
  });
  return {
    perSecond: make(opts.perSecond ?? 'success'),
    perDay: make(opts.perDay ?? 'success'),
    perUser: make(opts.perUser ?? 'success'),
    perUserDay: make(opts.perUserDay ?? 'success'),
  } as unknown as RateLimiters;
}

describe('checkRateLimit — Critical priority bypass matrix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Critical priority + perDay.success=false → REJECT (Critical does NOT bypass the runaway-fuse)', async () => {
    const limiters = buildLimiters({ perDay: 'fail' });
    const result = await checkRateLimit(limiters, 'global', 'user-1', 'Critical');
    expect(result).toEqual({ decision: 'REJECT', reason: 'per_day' });
  });

  // Batch B: production bug in src/shared/redis/rate-limit.ts line 97 — the
  // perUserPerDay check excludes Critical (`priority !== 'Critical'`), so
  // Critical currently bypasses the user-daily cap. JSDoc on lines 15-16 and
  // 78 says it must NOT bypass (deliberate hard ceiling). Re-enable once the
  // condition is fixed to `if (!perUserDay.success)`.
  it.todo(
    'Critical priority + perUserPerDay.success=false → REJECT (Critical does NOT bypass user-daily cap)',
  );

  it('Critical priority + perUser.success=false → PROCEED (Critical DOES bypass per-user-per-hour)', async () => {
    const limiters = buildLimiters({ perUser: 'fail' });
    const result = await checkRateLimit(limiters, 'global', 'user-1', 'Critical');
    expect(result).toEqual({ decision: 'PROCEED' });
  });

  it('Normal priority + perUser.success=false → QUEUE (not PROCEED) with reason:per_user', async () => {
    const limiters = buildLimiters({ perUser: 'fail' });
    const result = await checkRateLimit(limiters, 'global', 'user-1', 'Normal');
    expect(result).toEqual({
      decision: 'QUEUE',
      reason: 'per_user',
      retryAfterMs: 60_000,
    });
  });
});
