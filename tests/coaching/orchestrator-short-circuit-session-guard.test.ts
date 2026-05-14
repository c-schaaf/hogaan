import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { LlmServiceUnavailableError } from '../../src/shared/llm/errors.js';
import type * as PromptAssemblyModule from '../../src/prompt-assembly/index.js';
import type * as QualityCheckModule from '../../src/quality-check/index.js';
import type * as LibrariesModule from '../../src/libraries/index.js';
import {
  asPhoneE164,
  asSessionId,
  asUserId,
  type SessionId,
} from '../../src/shared/types/index.js';
import { withVoiceFidelityEvidence } from '../phase-12/helpers/evidence-vf.js';
import {
  fakeConfig,
  fakeRateLimiters,
  fakeRedis,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

/**
 * R-01 (HIGH audit risk) — Greeting/Affirmation short-circuits must consult
 * session state. Greeting fires only on a genuinely new session
 * (session.isNew === true). Affirmation fires only when there's a prior
 * turn to acknowledge (!session.isNew && turnCount > 0).
 *
 * Reproduces screenshot Bug 1: returning user 38 minutes into a session
 * sent "how are u today?" and received the new-user welcome again.
 *
 * See audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md.
 */

vi.mock('../../src/coaching/triage.js', () => ({
  triage: vi.fn(),
  fastPathTriage: vi.fn(),
}));

vi.mock('../../src/session-lifecycle/index.js', () => ({
  resolveSession: vi.fn(),
  fetchRecentTurns: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../src/scenario-learning/index.js', () => ({
  runScenarioTurn: vi.fn(() => Promise.resolve({ kind: 'no_active_scenario_no_kickoff' })),
}));

vi.mock('../../src/coaching/context-fetch.js', () => ({
  fetchCoachingContext: vi.fn(() =>
    Promise.resolve({
      memories: [],
      profile: { mappedPractices: [] },
      sessionTurns: [],
      partialFailure: false,
    }),
  ),
}));

vi.mock('../../src/prompt-assembly/index.js', async () => {
  const actual = await vi.importActual<typeof PromptAssemblyModule>(
    '../../src/prompt-assembly/index.js',
  );
  return {
    ...actual,
    assemblePrompt: vi.fn(),
  };
});

vi.mock('../../src/quality-check/index.js', async () => {
  const actual = await vi.importActual<typeof QualityCheckModule>(
    '../../src/quality-check/index.js',
  );
  return {
    ...actual,
    runQualityCheck: vi.fn(),
  };
});

vi.mock('../../src/shared/llm/chat.js', () => ({
  chat: vi.fn(),
}));

vi.mock('../../src/libraries/index.js', async () => {
  const actual = await vi.importActual<typeof LibrariesModule>('../../src/libraries/index.js');
  return {
    ...actual,
    getActiveLibraryVersions: vi.fn(() =>
      Promise.resolve({
        promptTemplates: { version: 'test', hash: 'h', payload: {} as never },
        voiceRules: { version: 'test', hash: 'h', payload: {} as never },
        culturalFraming: { version: 'test', hash: 'h', payload: {} as never },
        resolvedAt: new Date(),
      }),
    ),
  };
});

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-0000000001a1');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-0000000001ff');
const TEST_PHONE = asPhoneE164('+254700099001');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-r01-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-07T12:00:00Z'),
    traceId: `trace-r01-${Math.random().toString(36).slice(2, 8)}`,
  };
}

const deps = (): Parameters<typeof runCoachingTurn>[0] => ({
  config: fakeConfig(),
  db: {} as never,
  redis: fakeRedis(),
  rateLimiters: fakeRateLimiters(),
  traceEmitter: fakeTraceEmitter(),
});

beforeEach(async () => {
  const triageMod = await import('../../src/coaching/triage.js');
  const sessionMod = await import('../../src/session-lifecycle/index.js');
  const llmMod = await import('../../src/shared/llm/chat.js');
  const paMod = await import('../../src/prompt-assembly/index.js');
  const qcMod = await import('../../src/quality-check/index.js');

  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(llmMod.chat).mockReset();
  vi.mocked(paMod.assemblePrompt).mockReset();
  vi.mocked(qcMod.runQualityCheck).mockReset();
  // Default: prompt assembly returns a stub bundle (only used on fall-through tests)
  vi.mocked(paMod.assemblePrompt).mockResolvedValue({
    assembledPrompt: 'system prompt',
    determinismHash: 'h',
    libraryVersions: {
      promptTemplates: { version: 'test', hash: 'h' },
      voiceRules: { version: 'test', hash: 'h' },
      culturalFraming: { version: 'test', hash: 'h' },
      resolvedAt: new Date(),
    },
    flags: {
      memoryTruncated: false,
      sessionTruncated: false,
      culturalFramingDropped: false,
      fallbackModelUsed: false,
      contextFetchPartial: false,
    },
    practiceTag: null,
    levelTag: null,
    assembledAt: new Date(),
  } as never);
  // Default: chat returns a stub coaching response
  vi.mocked(llmMod.chat).mockResolvedValue({
    text: 'A coaching response would go here.',
    modelUsed: 'claude-haiku-4-5',
    fallbackPath: 'none',
    latencyMs: 100,
    inputTokens: 50,
    outputTokens: 30,
  });
  // Default: QC approves first try
  vi.mocked(qcMod.runQualityCheck).mockResolvedValue({
    endEvent: 'E1_ApprovedFirstAttempt',
    responseText: 'A coaching response would go here.',
    retryCount: 0,
    degraded: false,
    checks: [],
    correctivePromptHistory: [],
  });
});

