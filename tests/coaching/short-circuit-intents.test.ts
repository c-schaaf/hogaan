import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import {
  asPhoneE164,
  asSessionId,
  asUserId,
  type SessionId,
} from '../../src/shared/types/index.js';
import {
  fakeConfig,
  fakeRateLimiters,
  fakeRedis,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

/**
 * Phase 11 R16 — Greeting + Affirmation must never enter prompt assembly.
 *
 * The audit found that pure-greeting turns ("salaam") were running the
 * full pipeline: tagger → prompt assembly → primary LLM → QC → delivery.
 * That wasted ~3-4s of latency budget per greeting and produced robotic
 * pseudo-coaching replies. R16 short-circuits Greeting and Affirmation
 * to a templated send before the tagger runs.
 *
 * Coverage:
 *   - Greeting routes to GREETING_RESPONSE; LLM never invoked
 *   - Affirmation routes to AFFIRMATION_RESPONSE; LLM never invoked
 *   - Both end at E1_TurnCompleted with practiceTag=null, levelTag=null
 *   - The callerProcessId carries the short-circuit subId for trace
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
  runScenarioTurn: vi.fn(() => Promise.resolve({ kind: 'no_active_scenario_no_kickoff' as const })),
}));

vi.mock('../../src/shared/llm/chat.js', () => ({
  chat: vi.fn(() => Promise.reject(new Error('LLM should not be invoked on short-circuit path'))),
}));

vi.mock('../../src/whatsapp-delivery/orchestrator.js', () => ({
  sendOutbound: vi.fn(() =>
    Promise.resolve({
      endEvent: 'E1_MessageDispatched',
      waMessageId: 'SMtest-r16',
      dispatchPath: 'direct',
      retryCount: 0,
      queueLoops: 0,
    }),
  ),
}));

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000beef');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000abcd');
const TEST_PHONE = asPhoneE164('+254700099991');

function buildInbound(body: string): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls: [],
    inboundMessageId: `MM-test-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-06T12:00:00Z'),
    traceId: `trace-r16-${Math.random().toString(36).slice(2, 8)}`,
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
  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(wppMod.sendOutbound).mockReset();
  vi.mocked(wppMod.sendOutbound).mockResolvedValue({
    endEvent: 'E1_MessageDispatched',
    waMessageId: 'SMdefault',
    dispatchPath: 'direct',
    retryCount: 0,
    queueLoops: 0,
  });
  vi.mocked(sessionMod.resolveSession).mockResolvedValue({
    sessionId: TEST_SESSION_ID,
    isNew: false,
    turnCount: 1,
    lastTurnAt: new Date('2026-05-06T11:55:00Z'),
    metadata: null,
  });
});

describe('Phase 11 R16 — Greeting + Affirmation short-circuit', () => {
  it('Greeting → GREETING_RESPONSE template; LLM never invoked', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Greeting',
    });

    const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
    const sendSpy = vi.mocked(wppMod.sendOutbound);
    const llmMod = await import('../../src/shared/llm/chat.js');
    const llmSpy = vi.mocked(llmMod.chat);

    const result = await runCoachingTurn(deps(), buildInbound('salaam'));

    expect(result.endEvent).toBe('E1_TurnCompleted');
    expect(result.responseText).toMatch(/^Salaam\. I'm Hogaan/);
    expect(result.practiceTag).toBeNull();
    expect(result.levelTag).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(llmSpy).not.toHaveBeenCalled();
    const sendArgs = sendSpy.mock.calls[0]![1] as { callerProcessId: string };
    expect(sendArgs.callerProcessId).toBe('coaching:greeting');
  });

  it('Affirmation → AFFIRMATION_RESPONSE template; LLM never invoked', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Affirmation',
    });

    const wppMod = await import('../../src/whatsapp-delivery/orchestrator.js');
    const sendSpy = vi.mocked(wppMod.sendOutbound);
    const llmMod = await import('../../src/shared/llm/chat.js');
    const llmSpy = vi.mocked(llmMod.chat);

    const result = await runCoachingTurn(deps(), buildInbound('thanks, that helps'));

    expect(result.endEvent).toBe('E1_TurnCompleted');
    expect(result.responseText).toMatch(/Glad it landed/);
    expect(result.practiceTag).toBeNull();
    expect(result.levelTag).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(llmSpy).not.toHaveBeenCalled();
    const sendArgs = sendSpy.mock.calls[0]![1] as { callerProcessId: string };
    expect(sendArgs.callerProcessId).toBe('coaching:affirmation');
  });

  it('short-circuit latency: greeting completes well under the 6s p99 budget', async () => {
    const triageMod = await import('../../src/coaching/triage.js');
    vi.mocked(triageMod.triage).mockResolvedValue({
      status: 'valid',
      reason: 'classifier passed',
      intent: 'Greeting',
    });

    const t0 = Date.now();
    const result = await runCoachingTurn(deps(), buildInbound('hi'));
    const elapsed = Date.now() - t0;

    expect(result.endEvent).toBe('E1_TurnCompleted');
    // Mocked I/O: should be <100ms even on slow CI. The contract is "no LLM",
    // not a precise number — but a regression to the full pipeline would
    // blow past 100ms easily.
    expect(elapsed).toBeLessThan(500);
    expect(result.latencyMs).toBeLessThan(500);
  });
});
