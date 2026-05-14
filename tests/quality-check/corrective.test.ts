import { afterEach, describe, expect, it, vi } from 'vitest';
import { runQualityCheck } from '../../src/quality-check/orchestrator.js';
import { _internal as correctiveInternal } from '../../src/quality-check/corrective.js';
import { FALLBACK_DEGRADED } from '../../src/quality-check/fallbacks.js';
import { LlmServiceUnavailableError } from '../../src/shared/llm/errors.js';
import type * as CorrectiveModule from '../../src/quality-check/corrective.js';
import type { ResolvedLibraries } from '../../src/libraries/index.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * R-07 (HIGH audit risk) — predictive regen-skip budget gate. The gate
 * has evolved through three iterations against production evidence:
 *
 *   1. Original: REGEN_TIMEOUT_MS = 15_000, no deadline awareness.
 *      A single regen could blow PRD §5.1's 6000ms cap unconditionally.
 *   2. 2026-05-07: timeout reduced to 3_000, QcInput gained `deadlineAt`,
 *      and the orchestrator skipped regen reactively when
 *      Date.now() >= deadlineAt. This shipped fallbacks AFTER the budget
 *      was gone (~19s elapsed), so the user waited the full budget for
 *      a degraded answer.
 *   3. 2026-05-08 (this file's current contract): timeout raised to
 *      10_000 to fit the post-Batch-H 3700-token regen prompt, AND the
 *      gate became PREDICTIVE — it skips when remaining budget is below
 *      REGEN_BUDGET_HEADROOM_MS (12_000ms, sized to cover regen + final
 *      QC pass + delivery). Fallbacks now ship at ~10s elapsed instead
 *      of waiting out the full budget.
 *
 * See the 2026-05-08 RCA (smoke trace SM64e518d1c30d37188b68601ede72d5e6)
 * and audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md.
 */

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(() =>
    Promise.resolve({
      text: JSON.stringify({ pass: true, status: 'pass', score: 0, reason: 'ok' }),
      inputTokens: 100,
      outputTokens: 20,
    }),
  ),
}));

// Batch H — every LLM-judged QC check now flows through classifierChat
// (Anthropic Haiku 4.5). Union response satisfies all consumers.
vi.mock('../../src/shared/llm/classifier.js', () => ({
  classifierChat: vi.fn(() =>
    Promise.resolve({
      text: JSON.stringify({
        verdict: 'grounded',
        evidence_quote: 'q',
        pass: true,
        status: 'pass',
        score: 0,
        reason: 'ok',
      }),
      inputTokens: 100,
      outputTokens: 20,
    }),
  ),
}));

vi.mock('../../src/shared/embeddings/index.js', () => ({
  embedQuery: vi.fn(() => Promise.resolve(new Array(1024).fill(0.01))),
  embedDocument: vi.fn(() => Promise.resolve(new Array(1024).fill(0.01))),
  embedDocuments: vi.fn(() => Promise.resolve([new Array(1024).fill(0.01)])),
  EMBEDDING_DIM: 1024,
}));

vi.mock('../../src/quality-check/corrective.js', async () => {
  const actual = await vi.importActual<typeof CorrectiveModule>(
    '../../src/quality-check/corrective.js',
  );
  return {
    ...actual,
    regenerate: vi.fn(() => Promise.resolve({ text: 'regenerated coaching response' })),
  };
});

const fakeLibraries: ResolvedLibraries = {
  voiceRules: {
    version: 'v1',
    payload: {
      rules: [],
      heroPhraseFlags: [],
      usefulToSocietyPatterns: ['useful to society'],
    },
  },
  culturalFraming: { version: 'v1', payload: { framings: [] } },
  promptTemplates: { version: 'v1', payload: { templates: {} } },
} as unknown as ResolvedLibraries;

