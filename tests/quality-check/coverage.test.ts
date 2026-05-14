import { describe, expect, it, vi } from 'vitest';
import { runQualityCheck } from '../../src/quality-check/orchestrator.js';
import type { ResolvedLibraries } from '../../src/libraries/index.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type { CheckId } from '../../src/quality-check/types.js';

/**
 * Phase 12 R1 — every CheckId in the catalog must be producible by
 * runAllChecks. Without this assertion the Phase 11 checks could silently
 * drop out of the pipeline (the original audit finding).
 *
 * The test mocks the LLM/embedding boundaries so it stays deterministic,
 * runs the full orchestrator once, and asserts the union of CheckIds
 * observed equals the declared catalog.
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

// Batch G + Batch H — every LLM-judged QC check now flows through
// classifierChat (Anthropic Haiku 4.5). The union response below
// satisfies all consumers: Check 17 reads `verdict`, Checks 3/4/7/12/15
// read `pass`, Check 8 reads `status`, Check 10 reads `score`.
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

const ALL_CHECK_IDS: readonly CheckId[] = [
  'check_01_practice_tag',
  'check_02_level_tag',
  'check_03_signature_structure',
  'check_04_asset_based',
  'check_05_hero_to_guide',
  'check_06_useful_to_society',
  'check_07_tone',
  'check_08_safety_crisis',
  'check_09_length',
  // check_10_lived_experience deactivated 2026-05-08 (pre-launch trusted-user pilot) — LLM grader needs recalibration; reactivation pending.
  // check_11_formatting_discipline deactivated 2026-05-08 (pre-launch trusted-user pilot) — regex needs cleanliness re-test; reactivation pending.
  'check_12_tangible_action',
  // check_13_voice_consistency removed 2026-05-08 — graded a hidden centroid threshold.
  'check_14_intent_length',
  'check_15_useful_to_society_anchor',
  // check_16_level_fidelity removed 2026-05-08 — graded an unstated phrase-density rule.
  'check_17_practice_grounding',
];

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

// QC checks disabled 2026-05-13 — runAllChecks returns [] until checks are re-enabled.
describe.skip('Phase 12 R1 — runAllChecks produces every active CheckId in the catalog', () => {
  it('runs all active checks in a single pass', async () => {
    const result = await runQualityCheck(
      {
        config: cfg,
        libraries: fakeLibraries,
        originalSystemPrompt: 'system prompt',
      },
      {
        candidateResponseText:
          'Your sleeplessness is integrity working. The next step is to name what your team needs from you, useful to the people you lead. Hold a 1:1 tomorrow with the senior engineer and ask: what would you change if you ran this team?',
        userMessage: 'I cannot sleep about this team',
        responseMode: 'FullCoachingResponse',
        intent: 'Coaching',
      },
    );

    const observedIds = new Set(result.checks.map((c) => c.checkId));
    for (const id of ALL_CHECK_IDS) {
      expect(observedIds.has(id), `CheckId ${id} missing from runAllChecks output`).toBe(true);
    }
    expect(observedIds.size).toBe(ALL_CHECK_IDS.length);
  });
});
