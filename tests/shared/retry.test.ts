import { describe, expect, it } from 'vitest';
import {
  LlmTimeoutError,
  LlmTransientError,
  LlmContentFilterError,
} from '../../src/shared/llm/errors.js';
import { withRetry, withTimeout } from '../../src/shared/llm/retry.js';

describe('withRetry', () => {
  it('retries on LlmTransientError', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new LlmTransientError('anthropic', 502);
        }
        return Promise.resolve('ok');
      },
      { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does NOT retry on content-filter (input is the issue)', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          throw new LlmContentFilterError('anthropic');
        },
        { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3 },
      ),
    ).rejects.toBeInstanceOf(LlmContentFilterError);
    expect(attempts).toBe(1);
  });

  it('surfaces timeout immediately for caller-side dispatch', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          throw new LlmTimeoutError('anthropic', 5000);
        },
        { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3 },
      ),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(attempts).toBe(1);
  });
});

describe('withTimeout', () => {
  it('rejects with LlmTimeoutError after deadline', async () => {
    await expect(
      withTimeout('anthropic', 25, () => new Promise((resolve) => setTimeout(resolve, 200))),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('resolves before deadline', async () => {
    const v = await withTimeout('groq', 200, () => Promise.resolve('fast'));
    expect(v).toBe('fast');
  });
});
