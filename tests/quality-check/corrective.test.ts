import { afterEach, describe, expect, it, vi } from 'vitest';
import { runQualityCheck } from '../../src/quality-check/orchestrator.js';
import { _internal as correctiveInternal } from '../../src/quality-check/corrective.js';
import { FALLBACK_DEGRADED } from '../../src/quality-check/fallbacks.js';
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
  sponsorPortalBaseUrl: undefined,
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

describe('R-07 predictive regen-skip gate', () => {
  it('regen is skipped when deadlineAt is already in the past (degenerate case; remaining < 0 < headroom)', async () => {
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
        // Deadline already in the past — regen must be skipped.
        deadlineAt: Date.now() - 100,
      },
    );

    expect(result.endEvent).toBe('E6_ServiceUnavailable');
    expect(result.responseText).toBe(FALLBACK_DEGRADED);
    expect(result.degraded).toBe(true);
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('regen is skipped predictively when remainingMs < REGEN_BUDGET_HEADROOM_MS even though the deadline has not yet passed (the load-bearing case for the 2026-05-08 RCA)', async () => {
    const correctiveMod = await import('../../src/quality-check/corrective.js');
    const regenSpy = vi.mocked(correctiveMod.regenerate);
    regenSpy.mockClear();

    // Deadline is 5s in the future — under the OLD reactive gate this
    // would have permitted regen (deadline not yet past). Under the
    // predictive gate, 5s < 12s headroom, so regen MUST be skipped.
    // This is the smoke-trace shape: at the regen-decision point the
    // turn had ~4-5s of remaining budget; old gate let regen run, regen
    // took ~7.6s, total turn hit 19s, R-06 fallback dispatched.
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

    expect(result.endEvent).toBe('E6_ServiceUnavailable');
    expect(result.responseText).toBe(FALLBACK_DEGRADED);
    expect(result.degraded).toBe(true);
    expect(regenSpy).not.toHaveBeenCalled();
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
