import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn, _internal } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { FALLBACK_DEGRADED } from '../../src/quality-check/fallbacks.js';
import type * as PromptAssemblyModule from '../../src/prompt-assembly/index.js';
import type * as QualityCheckModule from '../../src/quality-check/index.js';
import type * as LibrariesModule from '../../src/libraries/index.js';
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
 * R-06 (HIGH audit risk) — total turn budget (PRD §5.1, p99 ≤ 6000ms)
 * must be enforced before delivery. Pre-fix: a pathological turn could
 * run multi-tens-of-seconds and the user would either wait or receive
 * a stale-feeling answer. Post-fix: when elapsed time exceeds
 * LATENCY_BUDGET_MS at the deadline check (just before Step 11), the
 * orchestrator routes to FALLBACK_DEGRADED + E11_ServiceUnavailable.
 *
 * Tests use Date.now mocking (not fake timers) for deterministic elapsed
 * control without coupling to setTimeout internals.
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

vi.mock('../../src/quality-check/index.js', async () => {
  const actual = await vi.importActual<typeof QualityCheckModule>(
    '../../src/quality-check/index.js',
  );
  return {
    ...actual,
    runQualityCheck: vi.fn(),
  };
});

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

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000c106');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000c1ff');
const TEST_PHONE = asPhoneE164('+254700099c01');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-c-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-07T12:00:00Z'),
    traceId: `trace-c-${Math.random().toString(36).slice(2, 8)}`,
  };
}

const deps = (): Parameters<typeof runCoachingTurn>[0] => ({
  config: fakeConfig(),
  db: {} as never,
  redis: fakeRedis(),
  rateLimiters: fakeRateLimiters(),
  traceEmitter: fakeTraceEmitter(),
});

/**
 * Mock Date.now to return a controlled elapsed time. The orchestrator
 * captures `t0 = Date.now()` at entry, then computes `Date.now() - t0`
 * at the deadline check. We hand it a sequence:
 *   call 1 (t0)         → 0
 *   call 2..N (during turn) → 0 (so per-step latency math doesn't blow up)
 *   call at deadline check → elapsedAtCheckMs
 *   any further calls   → elapsedAtCheckMs
 *
 * Implementation: track a counter and switch behavior on the call that
 * matters. Simplest: use a controllable getter that always returns the
 * configured "now" relative to a fixed origin.
 */
function withFakeNow(elapsedAtCheckMs: number): () => void {
  const origin = 1_700_000_000_000; // arbitrary epoch
  let calls = 0;
  // First call returns origin (orchestrator captures this as t0). Every
  // subsequent call returns origin + elapsedAtCheckMs so any
  // `Date.now() - t0` evaluates to elapsedAtCheckMs.
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
    calls += 1;
    if (calls === 1) {
      return origin;
    }
    return origin + elapsedAtCheckMs;
  });
  return () => spy.mockRestore();
}

