import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTangibleAction } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch H — Check 12 (tangible action) migrated from Groq Llama to
 * Anthropic Haiku 4.5 via the classifierChat wrapper.
 */

vi.mock('../../src/shared/llm/classifier.js', () => ({
  classifierChat: vi.fn(),
}));

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(),
}));

const cfg = { logLevel: 'error' } as AppConfig;

afterEach(() => {
  vi.clearAllMocks();
});

describe('Phase 11 R34 / Batch H — checkTangibleAction', () => {
  it('passes when classifier finds a concrete next-step', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: true, reason: 'specific meeting + question identified' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkTangibleAction(
      cfg,
      'Hold a 20-minute 1:1 with Asha tomorrow and ask her: "what would you change if you ran this team?"',
    );
    expect(result.checkId).toBe('check_12_tangible_action');
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when classifier flags rhetorical filler ("lean into it")', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: false, reason: 'no specific next-step; rhetorical filler' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkTangibleAction(
      cfg,
      'Trust yourself and lean into the discomfort. The path will become clear.',
    );
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/next-step|filler/);
    }
  });

  it('returns service_unavailable on classifier error', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockRejectedValueOnce(new Error('haiku timeout'));
    const result = await checkTangibleAction(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable on invalid JSON', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkTangibleAction(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('calls classifierChat (NOT groqChat) — migration regression guard', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: true, reason: 'ok' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    await checkTangibleAction(cfg, 'a candidate response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });
});
