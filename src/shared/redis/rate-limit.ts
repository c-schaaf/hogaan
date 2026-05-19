import { Ratelimit } from '@upstash/ratelimit';
import type { RedisBundle } from './client.js';

/**
 * Process #11 Step 6 token-bucket rate limiter.
 *
 * Three independent limits:
 *   - perSecond: outbound throughput cap.
 *   - perDay: rolling daily cap.
 *   - perUser: anti-spam cap (e.g. max N outbound to one user per hour).
 *
 * Critical-priority messages (crisis resources) bypass perUser but NOT perDay
 * — that escalation path is the caller's responsibility (Process #11 §6).
 *
 * Numerics live in config; this module exposes builders, not hard-coded values.
 */

export interface RateLimitConfig {
  perSecondLimit: number;
  perDayLimit: number;
  perUserPerHourLimit: number;
}

export interface RateLimiters {
  perSecond: Ratelimit;
  perDay: Ratelimit;
  perUser: Ratelimit;
}

export function buildRateLimiters(redis: RedisBundle, cfg: RateLimitConfig): RateLimiters {
  return {
    perSecond: new Ratelimit({
      redis: redis.client,
      limiter: Ratelimit.tokenBucket(cfg.perSecondLimit, '1 s', cfg.perSecondLimit),
      prefix: 'rl:per-sec',
      analytics: false,
    }),
    perDay: new Ratelimit({
      redis: redis.client,
      limiter: Ratelimit.fixedWindow(cfg.perDayLimit, '1 d'),
      prefix: 'rl:per-day',
      analytics: false,
    }),
    perUser: new Ratelimit({
      redis: redis.client,
      limiter: Ratelimit.slidingWindow(cfg.perUserPerHourLimit, '1 h'),
      prefix: 'rl:per-user',
      analytics: false,
    }),
  };
}

export type RateDecision =
  | { decision: 'PROCEED' }
  | { decision: 'QUEUE'; reason: 'per_second' | 'per_user'; retryAfterMs: number }
  | { decision: 'REJECT'; reason: 'per_day' };

export type Priority = 'Normal' | 'High' | 'Critical';

/**
 * Decision logic from Process #11 §6:
 *   - All limits OK → PROCEED
 *   - perSecond OR perUser hit + Normal/High → QUEUE (10s timer)
 *   - perUser hit + Critical → PROCEED (Critical bypasses per-user)
 *   - perDay hit + Normal/High → REJECT
 *   - perDay hit + Critical → REJECT (caller emits escalation event)
 */
export async function checkRateLimit(
  limiters: RateLimiters,
  globalKey: string,
  userKey: string,
  priority: Priority,
): Promise<RateDecision> {
  const [perSecond, perDay, perUser] = await Promise.all([
    limiters.perSecond.limit(globalKey),
    limiters.perDay.limit(globalKey),
    limiters.perUser.limit(userKey),
  ]);

  if (!perDay.success) {
    return { decision: 'REJECT', reason: 'per_day' };
  }

  if (!perUser.success && priority !== 'Critical') {
    const retryAfterMs = Math.max(0, perUser.reset - Date.now());
    return { decision: 'QUEUE', reason: 'per_user', retryAfterMs };
  }

  if (!perSecond.success) {
    const retryAfterMs = Math.max(0, perSecond.reset - Date.now());
    return { decision: 'QUEUE', reason: 'per_second', retryAfterMs };
  }

  return { decision: 'PROCEED' };
}
