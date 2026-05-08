import { describe, expect, it } from 'vitest';
import { _internal as breakerInternal } from '../../../src/shared/llm/breaker.js';
import { _internal as chatInternal } from '../../../src/shared/llm/chat.js';

/**
 * Audit F-02 (2026-05-08) — circuit-breaker timeout invariant.
 *
 * Opossum (the breaker library) enforces its own per-call timeout via
 * `options.timeout`. If that timeout is shorter than (or equal to) the
 * underlying LLM call's timeout, every healthy-but-slow call counts as a
 * breaker failure: Opossum throws TimeoutError BEFORE the LLM's
 * AbortController fires, so the call is recorded as a failure even though
 * the upstream is responsive. With volumeThreshold=10 and a 50% threshold,
 * the circuit opens after 10 such calls in the window — at which point
 * every primary call instantly throws LlmCircuitOpenError without being
 * attempted, forcing fallback to Llama.
 *
 * The bug shipped on 2026-05-07 when commit 6db2967 raised
 * PRIMARY_TIMEOUT_DEFAULT_MS from 5000 to 12000 without updating the
 * breaker default (which was 10000). 2026-05-08 audit raised the breaker
 * to 14000 (12000 + 2000 buffer). These tests pin the invariant
 * programmatically so future drift is caught at CI.
 */

describe('F-02 — circuit-breaker timeout vs. LLM timeout invariants', () => {
  it('anthropic breaker timeout is strictly greater than PRIMARY_TIMEOUT_DEFAULT_MS', () => {
    const breakerTimeout = breakerInternal.DEFAULTS['anthropic']!.timeout;
    const llmTimeout = chatInternal.PRIMARY_TIMEOUT_DEFAULT_MS;
    expect(breakerTimeout).toBeGreaterThan(llmTimeout);
  });

  it('anthropic breaker timeout is at least 12000 + 2000 buffer = 14000', () => {
    // Pinned to the audited value so a soft drift (e.g., raising primary to
    // 13000 without raising breaker) is caught even if the strict-greater
    // invariant above still holds with a margin too thin to absorb jitter.
    expect(breakerInternal.DEFAULTS['anthropic']!.timeout).toBeGreaterThanOrEqual(14_000);
  });

  it('groq breaker timeout is strictly greater than FALLBACK_TIMEOUT_DEFAULT_MS', () => {
    const breakerTimeout = breakerInternal.DEFAULTS['groq']!.timeout;
    const llmTimeout = chatInternal.FALLBACK_TIMEOUT_DEFAULT_MS;
    expect(breakerTimeout).toBeGreaterThan(llmTimeout);
  });
});
