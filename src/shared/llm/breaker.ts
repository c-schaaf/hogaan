import CircuitBreaker from 'opossum';
import { LlmAuthError, LlmCircuitOpenError, LlmContentFilterError } from './errors.js';

export interface BreakerOptions {
  /** Trip the circuit when this percent of calls fail in the rolling window. */
  errorThresholdPercentage: number;
  /** Rolling window in ms. */
  rollingCountTimeout: number;
  /** Cool-down after the circuit opens, before half-open trial calls. */
  resetTimeout: number;
  /** Per-call timeout enforced by the breaker. MUST be strictly greater than
   * the corresponding provider's per-call LLM timeout, otherwise the breaker
   * fires its own timeout error before the LLM timeout completes — which
   * counts every slow-but-eventually-successful call as a breaker failure
   * and risks opening the circuit on healthy-but-slow upstreams.
   *
   * Anthropic: PRIMARY_TIMEOUT_DEFAULT_MS = 12000 (src/shared/llm/chat.ts)
   *            REGEN_TIMEOUT_MS           = 10000 (src/quality-check/corrective.ts)
   *            CLASSIFIER_TIMEOUT_MS      =  4000 (src/quality-check/checks-llm.ts)
   *            → breaker timeout 14000 covers the largest (12000) + 2000 buffer.
   * Groq:      FALLBACK_TIMEOUT_DEFAULT_MS = 2000 (src/shared/llm/chat.ts)
   *            → breaker timeout 6000 covers it with margin.
   * Voyage:    embedding calls ~300ms p99 → 8000 is generous.
   */
  timeout: number;
  /** Minimum number of calls in the window before the percentage is evaluated. */
  volumeThreshold: number;
}

const DEFAULTS: Record<string, BreakerOptions> = {
  anthropic: {
    errorThresholdPercentage: 50,
    rollingCountTimeout: 60_000,
    resetTimeout: 15_000,
    // 14000ms — must be strictly greater than PRIMARY_TIMEOUT_DEFAULT_MS
    // (12000) plus buffer. Raised from 10_000 on 2026-05-08 (audit F-02);
    // 10_000 was set when PRIMARY_TIMEOUT_DEFAULT_MS was 5000, then drifted
    // out of step when the primary cap rose to 12000 in commit 6db2967.
    timeout: 14_000,
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

/** Test seam — exposes the per-provider defaults for invariant assertion
 *  against PRIMARY_TIMEOUT_DEFAULT_MS et al. */
export const _internal = { DEFAULTS };

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
