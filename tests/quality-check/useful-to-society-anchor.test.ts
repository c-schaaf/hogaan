import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUsefulToSocietyAnchor } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch H — Check 15 (useful-to-society anchor) migrated from Groq Llama
 * to Anthropic Haiku 4.5 via the classifierChat wrapper.
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

describe('Batch H — checkUsefulToSocietyAnchor on Haiku', () => {
  it('passes when classifier confirms intentional Voice Rule 1 anchor', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: true, reason: 'connects to broader service' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkUsefulToSocietyAnchor(
      cfg,
      'Your sleeplessness is integrity in service of the team you lead.',
    );
    expect(result.checkId).toBe('check_15_useful_to_society_anchor');
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when classifier flags missing or incidental anchor', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: false, reason: 'no useful-to-society framing' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkUsefulToSocietyAnchor(cfg, 'Just hold a meeting tomorrow.');
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/useful|anchor|framing/);
    }
  });

  it('returns service_unavailable on classifier error', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockRejectedValueOnce(new Error('haiku timeout'));
    const result = await checkUsefulToSocietyAnchor(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable on invalid JSON', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkUsefulToSocietyAnchor(cfg, 'whatever');
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
    await checkUsefulToSocietyAnchor(cfg, 'a candidate response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });
});
