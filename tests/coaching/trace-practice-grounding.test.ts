import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import type * as PromptAssemblyModule from '../../src/prompt-assembly/index.js';
import type * as QualityCheckModule from '../../src/quality-check/index.js';
import type * as LibrariesModule from '../../src/libraries/index.js';
import {
  asPhoneE164,
  asSessionId,
  asUserId,
  type SessionId,
} from '../../src/shared/types/index.js';
import { fakeConfig, fakeRateLimiters, fakeRedis } from '../phase-10/helpers/fakes.js';
import type { TraceEmitter, TurnTrace } from '../../src/shared/trace/index.js';

/**
 * Batch P Piece 4 — TurnTrace integration. The practiceGroundingVerdict
 * field must be emitted for coaching turns that run QC. Short-circuit
 * modes (Greeting, Affirmation, Meta, ProfileUpdate) bypass QC entirely
 * so the verdict stays undefined for those traces.
 *
 * 2026-05-08 audit: levelFidelityVerdict (from check_16) removed alongside
 * check_13. Tests below were updated to drop level-fidelity assertions.
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

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000c1ca');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000c1f0');
const TEST_PHONE = asPhoneE164('+254700099c1d');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-p4-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-07T12:00:00Z'),
    traceId: `trace-p4-${Math.random().toString(36).slice(2, 8)}`,
  };
}

interface CapturingEmitter extends TraceEmitter {
  captured: TurnTrace[];
}

function buildCapturingEmitter(): CapturingEmitter {
  const captured: TurnTrace[] = [];
  return {
    captured,
    emit(record) {
      captured.push(record);
    },
    flush: () => Promise.resolve(),
  };
}

const deps = (traceEmitter: TraceEmitter): Parameters<typeof runCoachingTurn>[0] => ({
  config: fakeConfig(),
  db: {} as never,
  redis: fakeRedis(),
  rateLimiters: fakeRateLimiters(),
  traceEmitter,
});

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

  vi.mocked(sessionMod.resolveSession).mockResolvedValue({
    sessionId: TEST_SESSION_ID,
    isNew: false,
    turnCount: 1,
    lastTurnAt: new Date('2026-05-07T11:55:00Z'),
    metadata: null,
  });
  vi.mocked(wppMod.sendOutbound).mockResolvedValue({
    endEvent: 'E1_MessageDispatched',
    waMessageId: 'SMp4',
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
    text: 'Coaching response.',
    modelUsed: 'claude-haiku-4-5',
    fallbackPath: 'none',
    latencyMs: 100,
    inputTokens: 50,
    outputTokens: 30,
  });
});

describe('Batch P Piece 4 — TurnTrace verdicts', () => {
  it('coaching turn trace includes practice-grounding verdict when check ran', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    const qcMod = await import('../../src/quality-check/index.js');

    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Coaching',
    });
    vi.mocked(qcMod.runQualityCheck).mockResolvedValue({
      endEvent: 'E1_ApprovedFirstAttempt',
      responseText: 'Coaching response.',

      retryCount: 0,
      degraded: false,
      checks: [
        {
          checkId: 'check_17_practice_grounding',
          outcome: { status: 'pass' },
        },
      ],
      correctivePromptHistory: [],
    });

    const emitter = buildCapturingEmitter();
    await runCoachingTurn(deps(emitter), buildInbound('coaching question'));

    expect(emitter.captured).toHaveLength(1);
    const trace = emitter.captured[0]!;
    expect(trace.practiceGroundingVerdict).toBe('grounded');
  });

  it('soft_fail grounding outcome maps to mentioned in the trace', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    const qcMod = await import('../../src/quality-check/index.js');

    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Coaching',
    });
    vi.mocked(qcMod.runQualityCheck).mockResolvedValue({
      endEvent: 'E2_ApprovedRegenerated',
      responseText: 'Coaching response.',

      retryCount: 1,
      degraded: false,
      checks: [
        {
          checkId: 'check_17_practice_grounding',
          outcome: { status: 'soft_fail', reason: 'practice mentioned: q' },
        },
      ],
      correctivePromptHistory: [],
    });

    const emitter = buildCapturingEmitter();
    await runCoachingTurn(deps(emitter), buildInbound('coaching question'));

    const trace = emitter.captured[0]!;
    expect(trace.practiceGroundingVerdict).toBe('mentioned');
  });

  it('reason containing "absent" maps to absent verdict', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    const qcMod = await import('../../src/quality-check/index.js');

    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Coaching',
    });
    vi.mocked(qcMod.runQualityCheck).mockResolvedValue({
      endEvent: 'E2_ApprovedRegenerated',
      responseText: 'Coaching response.',

      retryCount: 1,
      degraded: false,
      checks: [
        {
          checkId: 'check_17_practice_grounding',
          outcome: { status: 'soft_fail', reason: 'practice grounding absent: tag not present' },
        },
      ],
      correctivePromptHistory: [],
    });

    const emitter = buildCapturingEmitter();
    await runCoachingTurn(deps(emitter), buildInbound('coaching question'));

    expect(emitter.captured[0]!.practiceGroundingVerdict).toBe('absent');
  });

  it('greeting short-circuit trace omits both verdict fields', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    const sessionMod = await import('../../src/session-lifecycle/index.js');

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

    const emitter = buildCapturingEmitter();
    await runCoachingTurn(deps(emitter), buildInbound('hi'));

    // Short-circuits emit a trace via the templated-response path (finalize),
    // which does NOT populate the new verdict fields. They stay undefined.
    expect(emitter.captured.length).toBeGreaterThanOrEqual(1);
    const trace = emitter.captured[emitter.captured.length - 1]!;
    expect(trace.practiceGroundingVerdict).toBeUndefined();
  });
});
