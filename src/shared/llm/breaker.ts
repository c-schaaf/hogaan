import CircuitBreaker from 'opossum';
import { LlmAuthError, LlmCircuitOpenError, LlmContentFilterError } from './errors.js';

export interface BreakerOptions {
  /** Trip the circuit when this percent of calls fail in the rolling window. */
  errorThresholdPercentage: number;
  /** Rolling window in ms. */
  rollingCountTimeout: number;
  /** Cool-down after the circuit opens, before half-open trial calls. */
  resetTimeout: number;
  /** Per-call timeout enforced by the breaker. Set higher than the LLM timeout
   * to avoid double-counting timeouts. */
  timeout: number;
  /** Minimum number of calls in the window before the percentage is evaluated. */
  volumeThreshold: number;
}

const DEFAULTS: Record<string, BreakerOptions> = {
  anthropic: {
    errorThresholdPercentage: 50,
    rollingCountTimeout: 60_000,
    resetTimeout: 15_000,
    timeout: 10_000,
    volumeThreshold: 10,
  },
  groq: {
    errorThresholdPercentage: 50,
    rollingCountTimeout: 60_000,
    resetTimeout: 10_000,
    timeout: 6_000,
    volumeThreshold: 10,
  },
  voyage: {
    errorThresholdPercentage: 50,
    rollingCountTimeout: 60_000,
    resetTimeout: 15_000,
    timeout: 8_000,
    volumeThreshold: 10,
  },
};

export type Provider = 'anthropic' | 'groq' | 'voyage';

type BreakerFn<TArgs extends unknown[], T> = (...args: TArgs) => Promise<T>;

/**
 * Wrap a provider call in a circuit breaker. After repeated failures the
 * breaker opens, and subsequent calls throw LlmCircuitOpenError immediately
 * — Process #2 dispatch treats this the same as a timeout (fall back to
 * fast model).
 *
 * Auth failures and content-filter errors are NOT counted as breaker errors;
 * they're caller-side / input-side, not provider-health signals.
 */
export function buildBreaker<TArgs extends unknown[], T>(
  provider: Provider,
  fn: BreakerFn<TArgs, T>,
  opts: Partial<BreakerOptions> = {},
): (...args: TArgs) => Promise<T> {
  const config = { ...(DEFAULTS[provider] as BreakerOptions), ...opts };
  const breaker = new CircuitBreaker(fn, {
    timeout: config.timeout,
    errorThresholdPercentage: config.errorThresholdPercentage,
    rollingCountTimeout: config.rollingCountTimeout,
    resetTimeout: config.resetTimeout,
    volumeThreshold: config.volumeThreshold,
    name: `llm-${provider}`,
    // errorFilter returns true for errors that should NOT trip the breaker.
    // Auth + content-filter are caller/input issues, not provider-health
    // signals — exclude them. Timeouts, rate-limits, 5xx, and transients all
    // count toward the failure rate.
    errorFilter: (err: Error) =>
      err instanceof LlmAuthError || err instanceof LlmContentFilterError,
  });

  return (...args: TArgs) => {
    if (breaker.opened) {
      return Promise.reject(new LlmCircuitOpenError(provider));
    }
    return breaker.fire(...args);
  };
}