const cfg: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  logLevel: 'error',
  publicBaseUrl: 'http://localhost:3000',
  databaseUrl: undefined,
  redisUrl: undefined,
  upstashRedisRestUrl: undefined,
  upstashRedisRestToken: undefined,
  encryptionKeyBase64: 'KSwSEuoDGo+/FUWKtGzMWcMYAPqSA/9+tcnDpY5EqaI=',
  jwtSecretBase64: 'a'.repeat(64),
  jwtIssuer: 'test',
  jwtAudience: 'test',
  anthropicApiKey: 'sk-test',
  groqApiKey: 'gsk-test',
  voyageApiKey: 'vk-test',
  twilioAccountSid: 'AC_test',
  twilioAuthToken: 'tok_test',
  twilioWhatsAppFrom: 'whatsapp:+14155238886',
  twilioWebhookAuthToken: 'wh_test',
  sentryDsn: undefined,
  axiomToken: undefined,
  axiomDataset: undefined,
  betterstackHeartbeatUrl: undefined,
  resendApiKey: undefined,
  resendFromEmail: undefined,
  supabaseUrl: undefined,
  supabaseAnonKey: undefined,
};

// Candidate is well below the FullCoachingResponse 120-word minimum, so
// check_09 length deterministically soft_fails and forces the regen path
// (where the R-07 guard fires). The historic shape included a `## markdown
// header` that also tripped Check 11 formatting-discipline; Check 11 was
// deactivated 2026-05-08 (pre-launch pilot, see audit-evidence/audits/
// 2026-05-08-pre-launch-quality-check-deactivation.md), so the trigger now
// rests on length alone — the candidate stays short enough for that to
// fire.
const SOFT_FAILING_CANDIDATE =
  'A short candidate that violates the 120-word floor for FullCoachingResponse mode and therefore drives check_09 length to soft_fail. We use it to exercise the R-07 deadline guard deterministically without mocking individual checks.';

afterEach(() => {
  vi.clearAllMocks();
});

describe('R-07 regen timing constants', () => {
  it('REGEN_TIMEOUT_MS is 10000ms (raised from 3000ms after PRIMARY_TIMEOUT_DEFAULT_MS rose to 12000ms)', () => {
    expect(correctiveInternal.REGEN_TIMEOUT_MS).toBe(10_000);
  });

  it('REGEN_BUDGET_HEADROOM_MS is 12000ms (covers regen + final QC pass + delivery, not just regen alone)', () => {
    // The headroom MUST be ≥ REGEN_TIMEOUT_MS — otherwise we permit a
    // regen we cannot guarantee to complete within budget.
    expect(correctiveInternal.REGEN_BUDGET_HEADROOM_MS).toBeGreaterThanOrEqual(
      correctiveInternal.REGEN_TIMEOUT_MS,
    );
    expect(correctiveInternal.REGEN_BUDGET_HEADROOM_MS).toBe(12_000);
  });
});

