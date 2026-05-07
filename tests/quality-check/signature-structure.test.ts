import { afterEach, describe, expect, it, vi } from 'vitest';
import { check3SignatureStructure } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch H — Check 3 (signature structure) migrated from Groq Llama to
 * Anthropic Haiku 4.5 via the classifierChat wrapper. Tests mock
 * classifier.js (the unit under test invocation) and groq.js (negative
 * assertion that the legacy path is NOT exercised).
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

describe('Batch H — check3SignatureStructure on Haiku', () => {
  it('passes when classifier confirms arc + concrete action', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: true, reason: 'arc + action present' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check3SignatureStructure(
      cfg,
      'Story about a tough call. Insight: integrity is uncomfortable. Hold a 1:1 tomorrow.',
    );
    expect(result.checkId).toBe('check_03_signature_structure');
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when classifier reports the arc is missing', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: false, reason: 'no concrete next-step' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check3SignatureStructure(cfg, 'Just an abstract reflection.');
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/next-step|arc/);
    }
  });

  it('returns service_unavailable on classifier error', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockRejectedValueOnce(new Error('haiku timeout'));
    const result = await check3SignatureStructure(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable on invalid JSON', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check3SignatureStructure(cfg, 'whatever');
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
    await check3SignatureStructure(cfg, 'a candidate response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });
});
