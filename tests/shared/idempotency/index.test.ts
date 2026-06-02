import { describe, expect, it } from 'vitest';
import {
  acquire,
  IdempotencyStoreUnavailableError,
  lookup,
  markFailed,
  markSent,
  type IdempotencyRecord,
} from '../../../src/shared/idempotency/index.js';
import type { RedisBundle } from '../../../src/shared/redis/client.js';

type SetOpts = { ex?: number; nx?: boolean };

interface FakeRedis extends RedisBundle {
  raw(key: string): string | undefined;
}

function fakeRedis(overrides?: { setThrows?: Error; getThrows?: Error }): FakeRedis {
  const store = new Map<string, string>();

  const client = {
    get: <T = string>(key: string): Promise<T | null> => {
      if (overrides?.getThrows !== undefined) {
        return Promise.reject(overrides.getThrows);
      }
      const v = store.get(key);
      return Promise.resolve(v === undefined ? null : (v as unknown as T));
    },
    set: (key: string, value: unknown, opts?: SetOpts): Promise<string | null> => {
      if (overrides?.setThrows !== undefined) {
        return Promise.reject(overrides.setThrows);
      }
      if (opts?.nx === true && store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, String(value));
      return Promise.resolve('OK');
    },
  };

  const bundle: FakeRedis = {
    client: client as unknown as RedisBundle['client'],
    withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>): Promise<T> => fn(),
    raw(key: string): string | undefined {
      return store.get(key);
    },
  };
  return bundle;
}

const CORR_ID = 'corr-001';
const OWNER_A = 'worker-a';
const OWNER_B = 'worker-b';

describe('idempotency', () => {
  it('acquire on absent key returns acquired:true', async () => {
    const redis = fakeRedis();

    const result = await acquire(redis, CORR_ID, OWNER_A);

    expect(result.acquired).toBe(true);
    expect(result.existing).toBeUndefined();
    const stored = redis.raw(`idem:${CORR_ID}`);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored as string) as IdempotencyRecord;
    expect(parsed.state).toBe('dispatching');
    expect(parsed.ownerId).toBe(OWNER_A);
    expect(typeof parsed.acquiredAt).toBe('string');
  });

  it('concurrent second acquire returns acquired:false with holder record', async () => {
    const redis = fakeRedis();

    const first = await acquire(redis, CORR_ID, OWNER_A);
    expect(first.acquired).toBe(true);

    const second = await acquire(redis, CORR_ID, OWNER_B);

    expect(second.acquired).toBe(false);
    expect(second.existing).toBeDefined();
    expect(second.existing?.state).toBe('dispatching');
    expect(second.existing?.ownerId).toBe(OWNER_A);
  });

  it('markSent transitions an acquired key to state="sent" and stores receiptId', async () => {
    const redis = fakeRedis();
    await acquire(redis, CORR_ID, OWNER_A);

    await markSent(redis, CORR_ID, OWNER_A, 'provider-msg-42', { template: 'verification' });

    const stored = redis.raw(`idem:${CORR_ID}`);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored as string) as IdempotencyRecord;
    expect(parsed.state).toBe('sent');
    expect(parsed.ownerId).toBe(OWNER_A);
    expect(parsed.receiptId).toBe('provider-msg-42');
    expect(parsed.payload).toEqual({ template: 'verification' });
    expect(typeof parsed.finalizedAt).toBe('string');
  });

  it('markFailed transitions an acquired key to state="failed"', async () => {
    const redis = fakeRedis();
    await acquire(redis, CORR_ID, OWNER_A);

    await markFailed(redis, CORR_ID, OWNER_A);

    const stored = redis.raw(`idem:${CORR_ID}`);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored as string) as IdempotencyRecord;
    expect(parsed.state).toBe('failed');
    expect(parsed.ownerId).toBe(OWNER_A);
    expect(typeof parsed.finalizedAt).toBe('string');
  });

  it('acquire throws IdempotencyStoreUnavailableError when Redis SET throws (fail-CLOSED)', async () => {
    const redis = fakeRedis({ setThrows: new Error('redis-down') });

    await expect(acquire(redis, CORR_ID, OWNER_A)).rejects.toBeInstanceOf(
      IdempotencyStoreUnavailableError,
    );
    await expect(acquire(redis, CORR_ID, OWNER_A)).rejects.toMatchObject({
      message: 'idempotency_store_unavailable: acquire',
    });
  });

  it('lookup on absent key returns state:"absent" with no record', async () => {
    const redis = fakeRedis();

    const result = await lookup(redis, CORR_ID);

    expect(result.state).toBe('absent');
    expect(result.record).toBeUndefined();
  });

  it('lookup after acquire returns state:"dispatching" with the holder record', async () => {
    const redis = fakeRedis();
    await acquire(redis, CORR_ID, OWNER_A);

    const result = await lookup(redis, CORR_ID);

    expect(result.state).toBe('dispatching');
    expect(result.record?.ownerId).toBe(OWNER_A);
  });

  it('lookup throws IdempotencyStoreUnavailableError when Redis GET throws (fail-CLOSED)', async () => {
    const redis = fakeRedis({ getThrows: new Error('redis-network') });

    await expect(lookup(redis, CORR_ID)).rejects.toBeInstanceOf(IdempotencyStoreUnavailableError);
  });

  it('markSent throws IdempotencyStoreUnavailableError when Redis SET throws', async () => {
    const redis = fakeRedis({ setThrows: new Error('redis-down') });

    await expect(markSent(redis, CORR_ID, OWNER_A, 'rid')).rejects.toBeInstanceOf(
      IdempotencyStoreUnavailableError,
    );
  });

  it('markFailed throws IdempotencyStoreUnavailableError when Redis SET throws', async () => {
    const redis = fakeRedis({ setThrows: new Error('redis-down') });

    await expect(markFailed(redis, CORR_ID, OWNER_A)).rejects.toBeInstanceOf(
      IdempotencyStoreUnavailableError,
    );
  });
});
