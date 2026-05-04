import {
  LlmAuthError,
  LlmContentFilterError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTimeoutError,
  LlmTransientError,
} from './errors.js';

export interface RetryOptions {
  maxAttempts: number;
  /** Base delay in ms. Each retry waits baseDelayMs * 2^(attempt-1) plus jitter. */
  baseDelayMs: number;
  /** Cap on the per-retry delay to keep tail latency bounded. */
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
};

/**
 * Retry with exponential backoff + full jitter. Retries only on transient
 * errors (LlmTransientError); rate-limit, content-filter, auth, timeout, and
 * service-unavailable all bubble immediately so the caller can dispatch.
 *
 * Process #2 Step 9 explicitly does NOT retry the primary model on timeout —
 * it falls back to the fast model. So timeouts are surfaced, not retried.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...opts };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) {
        throw err;
      }
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.floor(Math.random() * exp);
      await sleep(jittered);
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof LlmTransientError) {
    return true;
  }
  // These are explicitly NOT retried at this layer; caller dispatches:
  if (err instanceof LlmTimeoutError) {
    return false;
  }
  if (err instanceof LlmRateLimitError) {
    return false;
  }
  if (err instanceof LlmContentFilterError) {
    return false;
  }
  if (err instanceof LlmAuthError) {
    return false;
  }
  if (err instanceof LlmServiceUnavailableError) {
    return false;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') {
      t.unref();
    }
  });
}

/** Race an LLM call against a deadline. Throws LlmTimeoutError if the deadline fires. */
export function withTimeout<T>(
  provider: 'anthropic' | 'groq' | 'voyage',
  ms: number,
  fn: () => Promise<T>,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new LlmTimeoutError(provider, ms)), ms);
      if (typeof t.unref === 'function') {
        t.unref();
      }
    }),
  ]);
}
