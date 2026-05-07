import { afterEach, describe, expect, it, vi } from 'vitest';
import { runQualityCheck } from '../../src/quality-check/orchestrator.js';
import { _internal as correctiveInternal } from '../../src/quality-check/corrective.js';
import { FALLBACK_DEGRADED } from '../../src/quality-check/fallbacks.js';
import type * as CorrectiveModule from '../../src/quality-check/corrective.js';
import type { ResolvedLibraries } from '../../src/libraries/index.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * R-07 (HIGH audit risk) — regen timeout reduction + elapsed-time skip
 * guard. Pre-fix: REGEN_TIMEOUT_MS was 15_000 (2.5× the total budget) and
 * the QC orchestrator had no deadline awareness, so a single regen could
 * blow PRD §5.1's 6000ms cap unconditionally.
 *
 * Post-fix: timeout reduced to 3_000, AND QcInput accepts an optional
 * `deadlineAt: number` (caller passes `t0 + LATENCY_BUDGET_MS`). When
 * Date.now() >= deadlineAt at the regen check point, regen is skipped
 * and the orchestrator returns E6_ServiceUnavailable + FALLBACK_DEGRADED.
 *
 * See audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md.
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

// Candidate with a `## markdown header` triggers Check 11 formatting-discipline
// soft_fail, which forces the regen path (where the R-07 guard fires).
const SOFT_FAILING_CANDIDATE =
  '## A markdown header that violates Voice Rule 11\n\nSome body text that would otherwise look fine, but the header here triggers checkFormattingDiscipline to soft_fail and route through the regen loop. We use this to exercise the R-07 deadline guard deterministically without mocking individual checks.';

afterEach(() => {
  vi.clearAllMocks();
});

describe('R-07 regen timeout cap', () => {
  it('REGEN_TIMEOUT_MS is now 3000ms (down from 15000ms)', () => {
    expect(correctiveInternal.REGEN_TIMEOUT_MS).toBe(3_000);
  });
});

describe('R-07 regen elapsed-time guard', () => {
  it('regen is skipped when deadlineAt is already in the past; returns E6 + FALLBACK_DEGRADED', async () => {
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

  it('regen IS called when deadlineAt has slack (regression — not disabled entirely)', async () => {
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
        // Plenty of slack — regen should run.
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
