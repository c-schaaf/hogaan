import { Redis } from '@upstash/redis';
import { type AppConfig, ConfigError, requireConfig } from '../secrets/config.js';

export class RedisTimeoutError extends Error {
  constructor(op: string, ms: number) {
    super(`redis_timeout: ${op} after ${ms}ms`);
    this.name = 'RedisTimeoutError';
  }
}

export interface RedisBundle {
  client: Redis;
  withTimeout<T>(op: string, ms: number, fn: () => Promise<T>): Promise<T>;
}

let cached: RedisBundle | undefined;

/**
 * Singleton @upstash/redis (REST) client.
 *
 * REST has higher per-call latency than TCP but is serverless-friendly and
 * works through firewalls. Upstash recommends REST for short-lived workloads;
 * for our long-running Render service, latency matters. If Phase 7 latency
 * audits show this is the bottleneck, swap for ioredis behind the same
 * interface.
 */
export function getRedis(config: AppConfig): RedisBundle {
  if (cached) {
    return cached;
  }

  const url = requireConfig(config, 'upstashRedisRestUrl');
  const token = requireConfig(config, 'upstashRedisRestToken');

  if (!url.startsWith('https://')) {
    throw new ConfigError(`UPSTASH_REDIS_REST_URL must be https://, got: ${url.slice(0, 30)}...`);
  }

  const client = new Redis({ url, token });

  cached = {
    client,
    withTimeout: <T>(op: string, ms: number, fn: () => Promise<T>): Promise<T> =>
      Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new RedisTimeoutError(op, ms)), ms);
          // unref so a hung request doesn't keep the process alive
          if (typeof t.unref === 'function') {
            t.unref();
          }
        }),
      ]),
  };

  return cached;
}

/** Test/teardown only. */
export function resetRedisForTests(): void {
  cached = undefined;
}
