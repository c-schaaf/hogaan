import { describe, expect, it, vi } from 'vitest';
import { checkTangibleAction } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(),
}));

const cfg = { logLevel: 'error' } as AppConfig;

describe('Phase 11 R34 — checkTangibleAction', () => {
  it('passes when classifier finds a concrete next-step', async () => {
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
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
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
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
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockRejectedValueOnce(new Error('groq timeout'));
    const result = await checkTangibleAction(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable on invalid JSON', async () => {
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkTangibleAction(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });
});
