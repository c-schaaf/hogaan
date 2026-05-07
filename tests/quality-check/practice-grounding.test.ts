import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { check17PracticeGrounding } from '../../src/quality-check/checks-llm.js';
import { LlmTimeoutError } from '../../src/shared/llm/errors.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch P Piece 3 — LLM-judged Check 17 practice grounding.
 *
 * Verdict mapping:
 *   - 'grounded'  → pass
 *   - 'mentioned' → soft_fail (drift)
 *   - 'absent'    → soft_fail
 *   - LlmError    → service_unavailable (treated as quality-shaping skip
 *     by the orchestrator, not safety fail-closed)
 *
 * Deterministic precheck:
 *   - if response does not contain the practice tag word, skip the
 *     LLM call and auto-set verdict to soft_fail
 */

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(),
}));

const cfg = {} as unknown as AppConfig;

beforeEach(async () => {
  const groqMod = await import('../../src/shared/llm/groq.js');
  vi.mocked(groqMod.groqChat).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Batch P Piece 3 — check17 practice grounding', () => {
  describe('deterministic precheck (no LLM call)', () => {
    it('candidate without the practice word → soft_fail, Groq NOT called', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      const groqSpy = vi.mocked(groqMod.groqChat);

      const result = await check17PracticeGrounding(
        cfg,
        'I cannot sleep about my team',
        'You should focus on what your team needs from you tomorrow morning.',
        'integrity',
      );

      expect(result.checkId).toBe('check_17_practice_grounding');
      expect(result.outcome.status).toBe('soft_fail');
      if (result.outcome.status === 'soft_fail') {
        expect(result.outcome.reason).toContain('not present');
        expect(result.outcome.reason).toContain('integrity');
      }
      expect(groqSpy).not.toHaveBeenCalled();
    });

    it('candidate WITH the practice word → Groq IS called', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      const groqSpy = vi.mocked(groqMod.groqChat);
      groqSpy.mockResolvedValue({
        text: JSON.stringify({ verdict: 'grounded', evidence_quote: 'integrity working' }),
        inputTokens: 500,
        outputTokens: 30,
      });

      const result = await check17PracticeGrounding(
        cfg,
        'I cannot sleep about this hard call',
        'Your sleeplessness is integrity working. The next step is to name what is at stake.',
        'integrity',
      );

      expect(result.outcome.status).toBe('pass');
      expect(groqSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('verdict mapping', () => {
    it("verdict 'grounded' → pass", async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockResolvedValue({
        text: JSON.stringify({ verdict: 'grounded', evidence_quote: 'q' }),
        inputTokens: 500,
        outputTokens: 30,
      });
      const r = await check17PracticeGrounding(cfg, 'msg', 'integrity is the frame', 'integrity');
      expect(r.outcome.status).toBe('pass');
    });

    it("verdict 'mentioned' → soft_fail (drift)", async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockResolvedValue({
        text: JSON.stringify({
          verdict: 'mentioned',
          evidence_quote: 'word appears once at the end',
        }),
        inputTokens: 500,
        outputTokens: 30,
      });
      const r = await check17PracticeGrounding(
        cfg,
        'msg',
        'integrity comes up but the answer is about something else entirely',
        'integrity',
      );
      expect(r.outcome.status).toBe('soft_fail');
      if (r.outcome.status === 'soft_fail') {
        expect(r.outcome.reason).toContain('mentioned');
      }
    });

    it("verdict 'absent' → soft_fail", async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockResolvedValue({
        text: JSON.stringify({ verdict: 'absent', evidence_quote: '' }),
        inputTokens: 500,
        outputTokens: 30,
      });
      const r = await check17PracticeGrounding(
        cfg,
        'msg',
        'integrity is here but the LLM judges absent',
        'integrity',
      );
      expect(r.outcome.status).toBe('soft_fail');
      if (r.outcome.status === 'soft_fail') {
        expect(r.outcome.reason).toContain('absent');
      }
    });
  });

  describe('error handling', () => {
    it('Groq timeout → service_unavailable (fail-closed)', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockRejectedValue(new LlmTimeoutError('groq', 4000));

      const r = await check17PracticeGrounding(cfg, 'msg', 'integrity is mentioned', 'integrity');

      expect(r.outcome.status).toBe('service_unavailable');
    });

    it('invalid JSON → service_unavailable', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockResolvedValue({
        text: 'not json at all',
        inputTokens: 500,
        outputTokens: 30,
      });

      const r = await check17PracticeGrounding(cfg, 'msg', 'integrity is mentioned', 'integrity');

      expect(r.outcome.status).toBe('service_unavailable');
    });

    it('verdict outside the enum → service_unavailable', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      vi.mocked(groqMod.groqChat).mockResolvedValue({
        text: JSON.stringify({ verdict: 'whatever', evidence_quote: '' }),
        inputTokens: 500,
        outputTokens: 30,
      });

      const r = await check17PracticeGrounding(cfg, 'msg', 'integrity is mentioned', 'integrity');

      expect(r.outcome.status).toBe('service_unavailable');
    });
  });

  describe('skip semantics', () => {
    it('practiceTag undefined → not_required, Groq not called', async () => {
      const groqMod = await import('../../src/shared/llm/groq.js');
      const groqSpy = vi.mocked(groqMod.groqChat);

      const r = await check17PracticeGrounding(cfg, 'msg', 'response', undefined);

      expect(r.outcome.status).toBe('not_required');
      expect(groqSpy).not.toHaveBeenCalled();
    });
  });
});
