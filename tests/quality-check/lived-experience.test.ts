import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLivedExperienceDiscipline } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Phase 11 R33 / Batch H — Check 10 (lived-experience discipline)
 * migrated from Groq Llama to Anthropic Haiku 4.5 via the
 * classifierChat wrapper.
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

describe('Phase 11 R33 / Batch H — checkLivedExperienceDiscipline', () => {
  it('passes when score=0 (no lived experience invoked)', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 0, reason: 'no biographical reference' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(
      cfg,
      'Your sleeplessness is integrity working. The next move is to name what your team needs.',
    );
    expect(result.checkId).toBe('check_10_lived_experience');
    expect(result.outcome.status).toBe('pass');
  });

  it('passes when score=1 (lived experience paired with concrete insight)', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 1, reason: 'biography paired with insight' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(
      cfg,
      'In the camps we learned that scarcity sharpens noticing — your "stuck" might be data, not a problem.',
    );
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when score=2 (credential without insight)', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 2, reason: 'biography cited as credential, no insight load' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(
      cfg,
      'As a refugee, I understand. As someone who has worked in public service, I know.',
    );
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/credential|insight/);
    }
  });

  it('returns service_unavailable when classifier returns invalid JSON', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable when classifier returns invalid score', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 5, reason: 'whatever' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('calls classifierChat (NOT groqChat) — migration regression guard', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 0, reason: 'ok' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    await checkLivedExperienceDiscipline(cfg, 'a candidate response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });
});
