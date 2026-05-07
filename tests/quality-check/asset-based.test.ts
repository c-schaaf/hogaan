import { afterEach, describe, expect, it, vi } from 'vitest';
import { check4AssetBased } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch H — Check 4 (asset-based framing) migrated from Groq Llama to
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

describe('Batch H — check4AssetBased on Haiku', () => {
  it('passes when classifier confirms asset-based framing', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: true, reason: 'leads with strength' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check4AssetBased(
      cfg,
      'Your sleeplessness is integrity working — that instinct is a strength.',
    );
    expect(result.checkId).toBe('check_04_asset_based');
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when classifier flags deficit-led framing', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ pass: false, reason: 'leads with what user lacks' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check4AssetBased(cfg, 'You struggle with delegation and lack confidence.');
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/deficit|lacks/);
    }
  });

  it('returns service_unavailable on classifier error', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockRejectedValueOnce(new Error('haiku timeout'));
    const result = await check4AssetBased(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable on invalid JSON', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await check4AssetBased(cfg, 'whatever');
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
    await check4AssetBased(cfg, 'a candidate response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });
});
