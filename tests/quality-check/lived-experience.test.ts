import { describe, expect, it, vi } from 'vitest';
import { checkLivedExperienceDiscipline } from '../../src/quality-check/checks-llm.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(),
}));

const cfg = { logLevel: 'error' } as AppConfig;

describe('Phase 11 R33 — checkLivedExperienceDiscipline', () => {
  it('passes when score=0 (no lived experience invoked)', async () => {
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
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
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
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
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
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
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
      text: 'not-json',
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });

  it('returns service_unavailable when classifier returns invalid score', async () => {
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(groqChat).mockResolvedValueOnce({
      text: JSON.stringify({ score: 5, reason: 'whatever' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const result = await checkLivedExperienceDiscipline(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });
});
