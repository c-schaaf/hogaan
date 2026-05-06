import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { PromptAssemblyError } from '../../src/prompt-assembly/index.js';
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
 * R-04 (CRITICAL audit risk) — Step 8 prompt-assembly failure must be caught
 * inside runCoachingTurn so the user receives FALLBACK_DEGRADED via the
 * existing send path, NOT bubble unhandled into the queue-processor's
 * dead-letter catch.
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

vi.mock('../../src/whatsapp-delivery/orchestrator.js', () => ({
  sendOutbound: vi.fn(),
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

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-0000000004');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-0000000004ff');
const TEST_PHONE = asPhoneE164('+254700099904');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-r04-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-07T12:00:00Z'),
    traceId: `trace-r04-${Math.random().toString(36).slice(2, 8)}`,
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
  const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
  const llmMod = await import('../../src/shared/llm/chat.js');
  const paMod = await import('../../src/prompt-assembly/index.js');

  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(wppMod.sendOutbound).mockReset();
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
  vi.mocked(wppMod.sendOutbound).mockResolvedValue({
    endEvent: 'E1_MessageDispatched',
    waMessageId: 'SMr04',
    dispatchPath: 'direct',
    retryCount: 0,
    queueLoops: 0,
  });
});

describe('R-04 prompt-assembly failure', () => {
  it('PromptAssemblyError finalizes E11 + dispatches FALLBACK_DEGRADED, does NOT throw', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-04-prompt-assembly-failure-handled',
        controlId: 'T3.Audit.R04_PromptAssemblyFailure',
        tier: 'T3',
        description:
          'R-04: Step 8 catch wraps assemblePrompt and routes PromptAssemblyError to E11 + FALLBACK_DEGRADED via sendOutbound. The orchestrator must not rethrow.',
      },
      async () => {
        const paMod = await import('../../src/prompt-assembly/index.js');
        vi.mocked(paMod.assemblePrompt).mockRejectedValue(
          new PromptAssemblyError('library missing', 'E6_LibraryUnavailable'),
        );

        const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
        const sendSpy = vi.mocked(wppMod.sendOutbound);
        const llmMod = await import('../../src/shared/llm/chat.js');
        const chatSpy = vi.mocked(llmMod.chat);

        const result = await runCoachingTurn(deps(), buildInbound('I had a rough day today'));

        expect(result.endEvent).toBe('E11_ServiceUnavailable');
        expect(chatSpy).not.toHaveBeenCalled();
        expect(sendSpy).toHaveBeenCalledTimes(1);
        const sendArgs = sendSpy.mock.calls[0]![1] as { body?: string; callerProcessId: string };
        expect(sendArgs.body).toMatch(/Something on my end isn't responding/);
      },
    );
  });

  it('non-PromptAssemblyError still throws (unknown errors are not swallowed)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-04-unknown-error-rethrown',
        controlId: 'T3.Audit.R04_UnknownErrorRethrown',
        tier: 'T3',
        description:
          'R-04 negative control: a generic Error from assemblePrompt must NOT be caught by the new try/catch. The orchestrator preserves bug-report semantics for unknown failures.',
      },
      async () => {
        const paMod = await import('../../src/prompt-assembly/index.js');
        vi.mocked(paMod.assemblePrompt).mockRejectedValue(new TypeError('something is wrong'));

        await expect(runCoachingTurn(deps(), buildInbound('coaching message'))).rejects.toThrow(
          TypeError,
        );
      },
    );
  });
});
