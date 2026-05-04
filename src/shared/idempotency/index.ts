import type { RedisBundle } from '../redis/client.js';

/**
 * Generic correlation-key idempotency. Process #11 wires this for outbound
 * WhatsApp dispatch (Steps 2 + 7), but the helper is intentionally agnostic
 * so other modules (sponsor portal, daily prompt scheduler) can reuse it.
 *
 * State machine — every key lives in Redis with a 24h TTL:
 *   - absent       : never seen; first-time dispatch.
 *   - dispatching  : another worker has acquired the slot; ours is a duplicate.
 *   - sent         : already dispatched; return cached receipt.
 *   - failed       : terminal failure; caller decides whether to retry.
 *
 * Concurrency: `acquire()` is atomic SETNX-style — only one worker ever sees
 * `acquired=true` for a given key. The other workers see `state='dispatching'`
 * with the holder's processId, and the caller decides whether to wait, return
 * a "still processing" signal, or fail.
 */

const TTL_SECONDS_DEFAULT = 24 * 60 * 60;
const KEY_PREFIX = 'idem:';
/**
 * Per-op timeout. Bumped from 250–500ms after seeing 300–700ms steady-state
 * latency from regions farther from the Upstash node. 1500ms still leaves
 * ~3.5s of the 6s turn budget for the LLM + delivery, and the alternative
 * (false-positive E15 incidents) is worse than slightly slower turns.
 */
const HOT_PATH_TIMEOUT_MS = 1500;

export type IdempotencyState = 'absent' | 'dispatching' | 'sent' | 'failed';

export interface IdempotencyRecord {
  state: 'dispatching' | 'sent' | 'failed';
  /** Identifier of the worker/process that owns this key. */
  ownerId: string;
  /** Provider-side receipt id (e.g. Twilio waMessageId) once state='sent'. */
  receiptId?: string;
  /** Free-form payload for callers that need to remember the dispatched body. */
  payload?: unknown;
  /** When the key was first acquired. */
  acquiredAt: string;
  /** When state transitioned to 'sent' or 'failed'. */
  finalizedAt?: string;
}

export interface AcquireResult {
  acquired: boolean;
  /** Present when acquired=false: why we couldn't acquire. */
  existing?: IdempotencyRecord;
}

export class IdempotencyStoreUnavailableError extends Error {
  constructor(op: string, cause?: unknown) {
    super(`idempotency_store_unavailable: ${op}`);
    this.name = 'IdempotencyStoreUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function k(correlationId: string): string {
  return `${KEY_PREFIX}${correlationId}`;
}

/**
 * Process #11 Step 2 (lookup) — non-blocking read of any prior state. Returns
 * `absent` for a clean key, otherwise the recorded state.
 */
export async function lookup(
  redis: RedisBundle,
  correlationId: string,
): Promise<{ state: IdempotencyState; record?: IdempotencyRecord }> {
  try {
    const raw = await redis.withTimeout('idem:lookup', HOT_PATH_TIMEOUT_MS, () =>
      redis.client.get<string>(k(correlationId)),
    );
    if (raw === null || raw === undefined) {
      return { state: 'absent' };
    }
    const record = parseRecord(raw);
    return { state: record.state, record };
  } catch (err) {
    throw new IdempotencyStoreUnavailableError('lookup', err);
  }
}

/**
 * Process #11 Step 7 (atomic create) — fail-closed. Acquires the slot via
 * SET NX EX. Returns acquired=false if a concurrent worker already holds it.
 *
 * On Redis failure, throws — Process #11 maps this to E15 IdempotencyStoreFailure
 * and refuses to dispatch.
 */
export async function acquire(
  redis: RedisBundle,
  correlationId: string,
  ownerId: string,
  ttlSeconds: number = TTL_SECONDS_DEFAULT,
): Promise<AcquireResult> {
  const record: IdempotencyRecord = {
    state: 'dispatching',
    ownerId,
    acquiredAt: new Date().toISOString(),
  };

  let setRes: string | null;
  try {
    setRes = await redis.withTimeout('idem:acquire', HOT_PATH_TIMEOUT_MS, () =>
      redis.client.set(k(correlationId), serialize(record), { ex: ttlSeconds, nx: true }),
    );
  } catch (err) {
    throw new IdempotencyStoreUnavailableError('acquire', err);
  }

  if (setRes === 'OK') {
    return { acquired: true };
  }
  // Lost the race — read what's there so the caller can decide.
  const { record: existing } = await lookup(redis, correlationId);
  return { acquired: false, ...(existing !== undefined ? { existing } : {}) };
}

/**
 * Process #11 Step 9: dispatch succeeded; record the provider receipt.
 * Idempotent — repeated calls with the same `receiptId` are no-ops.
 */
export async function markSent(
  redis: RedisBundle,
  correlationId: string,
  ownerId: string,
  receiptId: string,
  payload?: unknown,
): Promise<void> {
  const updated: IdempotencyRecord = {
    state: 'sent',
    ownerId,
    receiptId,
    payload,
    acquiredAt: new Date().toISOString(),
    finalizedAt: new Date().toISOString(),
  };
  try {
    await redis.withTimeout('idem:mark-sent', HOT_PATH_TIMEOUT_MS, () =>
      redis.client.set(k(correlationId), serialize(updated), { ex: TTL_SECONDS_DEFAULT }),
    );
  } catch (err) {
    // Process #11 §9 says: "Failures logged but do NOT unwind; message already
    // sent." Caller logs incident; we do not throw.
    throw new IdempotencyStoreUnavailableError('mark-sent', err);
  }
}

export async function markFailed(
  redis: RedisBundle,
  correlationId: string,
  ownerId: string,
): Promise<void> {
  const updated: IdempotencyRecord = {
    state: 'failed',
    ownerId,
    acquiredAt: new Date().toISOString(),
    finalizedAt: new Date().toISOString(),
  };
  try {
    await redis.withTimeout('idem:mark-failed', HOT_PATH_TIMEOUT_MS, () =>
      redis.client.set(k(correlationId), serialize(updated), { ex: TTL_SECONDS_DEFAULT }),
    );
  } catch (err) {
    throw new IdempotencyStoreUnavailableError('mark-failed', err);
  }
}

function serialize(r: IdempotencyRecord): string {
  return JSON.stringify(r);
}

function parseRecord(raw: string): IdempotencyRecord {
  return JSON.parse(raw) as IdempotencyRecord;
}
