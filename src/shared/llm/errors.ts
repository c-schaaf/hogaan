/**
 * Standardized LLM error categories. Process #2 Step 9 dispatches on these:
 *   - LlmTimeoutError       → fast-model fallback
 *   - LlmRateLimitError     → fast-model fallback
 *   - LlmContentFilterError → safe-template fallback (do NOT retry; input is the issue)
 *   - LlmServiceUnavailableError → E11 (fail-closed, no fallback)
 *   - LlmAuthError          → P0 incident, halt service
 *   - LlmTransientError     → retry with backoff
 *
 * Each provider client maps its native errors into these. Higher layers never
 * see provider-specific error types.
 */

export class LlmError extends Error {
  public readonly provider: 'anthropic' | 'groq' | 'voyage';
  public override readonly cause: unknown;

  constructor(message: string, provider: 'anthropic' | 'groq' | 'voyage', cause?: unknown) {
    super(message);
    this.name = 'LlmError';
    this.provider = provider;
    this.cause = cause;
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(provider: LlmError['provider'], timeoutMs: number) {
    super(`${provider} timed out after ${timeoutMs}ms`, provider);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmRateLimitError extends LlmError {
  constructor(provider: LlmError['provider'], cause?: unknown) {
    super(`${provider} rate limit (429)`, provider, cause);
    this.name = 'LlmRateLimitError';
  }
}

export class LlmContentFilterError extends LlmError {
  constructor(provider: LlmError['provider'], cause?: unknown) {
    super(`${provider} content filter`, provider, cause);
    this.name = 'LlmContentFilterError';
  }
}

export class LlmServiceUnavailableError extends LlmError {
  constructor(provider: LlmError['provider'], cause?: unknown) {
    super(`${provider} service unavailable`, provider, cause);
    this.name = 'LlmServiceUnavailableError';
  }
}

export class LlmAuthError extends LlmError {
  constructor(provider: LlmError['provider'], cause?: unknown) {
    super(`${provider} auth failure (401/403)`, provider, cause);
    this.name = 'LlmAuthError';
  }
}

export class LlmTransientError extends LlmError {
  constructor(provider: LlmError['provider'], status: number, cause?: unknown) {
    super(`${provider} transient error (${status})`, provider, cause);
    this.name = 'LlmTransientError';
  }
}

export class LlmCircuitOpenError extends LlmError {
  constructor(provider: LlmError['provider']) {
    super(`${provider} circuit breaker open`, provider);
    this.name = 'LlmCircuitOpenError';
  }
}

/** Type guard used by Process #2 Step 9 dispatch logic. */
export function shouldFallbackToFastModel(err: unknown): boolean {
  return (
    err instanceof LlmTimeoutError ||
    err instanceof LlmRateLimitError ||
    err instanceof LlmCircuitOpenError
  );
}

export function shouldUseSafeTemplate(err: unknown): boolean {
  return err instanceof LlmContentFilterError;
}

export function isFailClosedLlmError(err: unknown): boolean {
  return err instanceof LlmServiceUnavailableError || err instanceof LlmAuthError;
}
