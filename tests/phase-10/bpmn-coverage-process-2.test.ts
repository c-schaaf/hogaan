import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoachingTurn } from '../../src/coaching/orchestrator.js';
import type * as TriageModule from '../../src/coaching/triage.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import {
  asPhoneE164,
  asSessionId,
  asUserId,
  type SessionId,
} from '../../src/shared/types/index.js';
import { recordEvidence } from '../../src/shared/audit-evidence/index.js';
import { withEvidence } from './helpers/evidence.js';
import { fakeConfig, fakeRateLimiters, fakeRedis, fakeTraceEmitter } from './helpers/fakes.js';

/**
 * Phase 10.1 BPMN coverage — Process #2 (Coaching Conversation).
 *
 * Closes 5 gaps via end-to-end orchestrator drives:
 *   - E4_ScenarioHandoff
 *   - E5_ProfileAck
 *   - E6_MetaResponse
 *   - E8_MediaNotSupported
 *   - E9_MessageRejected
 *
 * E10_ClarifyingQuestionSent is recorded as DEFERRED-BY-DESIGN: Process #2
 * Step 7 (clarification decision) is deliberately a no-op in v1 per the
 * comment in src/coaching/orchestrator.ts ("v1: skip — always advance").
 * The end event is in the catalog but unreachable in current code; future
 * v2 work will wire the ambiguity classifier and produce real evidence.
 *
 * The orchestrator's heavy I/O boundaries are mocked so the test runs in
 * CI without DB / LLM / Twilio dependencies. The mocked surface is:
 *   - triage()       (Process #2 Step 1) — controls the triage result
 *   - resolveSession (Step 2)             — returns canned session
 *   - runScenarioTurn (Step 4 pre)        — controls scenario outcome
 *   - sendOutbound   (Step 11)            — captures dispatched body
 *
 * Real code paths still exercised inside the orchestrator:
 *   - intent routing decision matrix
 *   - finalize() trace emission + endEvent assignment
 *   - sendBody() correlationId + caller_process_id construction
 *   - the scenario-routing precedence-over-intent branch
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
  runScenarioTurn: vi.fn(),
}));

const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000beef');
const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000abcd');
const TEST_PHONE = asPhoneE164('+254700099991');

function buildInbound(
  body: string,
  mediaUrls: string[] = [],
): Parameters<typeof runCoachingTurn>[1] {
  return {
    userId: TEST_USER_ID,
    phoneE164: TEST_PHONE,
    phoneHash: hashPhone(TEST_PHONE),
    body,
    mediaUrls,
    inboundMessageId: `MM-test-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date('2026-05-06T12:00:00Z'),
    traceId: `trace-${Math.random().toString(36).slice(2, 8)}`,
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
  const scenarioMod = await import('../../src/scenario-learning/index.js');
  vi.mocked(triageMod.triage).mockReset();
  vi.mocked(triageMod.fastPathTriage).mockReset();
  vi.mocked(sessionMod.resolveSession).mockReset();
  vi.mocked(scenarioMod.runScenarioTurn).mockReset();
  // Default: resolveSession returns a stable session.
  vi.mocked(sessionMod.resolveSession).mockResolvedValue({
    sessionId: TEST_SESSION_ID,
    isNew: false,
    turnCount: 1,
    lastTurnAt: new Date('2026-05-06T11:55:00Z'),
    metadata: null,
  });
  // Default: scenario subprocess returns no-op.
  vi.mocked(scenarioMod.runScenarioTurn).mockResolvedValue({
    kind: 'no_active_scenario_no_kickoff',
  });
});

describe('Phase 10.1 — Process #2 (Coaching) end-event coverage', () => {
  it('E8_MediaNotSupported: empty body + media URL routes to media-reject template', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e8-media-not-supported',
        controlId: 'T2.Process2.E8_MediaNotSupported',
        tier: 'T2',
        description:
          'Inbound with mediaUrls + empty body fires Process #2 Step 1 fast-path media_only branch → polite text-only response sent → E8_MediaNotSupported. No LLM call attempted.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        // Real fastPathTriage handles media_only synchronously; we use the
        // ACTUAL implementation here by importing and re-exporting.
        const { fastPathTriage: realFastPath, triage: realTriage } = await vi.importActual<
          typeof TriageModule
        >('../../src/coaching/triage.js');
        vi.mocked(triageMod.fastPathTriage).mockImplementation(realFastPath);
        vi.mocked(triageMod.triage).mockImplementation(realTriage);

        const result = await runCoachingTurn(
          deps(),
          buildInbound('', ['https://example.com/voice-note.ogg']),
        );

        expect(result.endEvent).toBe('E8_MediaNotSupported');
        expect(result.responseText).toMatch(/text only/i);
      },
    );
  });

  it('E9_MessageRejected: triage classifies as reject (abusive) → REJECT_TEMPLATE sent', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e9-rejected-abusive',
        controlId: 'T2.Process2.E9_MessageRejected',
        tier: 'T2',
        description:
          'Triage returns status=reject (the LLM classifier flagged the message as abusive/out-of-scope). Orchestrator sends the REJECT_TEMPLATE via sendBody and finalizes with E9_MessageRejected. No coaching pipeline triggered.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'reject',
          reason: 'classifier flagged content',
          intent: 'OutOfScope',
        });

        const result = await runCoachingTurn(
          deps(),
          buildInbound('hostile or sexually explicit content here'),
        );

        expect(result.endEvent).toBe('E9_MessageRejected');
        expect(result.responseText).toMatch(/lands outside what I can help with/i);
      },
    );
  });

  it('E9_MessageRejected: empty body but no media → silent drop (E12), reject not fired (boundary)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e9-empty-not-rejected',
        controlId: 'T2.Process2.E9_MessageRejected',
        tier: 'T2',
        description:
          'Boundary documentation: an empty inbound with no media is E12_SilentDrop (no response sent), NOT E9_MessageRejected. E9 requires LLM-classified rejection.',
        details: { boundary: 'empty-vs-reject' },
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        const { fastPathTriage: realFastPath, triage: realTriage } = await vi.importActual<
          typeof TriageModule
        >('../../src/coaching/triage.js');
        vi.mocked(triageMod.fastPathTriage).mockImplementation(realFastPath);
        vi.mocked(triageMod.triage).mockImplementation(realTriage);

        const result = await runCoachingTurn(deps(), buildInbound('   '));
        // Empty body + no media = E12_SilentDrop, demonstrating that E9
        // requires content the classifier categorizes as harassing /
        // sexually explicit / prompt-injection.
        expect(result.endEvent).toBe('E12_SilentDrop');
      },
    );
  });

  it('E5_ProfileAck: triage intent=ProfileUpdate → templated profile acknowledgment sent', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e5-profile-ack',
        controlId: 'T2.Process2.E5_ProfileAck',
        tier: 'T2',
        description:
          'Triage classifies intent=ProfileUpdate. Orchestrator routes to runTemplatedResponse(PROFILE_ACK_TEMPLATE) and finalizes with E5_ProfileAck. No full coaching prompt assembly or LLM call.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'ProfileUpdate',
        });

        const result = await runCoachingTurn(
          deps(),
          buildInbound('actually I just got promoted to director'),
        );

        expect(result.endEvent).toBe('E5_ProfileAck');
        expect(result.responseText).toMatch(/Heard/i);
      },
    );
  });

  it('E6_MetaResponse: triage intent=MetaQuestion → templated meta response sent', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e6-meta-response',
        controlId: 'T2.Process2.E6_MetaResponse',
        tier: 'T2',
        description:
          'Triage classifies intent=MetaQuestion ("are you AI?"). Orchestrator routes to runTemplatedResponse(META_TEMPLATE) and finalizes with E6_MetaResponse. No coaching pipeline triggered.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'MetaQuestion',
        });

        const result = await runCoachingTurn(
          deps(),
          buildInbound('how does this work? are you AI?'),
        );

        expect(result.endEvent).toBe('E6_MetaResponse');
        expect(result.responseText).toMatch(/anchored in Hamse Warfa's 12 Practices/i);
      },
    );
  });

  it('E4_ScenarioHandoff: triage intent=ScenarioRequest → scenario kickoff via runScenarioTurn', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e4-scenario-handoff-kickoff',
        controlId: 'T2.Process2.E4_ScenarioHandoff',
        tier: 'T2',
        description:
          'Triage classifies intent=ScenarioRequest with no active scenario. Orchestrator delegates to runScenarioTurn which kicks off a new scenario; orchestrator finalizes with E4_ScenarioHandoff. The scenario subprocess delivered step 1 verbatim — no main coaching pipeline triggered.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'ScenarioRequest',
        });

        const scenarioMod = await import('../../src/scenario-learning/index.js');
        vi.mocked(scenarioMod.runScenarioTurn).mockResolvedValue({
          kind: 'kickoff_sent',
          scenarioId: 'dignity-the-firing',
          step: 1,
          responseText:
            'Scenario: Letting someone go with dignity. You have to deliver this news on Tuesday. What do you NOT want this person to feel walking out of that room?',
        });

        const result = await runCoachingTurn(
          deps(),
          buildInbound('can we practice a difficult conversation?'),
        );

        expect(result.endEvent).toBe('E4_ScenarioHandoff');
        expect(result.responseText).toMatch(/Letting someone go with dignity/);
        expect(result.reason).toBe('scenario_kickoff_sent');

        // Verify the orchestrator called runScenarioTurn with isScenarioRequestKickoff=true.
        const scenarioCall = vi.mocked(scenarioMod.runScenarioTurn).mock.calls[0]!;
        expect(scenarioCall[2]).toBe(true);
      },
    );
  });

  it('E4_ScenarioHandoff: continuation path takes precedence over intent classification', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-2/e4-scenario-continuation-precedence',
        controlId: 'T2.Process2.E4_ScenarioHandoff',
        tier: 'T2',
        description:
          'Active scenario continuation: even when the triage intent is Coaching (not ScenarioRequest), an existing activeScenario on the user profile causes the scenario subprocess to handle the turn. Tests the precedence rule documented in src/coaching/orchestrator.ts.',
      },
      async () => {
        const triageMod = await import('../../src/coaching/triage.js');
        vi.mocked(triageMod.triage).mockResolvedValue({
          status: 'valid',
          reason: 'classifier passed',
          intent: 'Coaching', // not ScenarioRequest
        });

        const scenarioMod = await import('../../src/scenario-learning/index.js');
        vi.mocked(scenarioMod.runScenarioTurn).mockResolvedValue({
          kind: 'step_completed',
          scenarioId: 'integrity-the-shortcut',
          stepCompleted: 1,
          nextStep: 2,
          responseText: 'Step 2: ...',
        });

        const result = await runCoachingTurn(
          deps(),
          buildInbound("Here's what I'd do in that situation: ..."),
        );

        expect(result.endEvent).toBe('E4_ScenarioHandoff');
        expect(result.reason).toBe('scenario_step_completed');
      },
    );
  });

  // E10_ClarifyingQuestionSent — explicitly recorded as deferred-by-design.
  it('E10_ClarifyingQuestionSent recorded as deferred-by-design', async () => {
    await recordEvidence({
      testId: 'phase-10/bpmn-coverage/process-2/e10-clarifying-question-deferred',
      controlId: 'T2.Process2.E10_ClarifyingQuestionSent',
      tier: 'T2',
      outcome: 'deferred',
      description:
        'Process #2 Step 7 (clarification decision) is intentionally a no-op in v1 per src/coaching/orchestrator.ts ("v1: skip — always advance"). The end event is in the catalog but unreachable in current code. Reachability requires v2 wiring of the small-LLM ambiguity classifier (Phase 7 plan §7.7); deferred until Phase 7-revisit batch.',
      details: {
        gating: 'v2',
        codeReference: 'src/coaching/orchestrator.ts Step 7 comment',
        masterPlan: 'Phase 7.7 — clarification decision (small LLM ambiguity classifier)',
      },
    });
    expect(true).toBe(true);
  });
});
