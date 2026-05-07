import { afterEach, describe, expect, it, vi } from 'vitest';
import { check8SafetyCrisis } from '../../src/quality-check/checks-llm.js';
import { LlmServiceUnavailableError } from '../../src/shared/llm/errors.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Batch H — Check 8 (safety + crisis Tier-B re-classifier) migrated
 * from Groq Llama to Anthropic Haiku 4.5 via the classifierChat wrapper.
 *
 * SAFETY-CRITICAL. Process #2 Step 1 fastPathTriage is the first crisis
 * line; Check 8 is the second. If Check 8 verdict is 'crisis', the
 * orchestrator MUST route to crisis-handoff regardless of any other
 * QC outcome (CLAUDE.md hard rule #1).
 *
 * Fail-closed semantics: any LlmError → service_unavailable, and the
 * orchestrator routes to E6 (no approval without verified safety).
 *
 * The judge prompt is reproduced in src/quality-check/checks-llm.ts and
 * is not modified by this migration. The verdict-mapping switch likewise
 * is unchanged. This test file pins both behaviors so a future refactor
 * cannot silently weaken them.
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

describe('Batch H — check8SafetyCrisis on Haiku', () => {
  it("status='pass' → outcome.status='pass'", async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'pass', reason: 'safe + non-crisis' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(
      cfg,
      'How do I run a tough 1:1 with my deputy?',
      'Hold the meeting tomorrow morning. Lead with what you appreciate about her work.',
    );
    expect(r.checkId).toBe('check_08_safety_crisis');
    expect(r.outcome.status).toBe('pass');
  });

  it("status='soft_fail' → outcome.status='soft_fail' with reason preserved", async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'soft_fail', reason: 'borderline clinical advice' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(cfg, 'msg', 'maybe go see a therapist about that');
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toContain('borderline');
    }
  });

  it("status='crisis' → outcome.status='crisis' (Tier-B re-classifier catches what Tier-A missed)", async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({
        status: 'crisis',
        reason: 'indirect self-harm cue in user message',
      }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(
      cfg,
      "i don't see the point of any of this anymore",
      'Some coaching content the response generated.',
    );
    // CLAUDE.md hard rule #1: crisis must NOT be silently demoted.
    expect(r.outcome.status).toBe('crisis');
    expect(r.outcome.status).not.toBe('pass');
    if (r.outcome.status === 'crisis') {
      expect(r.outcome.reason).toContain('cue');
    }
  });

  it("status='hard_fail' → outcome.status='hard_fail'", async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'hard_fail', reason: 'response gave clinical diagnosis' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(cfg, 'msg', 'You have clinical depression. Take SSRIs.');
    expect(r.outcome.status).toBe('hard_fail');
  });

  it('unknown status → soft_fail with explanatory reason', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'weird', reason: 'whatever' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(cfg, 'msg', 'response');
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toContain('unknown status');
    }
  });

  it('malformed JSON → service_unavailable (fail-closed)', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: 'this is not json at all',
      inputTokens: 100,
      outputTokens: 20,
    });
    const r = await check8SafetyCrisis(cfg, 'msg', 'response');
    expect(r.outcome.status).toBe('service_unavailable');
  });

  it('LlmError thrown → service_unavailable (fail-closed; orchestrator routes to E6)', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockRejectedValueOnce(
      new LlmServiceUnavailableError('anthropic', 'haiku 503'),
    );
    const r = await check8SafetyCrisis(cfg, 'msg', 'response');
    expect(r.outcome.status).toBe('service_unavailable');
  });

  it('calls classifierChat (NOT groqChat) — migration regression guard', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    const { groqChat } = await import('../../src/shared/llm/groq.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'pass', reason: 'ok' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    await check8SafetyCrisis(cfg, 'msg', 'response');
    expect(classifierChat).toHaveBeenCalledTimes(1);
    expect(groqChat).not.toHaveBeenCalled();
  });

  it('judge prompt preserves the two-axis safety + crisis structure', async () => {
    const { classifierChat } = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierChat).mockResolvedValueOnce({
      text: JSON.stringify({ status: 'pass', reason: 'ok' }),
      inputTokens: 100,
      outputTokens: 20,
    });
    await check8SafetyCrisis(cfg, 'a user message', 'a candidate response');
    const call = vi.mocked(classifierChat).mock.calls[0]![1];
    // Two-axis structure: response safety AND user-message crisis detection.
    expect(call.systemPrompt).toContain('Response safety');
    expect(call.systemPrompt).toContain('crisis');
    // High-recall posture per CLAUDE.md hard rule #1.
    expect(call.systemPrompt).toContain('HIGH-RECALL');
    // Strict JSON contract preserved.
    expect(call.systemPrompt).toContain('"crisis"');
    expect(call.systemPrompt).toContain('"hard_fail"');
  });
});
