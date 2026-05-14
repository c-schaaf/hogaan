import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { LlmServiceUnavailableError } from '../../src/shared/llm/errors.js';
import { FALLBACK_DEGRADED } from '../../src/quality-check/fallbacks.js';
import type * as PromptAssemblyModule from '../../src/prompt-assembly/index.js';
import type * as TraceModule from '../../src/shared/trace/index.js';
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
 * R-04 cousin (Batch B.1) — Step 9 primary LLM call failure.
 *
 * The Step 9 catch at orchestrator.ts:293–308 maps `isFailClosedLlmError`
 * (LlmServiceUnavailableError | LlmAuthError) to E11_ServiceUnavailable
 * via finalize(...) — but with `responseText: ''` and no sendBody call.
 * Result: when the primary+fallback LLM both fail, the trace fires but
 * the user gets no message at all. Same shape as R-04's pre-fix Step 8
 * defect, on a different code path.
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

vi.mock('../../src/shared/llm/chat.js', () => ({
  chat: vi.fn(),
}));

vi.mock('../../src/shared/trace/index.js', async () => {
  const actual = await vi.importActual<typeof TraceModule>('../../src/shared/trace/index.js');
  return {
    ...actual,
    emitTurnTrace: vi.fn(),
  };
});

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000b104');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000b1ff');
const TEST_PHONE = asPhoneE164('+254700099b01');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-b1-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-07T12:00:00Z'),
    traceId: `trace-b1-${Math.random().toString(36).slice(2, 8)}`,
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

  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(llmMod.chat).mockReset();
  vi.mocked(paMod.assemblePrompt).mockReset();

  vi.mocked(triageMod.triage).mockResolvedValue({
    status: 'valid',
    reason: 'classifier passed',
    intent: 'Coaching',
  });
  vi.mocked(sessionMod.resolveSession).mockResolvedValue({
    sessionId: TEST_SESSION_ID,
    isNew: false,
    turnCount: 1,
    lastTurnAt: new Date('2026-05-07T11:55:00Z'),
    metadata: null,
  });
  // Default: assembler returns a stub bundle so Step 8 succeeds and we
  // reach Step 9 (the unit under test).
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
});

describe('R-04 cousin — Step 9 primary LLM failure', () => {
  it('LlmServiceUnavailableError finalizes E11 + dispatches FALLBACK_DEGRADED, does NOT throw', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-04-cousin-step9-llm-failure-handled',
        controlId: 'T3.Audit.R04Cousin_Step9LlmFailure',
        tier: 'T3',
        description:
          'R-04 cousin: Step 9 catch must dispatch FALLBACK_DEGRADED via sendBody before finalize. Pre-fix the orchestrator returned an empty body and the user received nothing.',
      },
      async () => {
        const llmMod = await import('../../src/shared/llm/chat.js');
        vi.mocked(llmMod.chat).mockRejectedValue(
          new LlmServiceUnavailableError('groq', 'test-forced'),
        );

        const result = await runCoachingTurn(deps(), buildInbound('I had a rough day today'));

        expect(result.endEvent).toBe('E11_ServiceUnavailable');
        expect(result.responseText).toMatch(/Something on my end isn't responding/);
      },
    );
  });

  it('non-LLM error still throws (unknown errors are not swallowed)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-04-cousin-step9-unknown-error-rethrown',
        controlId: 'T3.Audit.R04Cousin_UnknownErrorRethrown',
        tier: 'T3',
        description:
          'R-04 cousin negative control: a generic Error from chat() must NOT be caught by the Step 9 isFailClosedLlmError branch. The orchestrator preserves bug-report semantics for genuinely unknown failures.',
      },
      async () => {
        const llmMod = await import('../../src/shared/llm/chat.js');
        vi.mocked(llmMod.chat).mockRejectedValue(new TypeError('something is wrong'));

        await expect(runCoachingTurn(deps(), buildInbound('coaching message'))).rejects.toThrow(
          TypeError,
        );
      },
    );
  });

  it('Bug 3 cousin regression lock: user-facing body equals FALLBACK_DEGRADED on fail-closed LLM error', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-04-cousin-bug3-regression-lock',
        controlId: 'T3.Audit.R04Cousin_Bug3RegressionLock',
        tier: 'T3',
        description:
          'Locks the contract that on a fail-closed LLM error, the orchestrator returns the FALLBACK_DEGRADED template (not an empty string). This is the symptom Bug 3 surfaces in production logs.',
      },
      async () => {
        const llmMod = await import('../../src/shared/llm/chat.js');
        vi.mocked(llmMod.chat).mockRejectedValue(
          new LlmServiceUnavailableError('groq', 'test-forced'),
        );

        const result = await runCoachingTurn(deps(), buildInbound('I had a rough day today'));

        expect(result.responseText.length).toBeGreaterThan(0);
        expect(result.responseText).toBe(FALLBACK_DEGRADED);
      },
    );
  });
});