describe('R-01 short-circuit session guard', () => {
  it('Greeting on a session with turnCount > 0 falls through to coaching path', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-01-greeting-mid-session-falls-through',
        controlId: 'T3.Audit.R01_GreetingMidSessionFallsThrough',
        tier: 'T3',
        description:
          'R-01: Greeting intent on a non-new session (turnCount > 0) must engage coaching path. Reproduces screenshot Bug 1.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        const sessionMod = await import('../../src/session-lifecycle/index.js');
        const llmMod = await import('../../src/shared/llm/chat.js');

        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'Greeting',
        });
        vi.mocked(sessionMod.resolveSession).mockResolvedValue({
          sessionId: TEST_SESSION_ID,
          isNew: false,
          turnCount: 5,
          lastTurnAt: new Date('2026-05-07T11:55:00Z'),
          metadata: null,
        });
        // Force chat() to fail-closed so the orchestrator finalizes cleanly
        // at Step 9 (E11_ServiceUnavailable) without needing post-turn mocks.
        // The signal we care about is that chat() was called at all — that
        // proves the Greeting short-circuit was bypassed.
        vi.mocked(llmMod.chat).mockRejectedValue(
          new LlmServiceUnavailableError('groq', 'test-forced'),
        );

        const result = await runCoachingTurn(deps(), buildInbound('how are u today?'));

        expect(vi.mocked(llmMod.chat)).toHaveBeenCalled();
        expect(result.endEvent).toBe('E11_ServiceUnavailable');
        expect(result.responseText).not.toMatch(/^Salaam\. I'm Hogaan/);
      },
    );
  });

  it('Greeting on a new session (turnCount === 0) still fires GREETING_RESPONSE', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-01-greeting-new-session-fires',
        controlId: 'T3.Audit.R01_GreetingNewSessionFires',
        tier: 'T3',
        description:
          'R-01 regression: genuinely new sessions still get the welcome template. Guards against over-correction.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        const sessionMod = await import('../../src/session-lifecycle/index.js');
        const llmMod = await import('../../src/shared/llm/chat.js');

        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'Greeting',
        });
        vi.mocked(sessionMod.resolveSession).mockResolvedValue({
          sessionId: TEST_SESSION_ID,
          isNew: true,
          turnCount: 0,
          lastTurnAt: new Date('2026-05-07T12:00:00Z'),
          metadata: null,
        });

        const result = await runCoachingTurn(deps(), buildInbound('hi'));

        expect(vi.mocked(llmMod.chat)).not.toHaveBeenCalled();
        expect(result.responseText).toMatch(/^Salaam\. I'm Hogaan/);
        expect(result.endEvent).toBe('E1_TurnCompleted');
      },
    );
  });

  it('Affirmation on a new session (turnCount === 0) falls through to coaching path', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-01-affirmation-new-session-falls-through',
        controlId: 'T3.Audit.R01_AffirmationNewSessionFallsThrough',
        tier: 'T3',
        description:
          'R-01: Affirmation only makes sense on a returning turn. New session + Affirmation intent must engage coaching path (the user is starting, not acknowledging).',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        const sessionMod = await import('../../src/session-lifecycle/index.js');
        const llmMod = await import('../../src/shared/llm/chat.js');

        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'Affirmation',
        });
        vi.mocked(sessionMod.resolveSession).mockResolvedValue({
          sessionId: TEST_SESSION_ID,
          isNew: true,
          turnCount: 0,
          lastTurnAt: new Date('2026-05-07T12:00:00Z'),
          metadata: null,
        });
        vi.mocked(llmMod.chat).mockRejectedValue(
          new LlmServiceUnavailableError('groq', 'test-forced'),
        );

        const result = await runCoachingTurn(deps(), buildInbound('thanks'));

        expect(vi.mocked(llmMod.chat)).toHaveBeenCalled();
        expect(result.endEvent).toBe('E11_ServiceUnavailable');
        expect(result.responseText).not.toMatch(/^Glad it landed/);
      },
    );
  });

  it('Affirmation on a returning session (turnCount > 0) still fires AFFIRMATION_RESPONSE', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-01-affirmation-returning-fires',
        controlId: 'T3.Audit.R01_AffirmationReturningFires',
        tier: 'T3',
        description:
          'R-01 regression: returning session + Affirmation intent still gets the templated affirmation reply.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        const sessionMod = await import('../../src/session-lifecycle/index.js');
        const llmMod = await import('../../src/shared/llm/chat.js');

        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'Affirmation',
        });
        vi.mocked(sessionMod.resolveSession).mockResolvedValue({
          sessionId: TEST_SESSION_ID,
          isNew: false,
          turnCount: 5,
          lastTurnAt: new Date('2026-05-07T11:55:00Z'),
          metadata: null,
        });

        const result = await runCoachingTurn(deps(), buildInbound('thanks'));

        expect(vi.mocked(llmMod.chat)).not.toHaveBeenCalled();
        expect(result.responseText).toMatch(/^Glad it landed/);
        expect(result.endEvent).toBe('E1_TurnCompleted');
      },
    );
  });
});