// All QC checks were disabled 2026-05-13 (see src/quality-check/orchestrator.ts
// runAllChecks — every check is commented out). These tests assert behaviour
// downstream of those checks producing fail results; with no checks running,
// the orchestrator always returns E1_ApprovedFirstAttempt. Re-enable when the
// QC pipeline comes back.
describe.skip('R-07 predictive regen-skip gate — Option B three-case dispatch', () => {
  it('Case 3 (NEW): gate fires + only soft_fails (past deadline) → E8 ships the candidate with degraded:true and softFailedCheckIds populated', async () => {
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    const result = await runQualityCheck(
      {
        config: cfg,
        libraries: fakeLibraries,
        originalSystemPrompt: 'system prompt',
      },
      {
        candidateResponseText: SOFT_FAILING_CANDIDATE,
        userMessage: 'I had a hard week',
        responseMode: 'FullCoachingResponse',
        intent: 'Coaching',
        // Deadline already in the past — predictive gate fires; only
        // check_09 length soft_fails on this candidate, no Check 8
        // unavailability, no hard_fails. Option B: ship the candidate.
        deadlineAt: Date.now() - 100,
      },
    );

    expect(result.endEvent).toBe('E8_ShipDegradedCandidate');
    expect(result.responseText).toBe(SOFT_FAILING_CANDIDATE);
    expect(result.responseText).not.toBe(FALLBACK_DEGRADED);
    expect(result.degraded).toBe(true);
    expect(result.softFailedCheckIds).toBeDefined();
    expect(result.softFailedCheckIds).toContain('check_09_length');
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('Case 3 (NEW): gate fires predictively (remainingMs < headroom) + only soft_fails → E8 ships the candidate (load-bearing case for the 2026-05-08 RCA)', async () => {
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    // Deadline is 5s in the future. Under the predictive gate, 5s < 12s
    // headroom, so regen is skipped. With only soft_fails present, Option
    // B ships the candidate instead of FALLBACK_DEGRADED — this is the
    // exact shape of the production trace SMa2580445d1c57f6fee4c430be2b13a39
    // (2026-05-08 12:13) that prompted the fix.
    const result = await runQualityCheck(
      {
        config: cfg,
        libraries: fakeLibraries,
        originalSystemPrompt: 'system prompt',
      },
      {
        candidateResponseText: SOFT_FAILING_CANDIDATE,
        userMessage: 'I had a hard week',
        responseMode: 'FullCoachingResponse',
        intent: 'Coaching',
        deadlineAt: Date.now() + 5_000,
      },
    );

    expect(result.endEvent).toBe('E8_ShipDegradedCandidate');
    expect(result.responseText).toBe(SOFT_FAILING_CANDIDATE);
    expect(result.responseText).not.toBe(FALLBACK_DEGRADED);
    expect(result.degraded).toBe(true);
    expect(result.softFailedCheckIds).toBeDefined();
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('Case 1 (REGRESSION LOCK): Check 8 service_unavailable + tight deadline → E6 + FALLBACK_DEGRADED — safety fail-closed survives Option B (CLAUDE.md hard rule #1)', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    // Override the global classifierChat mock so Check 8 throws a
    // service-unavailable error (every other LLM check still passes).
    // Check 8's outer try/catch maps any LlmError → service_unavailable
    // CheckResult, which the orchestrator routes to E6 + fallbackDegraded()
    // via the early branch at orchestrator.ts:114-138 — BEFORE the R-07
    // gate. The behavioral assertion: a Check 8 unavailability fail-closes
    // regardless of budget pressure or Option B's new soft-fail path.
    const originalImpl = vi.mocked(classifierMod.classifierChat).getMockImplementation();
    vi.mocked(classifierMod.classifierChat).mockImplementation((_cfg, req) => {
      if (req.systemPrompt.includes('safety + crisis classifier')) {
        return Promise.reject(new LlmServiceUnavailableError('anthropic', 'haiku 503'));
      }
      // Other checks: pass-through to the existing global mock.
      return Promise.resolve({
        text: JSON.stringify({
          verdict: 'grounded',
          evidence_quote: 'q',
          pass: true,
          status: 'pass',
          score: 0,
          reason: 'ok',
        }),
        inputTokens: 100,
        outputTokens: 20,
      });
    });

    try {
      const result = await runQualityCheck(
        {
          config: cfg,
          libraries: fakeLibraries,
          originalSystemPrompt: 'system prompt',
        },
        {
          candidateResponseText: SOFT_FAILING_CANDIDATE,
          userMessage: 'I had a hard week',
          responseMode: 'FullCoachingResponse',
          intent: 'Coaching',
          deadlineAt: Date.now() - 100,
        },
      );

      expect(result.endEvent).toBe('E6_ServiceUnavailable');
      expect(result.responseText).toBe(FALLBACK_DEGRADED);
      expect(result.degraded).toBe(true);
      // E8's signature field MUST NOT appear on the safety fail-closed path.
      expect(result.softFailedCheckIds).toBeUndefined();
      expect(regenSpy).not.toHaveBeenCalled();
    } finally {
      // Restore the global mock so subsequent tests are unaffected.
      if (originalImpl !== undefined) {
        vi.mocked(classifierMod.classifierChat).mockImplementation(originalImpl);
      }
    }
  });

  it('Case 2 (REGRESSION LOCK): Check 8 hard_fail + tight deadline → E5_SafetyHardFailure (early branch, no candidate shipped) — hard-fail unshippability survives Option B', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    // Override classifierChat so Check 8 returns hard_fail. The
    // orchestrator's early branch at orchestrator.ts:102-112 catches
    // Check 8 hard_fail and returns E5 + responseText=''. This is a
    // stricter fail-closed than E6 — the candidate is UNSHIPPABLE,
    // which is the correct behavior for a safety-flagged response. The
    // R-07 gate's defensive hasHardFail branch (which would route to
    // E6) is unreachable in this scenario; both are fail-closed. The
    // assertion: Option B does not let a hard_fail-flagged candidate
    // ship under any circumstance.
    const originalImpl = vi.mocked(classifierMod.classifierChat).getMockImplementation();
    vi.mocked(classifierMod.classifierChat).mockImplementation((_cfg, req) => {
      if (req.systemPrompt.includes('safety + crisis classifier')) {
        return Promise.resolve({
          text: JSON.stringify({ status: 'hard_fail', reason: 'unsafe content' }),
          inputTokens: 100,
          outputTokens: 20,
        });
      }
      return Promise.resolve({
        text: JSON.stringify({
          verdict: 'grounded',
          evidence_quote: 'q',
          pass: true,
          status: 'pass',
          score: 0,
          reason: 'ok',
        }),
        inputTokens: 100,
        outputTokens: 20,
      });
    });

    try {
      const result = await runQualityCheck(
        {
          config: cfg,
          libraries: fakeLibraries,
          originalSystemPrompt: 'system prompt',
        },
        {
          candidateResponseText: SOFT_FAILING_CANDIDATE,
          userMessage: 'I had a hard week',
          responseMode: 'FullCoachingResponse',
          intent: 'Coaching',
          deadlineAt: Date.now() - 100,
        },
      );

      expect(result.endEvent).toBe('E5_SafetyHardFailure');
      // E5 ships an empty body (caller routes to E11 with no outbound),
      // NEVER the candidate.
      expect(result.responseText).toBe('');
      expect(result.responseText).not.toBe(SOFT_FAILING_CANDIDATE);
      expect(result.softFailedCheckIds).toBeUndefined();
      expect(regenSpy).not.toHaveBeenCalled();
    } finally {
      if (originalImpl !== undefined) {
        vi.mocked(classifierMod.classifierChat).mockImplementation(originalImpl);
      }
    }
  });

  it('regen IS called when remainingMs >= REGEN_BUDGET_HEADROOM_MS (regression — not disabled entirely)', async () => {
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    const result = await runQualityCheck(
      {
        config: cfg,
        libraries: fakeLibraries,
        originalSystemPrompt: 'system prompt',
      },
      {
        candidateResponseText: SOFT_FAILING_CANDIDATE,
        userMessage: 'I had a hard week',
        responseMode: 'FullCoachingResponse',
        intent: 'Coaching',
        // 60s of slack — well above the 12s headroom; regen should run.
        deadlineAt: Date.now() + 60_000,
      },
    );

    expect(regenSpy).toHaveBeenCalled();
    // Result depends on whether the regenerated text passes; for this
    // test we only care that regen was invoked.
    expect([
      'E2_ApprovedRegenerated',
      'E3_MaxRetriesExceeded',
      'E1_ApprovedFirstAttempt',
    ]).toContain(result.endEvent);
  });

  it('regen runs without deadline awareness when deadlineAt is undefined (backward compatible)', async () => {
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    const result = await runQualityCheck(
      {
        config: cfg,
        libraries: fakeLibraries,
        originalSystemPrompt: 'system prompt',
      },
      {
        candidateResponseText: SOFT_FAILING_CANDIDATE,
        userMessage: 'I had a hard week',
        responseMode: 'FullCoachingResponse',
        intent: 'Coaching',
        // No deadlineAt at all — pre-R-07 callers continue to work.
      },
    );

    expect(regenSpy).toHaveBeenCalled();
    expect([
      'E2_ApprovedRegenerated',
      'E3_MaxRetriesExceeded',
      'E1_ApprovedFirstAttempt',
    ]).toContain(result.endEvent);
  });
});