beforeEach(async () => {
  const triageMod = await import('../../src/coaching/triage.js');
  const sessionMod = await import('../../src/session-lifecycle/index.js');
  const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
  const llmMod = await import('../../src/shared/llm/chat.js');
  const paMod = await import('../../src/prompt-assembly/index.js');
  const qcMod = await import('../../src/quality-check/index.js');

  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(wppMod.sendOutbound).mockReset();
  vi.mocked(llmMod.chat).mockReset();
  vi.mocked(paMod.assemblePrompt).mockReset();
  vi.mocked(qcMod.runQualityCheck).mockReset();

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
    waMessageId: 'SMc',
    dispatchPath: 'direct',
    retryCount: 0,
    queueLoops: 0,
  });
  vi.mocked(paMod.assemblePrompt).mockResolvedValue({
    assembledPrompt: 'system prompt',
    determinismHash: 'h',
    libraryVersions: {
      promptTemplates: { version: 'test', hash: 'h' },
      voiceRules: { version: 'test', hash: 'h' },
      culturalFraming: { version: 'test', hash: 'h' },
      resolvedAt: new Date(),
    },
    degradationFlags: {
      memoryTruncated: false,
      sessionTruncated: false,
      culturalFramingDropped: false,
    },
    practiceTag: null,
    levelTag: null,
    assembledAt: new Date(),
  } as never);
  vi.mocked(llmMod.chat).mockResolvedValue({
    text: 'A coaching response would go here.',
    modelUsed: 'claude-haiku-4-5',
    fallbackPath: 'none',
    latencyMs: 100,
    inputTokens: 50,
    outputTokens: 30,
  });
  vi.mocked(qcMod.runQualityCheck).mockResolvedValue({
    endEvent: 'E1_ApprovedFirstAttempt',
    responseText: 'A coaching response would go here.',
    crisisDetected: false,
    retryCount: 0,
    degraded: false,
    checks: [],
    correctivePromptHistory: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('R-06 latency budget', () => {
  it('LATENCY_BUDGET_MS is 6000ms (PRD §5.1)', () => {
    expect(_internal.LATENCY_BUDGET_MS).toBe(6000);
  });

  it('over-budget pre-delivery → FALLBACK_DEGRADED + E11', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-06-over-budget-falls-back',
        controlId: 'T3.Audit.R06_LatencyBudget_OverBudget',
        tier: 'T3',
        description:
          'R-06: when elapsed time at the deadline check exceeds LATENCY_BUDGET_MS (6000ms), orchestrator routes to FALLBACK_DEGRADED + E11_ServiceUnavailable instead of shipping the coaching response.',
      },
      async () => {
        const restore = withFakeNow(7000); // 7s elapsed — over budget
        try {
          const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
          const sendSpy = vi.mocked(wppMod.sendOutbound);

          const result = await runCoachingTurn(deps(), buildInbound('I had a rough day'));

          expect(result.endEvent).toBe('E11_ServiceUnavailable');
          expect(result.responseText).toBe(FALLBACK_DEGRADED);
          expect(sendSpy).toHaveBeenCalledTimes(1);
          const sendArgs = sendSpy.mock.calls[0]![1] as {
            body?: string;
            callerProcessId: string;
          };
          expect(sendArgs.body).toBe(FALLBACK_DEGRADED);
          expect(sendArgs.callerProcessId).toContain('budget-exceeded');
        } finally {
          restore();
        }
      },
    );
  });

  it('under-budget turn completes normally (regression lock)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-06-under-budget-passes',
        controlId: 'T3.Audit.R06_LatencyBudget_UnderBudget',
        tier: 'T3',
        description:
          'R-06 regression: under-budget turns proceed to normal delivery. Guards against over-correction (we did not break the happy path).',
      },
      async () => {
        const restore = withFakeNow(3500); // 3.5s elapsed — well under
        try {
          const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
          const sendSpy = vi.mocked(wppMod.sendOutbound);

          const result = await runCoachingTurn(deps(), buildInbound('coaching question'));

          expect(result.endEvent).toBe('E1_TurnCompleted');
          expect(result.responseText).toBe('A coaching response would go here.');
          expect(sendSpy).toHaveBeenCalledTimes(1);
          const sendArgs = sendSpy.mock.calls[0]![1] as {
            body?: string;
            callerProcessId: string;
          };
          expect(sendArgs.callerProcessId).toContain('coaching-response');
        } finally {
          restore();
        }
      },
    );
  });

  it('exactly at boundary (6000ms) is treated as under (predicate is `>`, not `>=`)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'audit/R-06-boundary-pass',
        controlId: 'T3.Audit.R06_LatencyBudget_Boundary',
        tier: 'T3',
        description:
          'R-06 boundary: an elapsed-time of exactly 6000ms ships normally. The deadline predicate is strict `>`, not `>=`. Locks the boundary semantics.',
      },
      async () => {
        const restore = withFakeNow(6000); // exactly at the boundary
        try {
          const result = await runCoachingTurn(deps(), buildInbound('boundary question'));
          expect(result.endEvent).toBe('E1_TurnCompleted');
          expect(result.responseText).toBe('A coaching response would go here.');
        } finally {
          restore();
        }
      },
    );
  });
});
