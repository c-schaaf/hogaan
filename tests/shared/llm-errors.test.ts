import { describe, expect, it } from 'vitest';
import {
  isFailClosedLlmError,
  LlmAuthError,
  LlmCircuitOpenError,
  LlmContentFilterError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTimeoutError,
  LlmTransientError,
  shouldFallbackToFastModel,
  shouldUseSafeTemplate,
} from '../../src/shared/llm/errors.js';

describe('LLM error dispatch', () => {
  it('routes timeout / rate-limit / circuit-open to fast-model fallback', () => {
    expect(shouldFallbackToFastModel(new LlmTimeoutError('anthropic', 5000))).toBe(true);
    expect(shouldFallbackToFastModel(new LlmRateLimitError('anthropic'))).toBe(true);
    expect(shouldFallbackToFastModel(new LlmCircuitOpenError('anthropic'))).toBe(true);
  });

  it('routes content-filter to safe-template (NOT fast-model)', () => {
    const err = new LlmContentFilterError('anthropic');
    expect(shouldUseSafeTemplate(err)).toBe(true);
    expect(shouldFallbackToFastModel(err)).toBe(false);
  });

  it('routes service-unavailable + auth to fail-closed (no fallback)', () => {
    expect(isFailClosedLlmError(new LlmServiceUnavailableError('anthropic'))).toBe(true);
    expect(isFailClosedLlmError(new LlmAuthError('anthropic'))).toBe(true);
    expect(shouldFallbackToFastModel(new LlmServiceUnavailableError('anthropic'))).toBe(false);
    expect(shouldUseSafeTemplate(new LlmServiceUnavailableError('anthropic'))).toBe(false);
  });

  it('does not fall back on transient — caller should retry within the same provider', () => {
    const err = new LlmTransientError('anthropic', 502);
    expect(shouldFallbackToFastModel(err)).toBe(false);
    expect(shouldUseSafeTemplate(err)).toBe(false);
    expect(isFailClosedLlmError(err)).toBe(false);
  });
});
