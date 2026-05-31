import { Ratelimit } from '@upstash/ratelimit';
import type { RedisBundle } from './client.js';

/**
 * Token-bucket rate limiter. Four independent limits:
 *   - perSecond: global outbound throughput cap (spike protection).
 *   - perDay: GLOBAL rolling daily cap (the "runaway fuse" — protects against
 *     cost-DoS from a code bug or attacker; set far above any realistic
 *     user-experience ceiling so it's invisible at normal scale).
 *   - perUserPerHour: per-user anti-spam cap (catches automation in-hour).
 *   - perUserPerDay: per-user daily cap (SCRUM-F2 — fixes the prior bug where
 *     the global perDay also served as the per-user cap, so one user could
 *     starve every other paying customer for the day).
 *
 * Critical-priority messages (crisis resources) bypass perUser caps but NOT
 * perDay — that escalation path is the caller's responsibility.
 *
 * Numerics live in config; this module exposes builders, not hard-coded values.
 */

export interface RateLimitConfig {
  perSecondLimit: number;
  perDayLimit: number;
  perUserPerHourLimit: number;
  perUserPerDayLimit: number;
}

export interface RateLimiters {
  perSecond: Ratelimit;
  perDay: Ratelimit;
  perUser: Ratelimit;
  perUserDay: Ratelimit;
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
    perUserDay: new Ratelimit({
      redis: redis.client,
      limiter: Ratelimit.fixedWindow(cfg.perUserPerDayLimit, '1 d'),
      prefix: 'rl:per-user-day',
      analytics: false,
    }),
  };
}

export type RateDecision =
  | { decision: 'PROCEED' }
  | { decision: 'QUEUE'; reason: 'per_second' | 'per_user'; retryAfterMs: number }
  | { decision: 'REJECT'; reason: 'per_day' | 'per_user_daily' };

export type Priority = 'Normal' | 'High' | 'Critical';

/**
 * Decision logic:
 *   - All limits OK → PROCEED
 *   - perUserPerDay hit + Normal/High → REJECT (user has hit their daily cap)
 *   - perDay hit (global runaway fuse) → REJECT (catastrophic blast-radius)
 *   - perSecond OR perUser hit + Normal/High → QUEUE (transient, will recover)
 *   - perUser hit + Critical → bypasses to PROCEED
 *   - Critical never bypasses perDay or perUserPerDay (deliberate hard ceiling)
 *
 * Ordering of REJECT reasons matters for diagnostics: per_user_daily is the
 * one a real user will encounter; per_day is the runaway-fuse and should be
 * vanishingly rare in production.
 */
export async function checkRateLimit(
  limiters: RateLimiters,
  globalKey: string,
  userKey: string,
  priority: Priority,
): Promise<RateDecision> {
  const [perSecond, perDay, perUser, perUserDay] = await Promise.all([
    limiters.perSecond.limit(globalKey),
    limiters.perDay.limit(globalKey),
    limiters.perUser.limit(userKey),
    limiters.perUserDay.limit(userKey),
  ]);

  if (!perUserDay.success && priority !== 'Critical') {
    return { decision: 'REJECT', reason: 'per_user_daily' };
  }

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
